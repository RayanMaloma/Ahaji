-- Pending staff invitations with an explicit activation step.
-- An invited identity holds an inactive staff record and its room assignments
-- until the invitee has confirmed the email link, set a password, and called
-- accept_staff_invitation() from a live session. Passwords live only in
-- Supabase Auth; this schema never stores or returns one.

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  display_name text not null default '',
  role text not null,
  room_ids text[] not null default '{}',
  status text not null default 'pending',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_sent_at timestamptz not null default now(),
  send_count integer not null default 1,
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  constraint staff_invitation_email_valid check (email = lower(email) and
    length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint staff_invitation_name_valid check (length(display_name) <= 80),
  constraint staff_invitation_role_valid check (role in ('admin','game_master')),
  constraint staff_invitation_status_valid check (status in ('pending','accepted','revoked','expired')),
  constraint staff_invitation_send_count_valid check (send_count between 1 and 20)
);
create unique index staff_invitations_one_pending on public.staff_invitations(email)
  where status = 'pending';
create index staff_invitations_user_idx on public.staff_invitations(user_id);
create index staff_invitations_invited_by_idx on public.staff_invitations(invited_by);
create index staff_invitations_revoked_by_idx on public.staff_invitations(revoked_by);
alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from public, anon, authenticated;
-- No policies: browser access is only through the functions below.
create trigger audit_staff_invitations after insert or update or delete on public.staff_invitations
  for each row execute function ahaji_private.audit_staff_and_content();

create function ahaji_private.invitation_lifetime()
returns interval language sql immutable set search_path = '' as $$ select interval '24 hours' $$;
revoke all on function ahaji_private.invitation_lifetime() from public, anon, authenticated;

create function ahaji_private.require_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function ahaji_private.require_admin() from public, anon, authenticated;
grant execute on function ahaji_private.require_admin() to authenticated;

-- True when Auth holds a password hash for the identity. The hash is never returned.
create function ahaji_private.has_password(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select u.encrypted_password is not null and u.encrypted_password <> ''
    from auth.users u where u.id = p_user_id), false);
$$;
revoke all on function ahaji_private.has_password(uuid) from public, anon, authenticated;

-- Decides how the trusted invitation endpoint may proceed for an email.
--   new      no Auth identity: invite
--   reinvite unconfirmed identity without password: Auth can resend
--   recreate confirmed identity without password, never activated: replace
create function public.admin_prepare_staff_invitation(p_email text)
returns table(user_id uuid, mode text)
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(coalesce(p_email,''))); v_user auth.users%rowtype;
  v_staff public.staff_accounts%rowtype; v_has_staff boolean;
begin
  perform ahaji_private.require_admin();
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_email) > 254 then
    raise exception 'Invalid email' using errcode = '22023'; end if;
  if exists(select 1 from public.staff_invitations i where i.email = v_email
    and i.status = 'pending' and i.expires_at > now() and i.user_id is not null) then
    raise exception 'Invitation already pending' using errcode = '23505'; end if;
  select * into v_user from auth.users u where lower(u.email) = v_email and u.deleted_at is null
    order by u.created_at limit 1;
  if not found then return query select null::uuid, 'new'::text; return; end if;
  select * into v_staff from public.staff_accounts s where s.user_id = v_user.id;
  v_has_staff := found;
  if (v_has_staff and (v_staff.active or v_staff.account_type <> 'email'))
    or ahaji_private.has_password(v_user.id)
    or exists(select 1 from public.staff_invitations i
      where i.user_id = v_user.id and i.status = 'accepted') then
    raise exception 'Staff account already exists' using errcode = '23505'; end if;
  return query select v_user.id,
    case when v_user.email_confirmed_at is null then 'reinvite' else 'recreate' end;
end;
$$;

-- Records a pending invitation after Auth has issued the link. The staff record
-- stays inactive; room assignments are validated now and kept for activation.
create function public.admin_record_staff_invitation(p_user_id uuid, p_email text,
  p_display_name text, p_role text, p_room_ids text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(coalesce(p_email,''))); v_name text := trim(coalesce(p_display_name,''));
  v_rooms text[] := coalesce(p_room_ids,'{}'::text[]); v_id uuid; v_type text; v_active boolean;
begin
  perform ahaji_private.require_admin();
  if p_role not in ('admin','game_master') then raise exception 'Invalid staff role' using errcode = '22023'; end if;
  if length(v_name) > 80 then raise exception 'Name too long' using errcode = '22023'; end if;
  if (select count(distinct x) from unnest(v_rooms) x) <> cardinality(v_rooms) then
    raise exception 'Duplicate room assignment' using errcode = '22023'; end if;
  if p_role = 'game_master' and exists(select 1 from unnest(v_rooms) x
    where not exists(select 1 from public.rooms r where r.id = x and r.is_active)) then
    raise exception 'An assigned room is unavailable' using errcode = '22023'; end if;
  if not exists(select 1 from auth.users u where u.id = p_user_id and lower(u.email) = v_email
    and u.deleted_at is null) then raise exception 'Identity mismatch' using errcode = '22023'; end if;
  if ahaji_private.has_password(p_user_id) then
    raise exception 'Staff account already exists' using errcode = '23505'; end if;
  select account_type, active into v_type, v_active from public.staff_accounts
    where user_id = p_user_id for update;
  if found and (v_type <> 'email' or v_active) then
    raise exception 'Staff account already exists' using errcode = '23505'; end if;
  if not found then
    insert into public.staff_accounts(user_id, role, active, account_type)
      values (p_user_id, p_role, false, 'email');
  else
    update public.staff_accounts set role = p_role, active = false where user_id = p_user_id;
  end if;
  delete from public.staff_room_access where user_id = p_user_id;
  if p_role = 'game_master' then
    insert into public.staff_room_access(user_id, room_id) select p_user_id, x from unnest(v_rooms) x;
  end if;
  insert into public.staff_profiles(user_id, display_name) values (p_user_id, v_name)
    on conflict (user_id) do update set display_name = excluded.display_name;
  -- A replaced identity's earlier invitation is superseded, never reused.
  update public.staff_invitations set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
    where email = v_email and status = 'pending';
  insert into public.staff_invitations(user_id, email, display_name, role, room_ids, invited_by, expires_at)
    values (p_user_id, v_email, v_name, p_role,
      case when p_role = 'game_master' then v_rooms else '{}'::text[] end,
      auth.uid(), now() + ahaji_private.invitation_lifetime())
    returning id into v_id;
  return v_id;
end;
$$;

-- Extends a pending or expired invitation and says how the endpoint must resend.
create function public.admin_refresh_staff_invitation(p_invitation_id uuid)
returns table(user_id uuid, email text, display_name text, role text, room_ids text[], mode text)
language plpgsql security definer set search_path = '' as $$
declare v public.staff_invitations%rowtype; v_confirmed timestamptz;
begin
  perform ahaji_private.require_admin();
  select * into v from public.staff_invitations i where i.id = p_invitation_id for update;
  if not found or v.status not in ('pending','expired') or v.user_id is null then
    raise exception 'Invitation not resendable' using errcode = 'P0002'; end if;
  if v.last_sent_at > now() - interval '60 seconds' then
    raise exception 'Resend too soon' using errcode = '55000'; end if;
  if v.send_count >= 20 then raise exception 'Resend limit reached' using errcode = '55000'; end if;
  if ahaji_private.has_password(v.user_id) then
    raise exception 'Invitation already in use' using errcode = '55000'; end if;
  select u.email_confirmed_at into v_confirmed from auth.users u where u.id = v.user_id;
  update public.staff_invitations set status = 'pending', last_sent_at = now(),
    send_count = send_count + 1, expires_at = now() + ahaji_private.invitation_lifetime()
    where id = v.id;
  return query select v.user_id, v.email, v.display_name, v.role, v.room_ids,
    case when v_confirmed is null then 'reinvite' else 'recreate' end;
end;
$$;

create function public.admin_revoke_staff_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.staff_invitations%rowtype;
begin
  perform ahaji_private.require_admin();
  select * into v from public.staff_invitations i where i.id = p_invitation_id for update;
  if not found or v.status not in ('pending','expired') then
    raise exception 'Invitation not revocable' using errcode = 'P0002'; end if;
  update public.staff_invitations set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
    where id = v.id;
  if v.user_id is not null then
    update public.staff_accounts set active = false where user_id = v.user_id and account_type = 'email';
    delete from auth.sessions where user_id = v.user_id;
  end if;
end;
$$;

-- The signed-in invitee's own latest invitation, for routing to activation.
create function public.my_staff_invitation()
returns table(status text, role text, display_name text, expires_at timestamptz,
  email_confirmed boolean, password_set boolean)
language sql stable security definer set search_path = '' as $$
  select case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
    sa.role, i.display_name, i.expires_at, u.email_confirmed_at is not null,
    ahaji_private.has_password(i.user_id)
  from public.staff_invitations i
  join auth.users u on u.id = i.user_id
  left join public.staff_accounts sa on sa.user_id = i.user_id
  where i.user_id = (select auth.uid())
  order by i.created_at desc limit 1;
$$;

-- Activation: live session, confirmed email, password set, unexpired invite.
create function public.accept_staff_invitation()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v public.staff_invitations%rowtype; v_role text;
begin
  if v_uid is null or not exists(select 1 from auth.sessions s where s.user_id = v_uid
    and s.id = nullif((select auth.jwt()->>'session_id'),'')::uuid) then
    raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into v from public.staff_invitations i where i.user_id = v_uid
    order by i.created_at desc limit 1 for update;
  if not found or v.status in ('revoked','accepted') then
    return jsonb_build_object('status', coalesce(v.status, 'none')); end if;
  if v.status = 'expired' or v.expires_at <= now() then
    update public.staff_invitations set status = 'expired' where id = v.id;
    return jsonb_build_object('status', 'expired'); end if;
  if not exists(select 1 from auth.users u where u.id = v_uid and u.deleted_at is null
    and u.email_confirmed_at is not null and lower(u.email) = v.email) then
    return jsonb_build_object('status', 'unconfirmed'); end if;
  if not ahaji_private.has_password(v_uid) then
    return jsonb_build_object('status', 'password_required'); end if;
  update public.staff_accounts set active = true
    where user_id = v_uid and account_type = 'email' and not active
    returning role into v_role;
  if v_role is null then return jsonb_build_object('status', 'none'); end if;
  update public.staff_invitations set status = 'accepted', accepted_at = now() where id = v.id;
  return jsonb_build_object('status', 'accepted', 'role', v_role);
end;
$$;

-- Activation can only come from the invitee; Admins cannot switch a pending
-- account on before its password is set.
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
  if p_active and exists(select 1 from public.staff_invitations i where i.user_id=p_user_id
    and i.status in ('pending','expired','revoked')
    and not exists(select 1 from public.staff_invitations a where a.user_id=p_user_id and a.status='accepted')) then
    raise exception 'Invitation not activated'; end if;
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

drop function public.admin_staff_directory();
create function public.admin_staff_directory()
returns table(user_id uuid,email text,email_confirmed boolean,role text,
  active boolean,created_at timestamptz,room_ids text[],display_name text,
  avatar_ref text,account_type text,login_name text,invitation_id uuid,
  invitation_status text,invitation_expires_at timestamptz,invitation_sent_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select sa.user_id,
    case when sa.account_type='email' then u.email::text else null end,
    (sa.account_type='email' and u.email_confirmed_at is not null),
    sa.role,sa.active,sa.created_at,
    coalesce(array_agg(a.room_id order by a.room_id)
      filter(where a.room_id is not null),'{}'::text[]),
    coalesce(p.display_name,''),p.avatar_ref,sa.account_type,sa.login_name,
    i.id,
    case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end,
    i.expires_at,i.last_sent_at
  from public.staff_accounts sa join auth.users u on u.id=sa.user_id
  left join public.staff_room_access a on a.user_id=sa.user_id
  left join public.staff_profiles p on p.user_id=sa.user_id
  left join lateral (select x.id,x.status,x.expires_at,x.last_sent_at
    from public.staff_invitations x where x.user_id=sa.user_id
    order by x.created_at desc limit 1) i on true
  where (select ahaji_private.current_staff_role())='admin'
  group by sa.user_id,u.email,u.email_confirmed_at,sa.role,sa.active,
    sa.created_at,p.display_name,p.avatar_ref,sa.account_type,sa.login_name,
    i.id,i.status,i.expires_at,i.last_sent_at;
$$;

revoke all on function public.admin_prepare_staff_invitation(text) from public, anon, authenticated;
revoke all on function public.admin_record_staff_invitation(uuid,text,text,text,text[]) from public, anon, authenticated;
revoke all on function public.admin_refresh_staff_invitation(uuid) from public, anon, authenticated;
revoke all on function public.admin_revoke_staff_invitation(uuid) from public, anon, authenticated;
revoke all on function public.my_staff_invitation() from public, anon, authenticated;
revoke all on function public.accept_staff_invitation() from public, anon, authenticated;
revoke all on function public.admin_manage_staff(uuid,text,boolean,text[]) from public, anon, authenticated;
revoke all on function public.admin_staff_directory() from public, anon, authenticated;
grant execute on function public.admin_prepare_staff_invitation(text) to authenticated;
grant execute on function public.admin_record_staff_invitation(uuid,text,text,text,text[]) to authenticated;
grant execute on function public.admin_refresh_staff_invitation(uuid) to authenticated;
grant execute on function public.admin_revoke_staff_invitation(uuid) to authenticated;
grant execute on function public.my_staff_invitation() to authenticated;
grant execute on function public.accept_staff_invitation() to authenticated;
grant execute on function public.admin_manage_staff(uuid,text,boolean,text[]) to authenticated;
grant execute on function public.admin_staff_directory() to authenticated;
