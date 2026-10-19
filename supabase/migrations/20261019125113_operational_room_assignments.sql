-- Operational accounts and room assignment.
-- Two shared Game Master accounts hold the venue and event rooms:
--   venue  = حساب محل أحاجي      events = حساب الفعاليات
-- An operational account is an ordinary game_master staff account marked
-- with a slot. Room access is still decided only by staff_room_access, which
-- can_access_room() and every session RPC already enforce. A room belongs to
-- at most one operational account; unassigned rooms are visible to Admin only.

alter table public.staff_accounts add column operational_slot text;
alter table public.staff_accounts add constraint staff_operational_slot_valid
  check (operational_slot is null or
    (operational_slot in ('venue','events') and role = 'game_master'));
create unique index staff_operational_slot_unique on public.staff_accounts(operational_slot)
  where operational_slot is not null;

-- One operational owner per room, whatever path writes the assignment.
create function ahaji_private.enforce_operational_room_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'staff_room_access' then
    if exists(select 1 from public.staff_accounts s where s.user_id = new.user_id
        and s.operational_slot is not null)
      and exists(select 1 from public.staff_room_access a
        join public.staff_accounts o on o.user_id = a.user_id
        where a.room_id = new.room_id and a.user_id <> new.user_id and o.operational_slot is not null) then
      raise exception 'Room already assigned to another operational account' using errcode = '23505';
    end if;
  elsif new.operational_slot is not null and new.operational_slot is distinct from old.operational_slot
    and exists(select 1 from public.staff_room_access a
      join public.staff_room_access b on b.room_id = a.room_id and b.user_id <> a.user_id
      join public.staff_accounts o on o.user_id = b.user_id
      where a.user_id = new.user_id and o.operational_slot is not null) then
    raise exception 'Room already assigned to another operational account' using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function ahaji_private.enforce_operational_room_owner() from public, anon, authenticated;
create trigger staff_room_access_operational_owner before insert or update on public.staff_room_access
  for each row execute function ahaji_private.enforce_operational_room_owner();
create trigger staff_accounts_operational_owner before update of operational_slot on public.staff_accounts
  for each row execute function ahaji_private.enforce_operational_room_owner();

create function ahaji_private.slot_label(p_slot text)
returns text language sql immutable set search_path = '' as $$
  select case p_slot when 'venue' then 'حساب محل أحاجي' when 'events' then 'حساب الفعاليات' end;
$$;
revoke all on function ahaji_private.slot_label(text) from public, anon, authenticated;

-- Marks a Game Master account as the venue or events account (or clears it).
-- An empty display name is filled with the account label.
create function public.admin_set_operational_slot(p_user_id uuid, p_slot text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_slot is not null and p_slot not in ('venue','events') then
    raise exception 'Invalid operational account' using errcode = '22023'; end if;
  select role into v_role from public.staff_accounts where user_id = p_user_id for update;
  if not found then raise exception 'Staff account not found' using errcode = 'P0002'; end if;
  if p_slot is not null and v_role <> 'game_master' then
    raise exception 'Operational accounts must be Game Masters' using errcode = '22023'; end if;
  if p_slot is not null then
    update public.staff_accounts set operational_slot = null
      where operational_slot = p_slot and user_id <> p_user_id;
  end if;
  update public.staff_accounts set operational_slot = p_slot where user_id = p_user_id;
  if p_slot is not null then
    insert into public.staff_profiles(user_id, display_name) values (p_user_id, ahaji_private.slot_label(p_slot))
      on conflict (user_id) do update set display_name = excluded.display_name
      where public.staff_profiles.display_name = '';
  end if;
end;
$$;

-- Assigns, moves, or unassigns one room in a single transaction.
--   p_slot           'venue' | 'events' | null (null = unassign)
--   p_expected_slot  the owner the Admin saw ('' = unassigned); a mismatch is
--                    a stale view and is rejected with 40001.
-- The room row is locked so concurrent Admin changes serialize. A room with a
-- running or paused game cannot change hands (55006) because the previous
-- account would lose control mid-game. Room data, media, and history are
-- never touched; only the operational assignment rows change.
create function public.admin_set_room_assignment(p_room_id text, p_slot text, p_expected_slot text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_current text; v_current_user uuid; v_target uuid;
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_slot is not null and p_slot not in ('venue','events') then
    raise exception 'Invalid operational account' using errcode = '22023'; end if;
  perform 1 from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found' using errcode = 'P0002'; end if;
  select s.operational_slot, s.user_id into v_current, v_current_user
    from public.staff_room_access a join public.staff_accounts s on s.user_id = a.user_id
    where a.room_id = p_room_id and s.operational_slot is not null;
  if coalesce(v_current,'') is distinct from coalesce(p_expected_slot,'') then
    raise exception 'Room assignment changed' using errcode = '40001'; end if;
  if v_current is not distinct from p_slot then
    return jsonb_build_object('room_id', p_room_id, 'slot', p_slot); end if;
  if v_current_user is not null and exists(select 1 from public.game_sessions g
      where g.room_id = p_room_id and g.gm_user_id = v_current_user
        and g.status in ('running','paused') and g.expires_at > now()) then
    raise exception 'Room has a game in progress' using errcode = '55006'; end if;
  if p_slot is not null then
    select user_id into v_target from public.staff_accounts where operational_slot = p_slot;
    if v_target is null then raise exception 'Operational account not set up' using errcode = 'P0002'; end if;
    perform 1 from public.rooms where id = p_room_id and is_active;
    if not found then raise exception 'An assigned room is unavailable' using errcode = '22023'; end if;
  end if;
  if v_current_user is not null then
    delete from public.staff_room_access where user_id = v_current_user and room_id = p_room_id;
  end if;
  if v_target is not null then
    insert into public.staff_room_access(user_id, room_id) values (v_target, p_room_id)
      on conflict do nothing;
  end if;
  return jsonb_build_object('room_id', p_room_id, 'slot', p_slot);
end;
$$;

-- Everything the room assignment page needs, in one Admin-only read.
create function public.admin_room_assignments()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when (select ahaji_private.current_staff_role()) = 'admin' then jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
        'slot', s.operational_slot, 'user_id', s.user_id, 'active', s.active,
        'login_name', s.login_name, 'display_name', coalesce(p.display_name, ''))
        order by s.operational_slot)
      from public.staff_accounts s left join public.staff_profiles p on p.user_id = s.user_id
      where s.operational_slot is not null), '[]'::jsonb),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object(
        'room_id', r.id, 'name', r.name, 'image_ref', r.background_ref, 'is_active', r.is_active,
        'slot', (select s.operational_slot from public.staff_room_access a
          join public.staff_accounts s on s.user_id = a.user_id
          where a.room_id = r.id and s.operational_slot is not null limit 1))
        order by r.display_order, r.id)
      from public.rooms r), '[]'::jsonb))
  else null end;
$$;

-- admin_manage_staff keeps its contract; operational accounts may not be
-- promoted to Admin while they hold a slot (enforced by the check constraint).
drop function public.admin_staff_directory();
create function public.admin_staff_directory()
returns table(user_id uuid,email text,email_confirmed boolean,role text,
  active boolean,created_at timestamptz,room_ids text[],display_name text,
  avatar_ref text,account_type text,login_name text,operational_slot text)
language sql stable security definer set search_path = '' as $$
  select sa.user_id,
    case when sa.account_type='email' then u.email::text else null end,
    (sa.account_type='email' and u.email_confirmed_at is not null),
    sa.role,sa.active,sa.created_at,
    coalesce(array_agg(a.room_id order by a.room_id)
      filter(where a.room_id is not null),'{}'::text[]),
    coalesce(p.display_name,''),p.avatar_ref,sa.account_type,sa.login_name,sa.operational_slot
  from public.staff_accounts sa join auth.users u on u.id=sa.user_id
  left join public.staff_room_access a on a.user_id=sa.user_id
  left join public.staff_profiles p on p.user_id=sa.user_id
  where (select ahaji_private.current_staff_role())='admin'
  group by sa.user_id,u.email,u.email_confirmed_at,sa.role,sa.active,
    sa.created_at,p.display_name,p.avatar_ref,sa.account_type,sa.login_name,sa.operational_slot;
$$;

revoke all on function public.admin_set_operational_slot(uuid,text) from public, anon, authenticated;
revoke all on function public.admin_set_room_assignment(text,text,text) from public, anon, authenticated;
revoke all on function public.admin_room_assignments() from public, anon, authenticated;
revoke all on function public.admin_staff_directory() from public, anon, authenticated;
grant execute on function public.admin_set_operational_slot(uuid,text) to authenticated;
grant execute on function public.admin_set_room_assignment(text,text,text) to authenticated;
grant execute on function public.admin_room_assignments() to authenticated;
grant execute on function public.admin_staff_directory() to authenticated;
