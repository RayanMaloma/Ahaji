-- Product Owner decision (2026-10-23): an Admin may delete ANY room,
-- including one with past sessions. Deleting a room permanently removes the
-- room with its hints, media rows, room assignments, game sessions, and
-- session events. Storage objects are not touched (replaced and orphaned
-- objects are retained by policy). admin_audit keeps the room's last record,
-- the cascaded hint/media/assignment rows (per-row audit triggers), and one
-- summary row with what was removed.
--
-- The rule is enforced here, not inferred from foreign-key errors:
--   42501  caller is not an active Admin with a live session
--   P0002  room does not exist
--   22023  the typed confirmation does not equal the room's current name
--   55006  a game in the room is running or paused and not expired

create function public.admin_delete_room(p_room_id text, p_confirm_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms%rowtype;
  v_sessions integer; v_events integer; v_hints integer; v_media integer; v_access integer;
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required' using errcode = '42501'; end if;
  -- Lock the room first: new sessions need a key-share lock on it, so none
  -- can start until this transaction ends. Then lock its sessions so none
  -- can be started or resumed between the check and the delete.
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found' using errcode = 'P0002'; end if;
  if p_confirm_name is distinct from v_room.name then
    raise exception 'Confirmation does not match the room name' using errcode = '22023'; end if;
  perform 1 from public.game_sessions where room_id = p_room_id for update;
  if exists(select 1 from public.game_sessions where room_id = p_room_id
      and status in ('running','paused') and expires_at > now()) then
    raise exception 'A game is in progress in this room' using errcode = '55006'; end if;

  select count(*) into v_sessions from public.game_sessions where room_id = p_room_id;
  select count(*) into v_events from public.session_events where room_id = p_room_id;
  select count(*) into v_hints from public.room_hints where room_id = p_room_id;
  select count(*) into v_media from public.room_media where room_id = p_room_id;
  select count(*) into v_access from public.staff_room_access where room_id = p_room_id;

  delete from public.session_events where room_id = p_room_id;
  delete from public.game_sessions where room_id = p_room_id;
  -- Hints, media rows, and staff_room_access cascade from rooms.
  delete from public.rooms where id = p_room_id;

  insert into public.admin_audit(actor_user_id, action, entity_type, entity_id, before_record, after_record)
    values ((select auth.uid()), 'delete_with_history', 'rooms', p_room_id, to_jsonb(v_room),
      jsonb_build_object('sessions', v_sessions, 'events', v_events, 'hints', v_hints,
        'media', v_media, 'assignments', v_access));
  return jsonb_build_object('roomId', p_room_id, 'sessions', v_sessions, 'events', v_events,
    'hints', v_hints, 'media', v_media, 'assignments', v_access);
end;
$$;
revoke all on function public.admin_delete_room(text, text) from public, anon, authenticated;
grant execute on function public.admin_delete_room(text, text) to authenticated;

-- Rooms are deleted only through admin_delete_room.
drop policy rooms_admin_delete on public.rooms;
revoke delete on public.rooms from authenticated;

-- Hints and media follow the rooms visibility rule (20261012161918): an
-- assigned Game Master reads them while the room is active, or while they
-- still hold an open session in it after deactivation. Since 20261012161900
-- these two policies had no active-room condition at all.
create function ahaji_private.can_read_room_content(p_room_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select ahaji_private.current_staff_role()) = 'admin'
    or ((select ahaji_private.can_access_room(p_room_id)) and (
      exists(select 1 from public.rooms r where r.id = p_room_id and r.is_active)
      or exists(select 1 from public.game_sessions s where s.room_id = p_room_id
        and s.gm_user_id = (select auth.uid()) and s.status in ('idle','running','paused')))), false);
$$;
revoke all on function ahaji_private.can_read_room_content(text) from public, anon, authenticated;
grant execute on function ahaji_private.can_read_room_content(text) to authenticated;

drop policy hints_staff_select on public.room_hints;
create policy hints_staff_select on public.room_hints for select to authenticated
  using ((select ahaji_private.can_read_room_content(room_id)));
drop policy media_staff_select on public.room_media;
create policy media_staff_select on public.room_media for select to authenticated
  using ((select ahaji_private.can_read_room_content(room_id)));
