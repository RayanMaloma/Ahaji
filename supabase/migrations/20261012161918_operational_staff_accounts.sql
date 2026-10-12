-- An operator username is a login alias, never an email ownership claim.
-- Synthetic Auth addresses are an internal transport detail. Operator accounts
-- are permanently limited to Game Master and may never be promoted to Admin.
alter table public.staff_accounts
  add column account_type text not null default 'email',
  add column login_name text;
alter table public.staff_accounts add constraint staff_account_type_valid
  check (account_type in ('email','operator'));
alter table public.staff_accounts add constraint staff_operator_identity_valid
  check ((account_type='email' and login_name is null) or
    (account_type='operator' and role='game_master' and
      login_name ~ '^[a-z][a-z0-9._-]{2,63}$'));
create unique index staff_login_name_unique on public.staff_accounts(login_name)
  where login_name is not null;

create or replace function ahaji_private.current_staff_role()
returns text language sql stable security definer set search_path = '' as $$
  select sa.role
  from public.staff_accounts sa
  join auth.users u on u.id=sa.user_id
  join auth.sessions s on s.user_id=u.id
  where sa.user_id=(select auth.uid()) and sa.active and u.deleted_at is null
    and ((sa.account_type='email' and u.email_confirmed_at is not null)
      or (sa.account_type='operator' and sa.role='game_master'))
    and s.id=nullif((select auth.jwt()->>'session_id'),'')::uuid
  limit 1;
$$;

create or replace function public.admin_manage_staff(p_user_id uuid,p_role text,
  p_active boolean,p_room_ids text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_type text;
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required'; end if;
  if p_role not in ('admin','game_master') or p_active is null then
    raise exception 'Invalid staff role or status'; end if;
  select account_type into v_type from public.staff_accounts
    where user_id=p_user_id for update;
  if not found then raise exception 'Staff account not found'; end if;
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

-- Password resets invalidate database access for previous sessions immediately.
create function public.admin_revoke_operator_sessions(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required'; end if;
  if not exists(select 1 from public.staff_accounts
    where user_id=p_user_id and account_type='operator') then
    raise exception 'Operator account required'; end if;
  delete from auth.sessions where user_id=p_user_id;
end;
$$;
revoke all on function public.admin_revoke_operator_sessions(uuid)
  from public,anon,authenticated;
grant execute on function public.admin_revoke_operator_sessions(uuid)
  to authenticated;

drop function public.admin_staff_directory();
create function public.admin_staff_directory()
returns table(user_id uuid,email text,email_confirmed boolean,role text,
  active boolean,created_at timestamptz,room_ids text[],display_name text,
  avatar_ref text,account_type text,login_name text)
language sql stable security definer set search_path = '' as $$
  select sa.user_id,
    case when sa.account_type='email' then u.email::text else null end,
    (sa.account_type='email' and u.email_confirmed_at is not null),
    sa.role,sa.active,sa.created_at,
    coalesce(array_agg(a.room_id order by a.room_id)
      filter(where a.room_id is not null),'{}'::text[]),
    coalesce(p.display_name,''),p.avatar_ref,sa.account_type,sa.login_name
  from public.staff_accounts sa join auth.users u on u.id=sa.user_id
  left join public.staff_room_access a on a.user_id=sa.user_id
  left join public.staff_profiles p on p.user_id=sa.user_id
  where (select ahaji_private.current_staff_role())='admin'
  group by sa.user_id,u.email,u.email_confirmed_at,sa.role,sa.active,
    sa.created_at,p.display_name,p.avatar_ref,sa.account_type,sa.login_name;
$$;
revoke all on function public.admin_staff_directory()
  from public,anon,authenticated;
grant execute on function public.admin_staff_directory() to authenticated;

-- A disabled room admits no new sessions, but an existing game keeps its
-- pinned room configuration and can be recovered by its assigned GM.
drop trigger if exists rooms_prevent_active_archive on public.rooms;
drop function if exists ahaji_private.prevent_active_room_archive();
drop policy rooms_staff_select on public.rooms;
create policy rooms_staff_select on public.rooms for select to authenticated
using ((select ahaji_private.current_staff_role())='admin' or
  ((select ahaji_private.can_access_room(rooms.id)) and
    (is_active or exists(select 1 from public.game_sessions s
      where s.room_id=rooms.id and s.gm_user_id=(select auth.uid())
        and s.status in ('idle','running','paused')))));
