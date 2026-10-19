-- Super Admin, reserved operational identities, and permanent staff deletion.
--
-- Super Admin: an explicit flag on one or more verified email Admin accounts.
-- It can only be granted or removed outside the API (migration or SQL editor);
-- no RPC changes it and API requests that try are rejected. Only a Super Admin
-- may permanently delete staff accounts or change a Super Admin account.
--
-- Reserved operational identities: the login names venue and events may exist
-- only as the operational account of the same slot, and slots are no longer
-- assignable from the browser. Ordinary staff creation cannot claim them.
--
-- Deletion: admin_prepare_staff_deletion() checks every rule, records a
-- tombstone (label and the sessions the account ran), removes room access,
-- deactivates the account and revokes its Auth sessions in one transaction.
-- The trusted staff-account-delete Edge Function then deletes the Auth
-- identity. Gameplay history and audit rows are kept: their foreign keys to
-- auth.users are ON DELETE SET NULL, and the tombstone keeps attribution.

alter table public.staff_accounts add column is_super_admin boolean not null default false;
alter table public.staff_accounts add constraint staff_super_admin_valid
  check (not is_super_admin or (role = 'admin' and account_type = 'email'));
alter table public.staff_accounts add constraint staff_reserved_login_names
  check (login_name is null or login_name not in ('venue','events') or operational_slot is not distinct from login_name);

-- The flag never changes through an authenticated API request.
create function ahaji_private.protect_super_admin_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and
     (tg_op = 'INSERT' and new.is_super_admin or
      tg_op = 'UPDATE' and new.is_super_admin is distinct from old.is_super_admin) then
    raise exception 'Super Admin can only be changed by the database owner' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function ahaji_private.protect_super_admin_flag() from public, anon, authenticated;
create trigger staff_accounts_protect_super_admin before insert or update of is_super_admin
  on public.staff_accounts for each row execute function ahaji_private.protect_super_admin_flag();

-- Designate the existing Super Admin only when it is unambiguous: exactly one
-- active, verified email Admin. Otherwise leave it unset for the owner to set.
do $$
declare v_count integer; v_user uuid;
begin
  select count(*), min(sa.user_id::text)::uuid into v_count, v_user
    from public.staff_accounts sa join auth.users u on u.id = sa.user_id
    where sa.role = 'admin' and sa.active and sa.account_type = 'email'
      and u.email_confirmed_at is not null and u.deleted_at is null;
  if v_count = 1 then
    update public.staff_accounts set is_super_admin = true where user_id = v_user;
  else
    raise notice 'Super Admin not designated automatically (% active Admins); set it in the SQL editor.', v_count;
  end if;
end;
$$;

create function ahaji_private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select ahaji_private.current_staff_role()) = 'admin' and exists(
    select 1 from public.staff_accounts where user_id = (select auth.uid()) and is_super_admin), false);
$$;
revoke all on function ahaji_private.is_super_admin() from public, anon, authenticated;
grant execute on function ahaji_private.is_super_admin() to authenticated;

-- Slots are fixed configuration now; the browser can no longer assign them.
revoke execute on function public.admin_set_operational_slot(uuid,text) from authenticated;

-- Only a Super Admin may change a Super Admin account; reserved operational
-- accounts keep their Game Master role (deactivation stays available).
create or replace function public.admin_manage_staff(p_user_id uuid,p_role text,
  p_active boolean,p_room_ids text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_type text; v_super boolean;
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required'; end if;
  if p_role not in ('admin','game_master') or p_active is null then
    raise exception 'Invalid staff role or status'; end if;
  select account_type, is_super_admin into v_type, v_super from public.staff_accounts
    where user_id=p_user_id for update;
  if not found then raise exception 'Staff account not found'; end if;
  if v_super and not (select ahaji_private.is_super_admin()) then
    raise exception 'Only a Super Admin can change a Super Admin account' using errcode = '42501'; end if;
  if v_type='operator' and p_role <> 'game_master' then
    raise exception 'Operator accounts cannot become Admin'; end if;
  select count(distinct x) into v_count
    from unnest(coalesce(p_room_ids,'{}'::text[])) x;
  if v_count <> coalesce(cardinality(p_room_ids),0) then
    raise exception 'Duplicate room assignment'; end if;
  if p_role='game_master' and exists (
    select 1 from unnest(coalesce(p_room_ids,'{}'::text[])) x
    where not exists(select 1 from public.rooms r where r.id=x and r.is_active)
  ) then raise exception 'An assigned room is unavailable'; end if;
  update public.staff_accounts set role=p_role,active=p_active where user_id=p_user_id;
  delete from public.staff_room_access where user_id=p_user_id;
  if p_role='game_master' then
    insert into public.staff_room_access(user_id,room_id)
      select p_user_id,x from unnest(coalesce(p_room_ids,'{}'::text[])) x;
  end if;
end;
$$;

-- Attribution for deleted accounts. No foreign key: the identity is gone.
create table public.deleted_staff_accounts (
  former_user_id uuid primary key,
  label text not null,
  role text not null,
  account_type text not null,
  login_name text,
  session_ids uuid[] not null default '{}',
  deleted_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz not null default now()
);
create index deleted_staff_accounts_deleted_by_idx on public.deleted_staff_accounts(deleted_by);
alter table public.deleted_staff_accounts enable row level security;
revoke all on public.deleted_staff_accounts from public, anon, authenticated;

create function public.admin_prepare_staff_deletion(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.staff_accounts%rowtype; v_email text; v_name text; v_label text;
  v_avatar text; v_sessions uuid[];
begin
  if not (select ahaji_private.is_super_admin()) then
    raise exception 'Super Admin required' using errcode = '42501'; end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot delete your own account' using errcode = '42501'; end if;
  select * into v from public.staff_accounts where user_id = p_user_id for update;
  if not found then
    -- A retry after the Auth deletion step failed or already succeeded.
    if exists(select 1 from public.deleted_staff_accounts where former_user_id = p_user_id) then
      return jsonb_build_object('user_id', p_user_id, 'already_prepared', true);
    end if;
    raise exception 'Staff account not found' using errcode = 'P0002';
  end if;
  if v.is_super_admin then
    raise exception 'A Super Admin account cannot be deleted from the app' using errcode = '42501'; end if;
  if v.operational_slot is not null then
    raise exception 'Reserved operational accounts cannot be deleted' using errcode = '42501'; end if;
  if v.role = 'admin' and not exists(select 1 from public.staff_accounts
      where role = 'admin' and active and user_id <> p_user_id) then
    raise exception 'At least one active Admin is required' using errcode = '42501'; end if;
  select u.email into v_email from auth.users u where u.id = p_user_id;
  select display_name, avatar_ref into v_name, v_avatar from public.staff_profiles where user_id = p_user_id;
  v_label := coalesce(nullif(trim(v_name),''),
    case when v.account_type = 'operator' then v.login_name || '@ahaji.com' else v_email end, 'حساب محذوف');
  select coalesce(array_agg(id order by created_at), '{}') into v_sessions
    from public.game_sessions where gm_user_id = p_user_id;
  insert into public.deleted_staff_accounts(former_user_id,label,role,account_type,login_name,session_ids,deleted_by)
    values (p_user_id, v_label, v.role, v.account_type, v.login_name, v_sessions, auth.uid())
    on conflict (former_user_id) do update set session_ids = excluded.session_ids, deleted_at = now();
  delete from public.staff_room_access where user_id = p_user_id;
  update public.staff_accounts set active = false where user_id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
  insert into public.admin_audit(actor_user_id,action,entity_type,entity_id,before_record,after_record)
    values (auth.uid(), 'delete_account', 'staff_account', p_user_id::text,
      jsonb_build_object('label', v_label, 'role', v.role, 'account_type', v.account_type,
        'login_name', v.login_name, 'sessions', cardinality(v_sessions)), null);
  return jsonb_build_object('user_id', p_user_id, 'avatar_ref', v_avatar, 'already_prepared', false);
end;
$$;

-- Labels for history rows whose Game Master account was deleted.
create function public.admin_deleted_staff()
returns table(former_user_id uuid, label text, session_ids uuid[], deleted_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.former_user_id, d.label, d.session_ids, d.deleted_at from public.deleted_staff_accounts d
  where (select ahaji_private.current_staff_role()) = 'admin' order by d.deleted_at desc;
$$;

drop function public.admin_staff_directory();
create function public.admin_staff_directory()
returns table(user_id uuid,email text,email_confirmed boolean,role text,
  active boolean,created_at timestamptz,room_ids text[],display_name text,
  avatar_ref text,account_type text,login_name text,operational_slot text,is_super_admin boolean)
language sql stable security definer set search_path = '' as $$
  select sa.user_id,
    case when sa.account_type='email' then u.email::text else null end,
    (sa.account_type='email' and u.email_confirmed_at is not null),
    sa.role,sa.active,sa.created_at,
    coalesce(array_agg(a.room_id order by a.room_id)
      filter(where a.room_id is not null),'{}'::text[]),
    coalesce(p.display_name,''),p.avatar_ref,sa.account_type,sa.login_name,sa.operational_slot,sa.is_super_admin
  from public.staff_accounts sa join auth.users u on u.id=sa.user_id
  left join public.staff_room_access a on a.user_id=sa.user_id
  left join public.staff_profiles p on p.user_id=sa.user_id
  where (select ahaji_private.current_staff_role())='admin'
  group by sa.user_id,u.email,u.email_confirmed_at,sa.role,sa.active,
    sa.created_at,p.display_name,p.avatar_ref,sa.account_type,sa.login_name,sa.operational_slot,sa.is_super_admin;
$$;

revoke all on function public.admin_manage_staff(uuid,text,boolean,text[]) from public, anon, authenticated;
revoke all on function public.admin_prepare_staff_deletion(uuid) from public, anon, authenticated;
revoke all on function public.admin_deleted_staff() from public, anon, authenticated;
revoke all on function public.admin_staff_directory() from public, anon, authenticated;
grant execute on function public.admin_manage_staff(uuid,text,boolean,text[]) to authenticated;
grant execute on function public.admin_prepare_staff_deletion(uuid) to authenticated;
grant execute on function public.admin_deleted_staff() to authenticated;
grant execute on function public.admin_staff_directory() to authenticated;
