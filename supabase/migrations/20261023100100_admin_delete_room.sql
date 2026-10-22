-- Product Owner decision (2026-10-23): an Admin may delete ANY room,
-- including one with past sessions. Deleting a room permanently removes the
-- room with its hints, media rows, room assignments, game sessions, and
-- session events. admin_audit keeps the room's last record, the cascaded
-- hint/media/assignment rows (per-row audit triggers), and one summary row
-- with what was removed.
--
-- The rule is enforced here, not inferred from foreign-key errors:
--   42501  caller is not an active Admin with a live session
--   P0002  room does not exist
--   22023  the typed confirmation does not equal the room's current name
--   55006  a game in the room is running or paused and not expired
--
-- Storage: SQL cannot remove Storage bytes, so the deletion queues the files
-- the room exclusively owned in room_asset_cleanup, chosen by the server:
-- objects in the room's own room-assets/<room_id>/ folder that no remaining
-- room or media row references. A file still referenced elsewhere is never
-- queued, and the Storage delete policy refuses any referenced file however
-- its path reaches the API. The Admin client removes queued files through
-- the Storage API and reports back; a file counts as removed only once its
-- storage.objects row is gone. Failures stay queued for retry.

-- A room-assets object is in use while any room image or media row points
-- at it, whichever room that row belongs to.
create function ahaji_private.room_asset_in_use(p_object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.rooms r
      where r.thumbnail_ref = 'storage://room-assets/' || p_object_name
         or r.background_ref = 'storage://room-assets/' || p_object_name)
    or exists(select 1 from public.room_media m
      where m.asset_ref = 'storage://room-assets/' || p_object_name);
$$;
revoke all on function ahaji_private.room_asset_in_use(text) from public, anon, authenticated;
grant execute on function ahaji_private.room_asset_in_use(text) to authenticated;

-- Files of deleted rooms awaiting removal from Storage. Written only by
-- trusted functions; Admins may read it.
create table public.room_asset_cleanup (
  object_name text primary key,
  room_id text not null,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  completed_at timestamptz,
  outcome text check (outcome in ('removed', 'kept_in_use'))
);
alter table public.room_asset_cleanup enable row level security;
revoke all on public.room_asset_cleanup from public, anon, authenticated;
grant select on public.room_asset_cleanup to authenticated;
create policy room_asset_cleanup_admin_read on public.room_asset_cleanup for select to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin');

create function public.admin_delete_room(p_room_id text, p_confirm_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms%rowtype;
  v_sessions integer; v_events integer; v_hints integer; v_media integer; v_access integer;
  v_files integer;
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

  -- With this room's rows gone, queue its folder's files that nothing else
  -- references. Files of other folders are never considered.
  insert into public.room_asset_cleanup(object_name, room_id)
    select o.name, p_room_id from storage.objects o
    where o.bucket_id = 'room-assets' and (storage.foldername(o.name))[1] = p_room_id
      and not ahaji_private.room_asset_in_use(o.name)
    on conflict (object_name) do nothing;
  get diagnostics v_files = row_count;

  insert into public.admin_audit(actor_user_id, action, entity_type, entity_id, before_record, after_record)
    values ((select auth.uid()), 'delete_with_history', 'rooms', p_room_id, to_jsonb(v_room),
      jsonb_build_object('sessions', v_sessions, 'events', v_events, 'hints', v_hints,
        'media', v_media, 'assignments', v_access, 'storageQueued', v_files));
  return jsonb_build_object('roomId', p_room_id, 'sessions', v_sessions, 'events', v_events,
    'hints', v_hints, 'media', v_media, 'assignments', v_access, 'storageQueued', v_files);
end;
$$;
revoke all on function public.admin_delete_room(text, text) from public, anon, authenticated;
grant execute on function public.admin_delete_room(text, text) to authenticated;

-- Rooms are deleted only through admin_delete_room.
drop policy rooms_admin_delete on public.rooms;
revoke delete on public.rooms from authenticated;

-- Pending files for the Admin client to remove (oldest first, bounded).
-- Anything referenced again since it was queued is closed as kept.
create function public.admin_room_asset_cleanup_pending()
returns table(object_name text, room_id text, attempts integer)
language plpgsql security definer set search_path = '' as $$
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required' using errcode = '42501'; end if;
  update public.room_asset_cleanup c set completed_at = now(), outcome = 'kept_in_use'
    where c.completed_at is null and ahaji_private.room_asset_in_use(c.object_name);
  return query select c.object_name, c.room_id, c.attempts from public.room_asset_cleanup c
    where c.completed_at is null and c.attempts < 10
    order by c.queued_at, c.object_name limit 100;
end;
$$;
revoke all on function public.admin_room_asset_cleanup_pending() from public, anon, authenticated;
grant execute on function public.admin_room_asset_cleanup_pending() to authenticated;

-- Records a removal attempt. p_results: [{"name": text, "error": text|null}].
-- The client's claim is not trusted: a queued file is completed only when
-- its storage.objects row no longer exists; otherwise the attempt counts
-- against it with the reported (or a default) error. Unknown names are
-- ignored.
create function public.admin_record_room_asset_cleanup(p_results jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_name text; v_removed integer := 0; v_failed integer := 0;
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required' using errcode = '42501'; end if;
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'Results must be an array' using errcode = '22023'; end if;
  for v_item in select value from jsonb_array_elements(p_results) loop
    v_name := v_item->>'name';
    continue when v_name is null or not exists(select 1 from public.room_asset_cleanup
      where object_name = v_name and completed_at is null);
    if not exists(select 1 from storage.objects where bucket_id = 'room-assets' and name = v_name) then
      update public.room_asset_cleanup set completed_at = now(), outcome = 'removed', last_error = null
        where object_name = v_name;
      v_removed := v_removed + 1;
    else
      update public.room_asset_cleanup set attempts = attempts + 1,
          last_error = left(coalesce(nullif(v_item->>'error', ''), 'Object still present'), 500)
        where object_name = v_name;
      v_failed := v_failed + 1;
    end if;
  end loop;
  return jsonb_build_object('removed', v_removed, 'failed', v_failed);
end;
$$;
revoke all on function public.admin_record_room_asset_cleanup(jsonb) from public, anon, authenticated;
grant execute on function public.admin_record_room_asset_cleanup(jsonb) to authenticated;

-- Admins may delete only room-assets objects nothing references, so a shared
-- or in-use file survives any client path, including staged-upload cleanup.
drop policy room_assets_admin_delete on storage.objects;
create policy room_assets_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'room-assets' and (select ahaji_private.current_staff_role()) = 'admin'
  and not ahaji_private.room_asset_in_use(name));

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
