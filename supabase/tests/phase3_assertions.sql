-- Run after all migrations, on a freshly seeded or a restored disposable database.
-- Every trial write is rolled back; errors fail the check.
begin;

do $$
declare
  trial_session_id uuid;
begin
  -- The three permanent rooms always exist. On a freshly seeded database
  -- (no other rooms yet) the seed must match the approved files exactly;
  -- a restored or live database may hold more rooms and Admin edits.
  if (select count(*) from public.rooms where id in ('anbar','haram','saleh')) <> 3 then
    raise exception 'A permanent room is missing';
  end if;
  if not exists (select 1 from public.rooms where id not in ('anbar','haram','saleh')) then
    if (select count(*) from public.room_hints) <> 129 then
      raise exception 'Hint seed count differs from the approved files';
    end if;
    if (select count(*) from public.room_media) <> 10 then
      raise exception 'Media seed count differs from the room configuration';
    end if;
    if (select name from public.rooms where id = 'anbar') <> 'عنبر 23' then
      raise exception 'Seeded anbar name is not عنبر 23';
    end if;
  end if;

  -- Deny by default: every public table has RLS and anon holds no table
  -- privilege at all. Since Phase 4, authenticated staff reach room content
  -- only through admin/room RLS policies, and sessions only by reading;
  -- session writes go through game_session_command.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (not c.relrowsecurity
        or has_table_privilege('anon', c.oid, 'select')
        or has_table_privilege('anon', c.oid, 'insert')
        or has_table_privilege('anon', c.oid, 'update')
        or has_table_privilege('anon', c.oid, 'delete'))
  ) then
    raise exception 'A public table lacks RLS or is exposed to anon';
  end if;
  if not has_table_privilege('authenticated', 'public.game_sessions', 'select')
    or has_table_privilege('authenticated', 'public.game_sessions', 'insert')
    or has_table_privilege('authenticated', 'public.game_sessions', 'update')
    or has_table_privilege('authenticated', 'public.game_sessions', 'delete')
  then
    raise exception 'Clients can write game sessions directly';
  end if;
  if exists (
    select 1 from (values ('public.room_hints'), ('public.room_media')) t(name)
    where not (has_table_privilege('authenticated', t.name, 'select')
      and has_table_privilege('authenticated', t.name, 'insert')
      and has_table_privilege('authenticated', t.name, 'update')
      and has_table_privilege('authenticated', t.name, 'delete'))
  ) or not has_table_privilege('authenticated', 'public.rooms', 'select')
    -- Rooms are deleted only through admin_delete_room.
    or has_table_privilege('authenticated', 'public.rooms', 'delete')
  then
    raise exception 'Room content privileges differ from the Admin RLS contract';
  end if;
  if exists (
    select 1 from (values ('public.rooms'), ('public.room_hints'),
      ('public.room_media'), ('public.game_sessions')) t(name)
    where not has_table_privilege('service_role', t.name, 'select')
  ) then
    raise exception 'Service role cannot read application tables';
  end if;
  if has_function_privilege('anon', 'public.touch_updated_at()', 'execute')
    or has_function_privilege('authenticated', 'public.touch_updated_at()', 'execute')
  then
    raise exception 'Timestamp function is exposed to a client role';
  end if;
  if (
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('rooms', 'room_hints', 'room_media', 'game_sessions')
      and t.tgname like '%_touch_updated_at' and t.tgenabled = 'O'
  ) <> 4 then
    raise exception 'Expected updated_at triggers on every application table';
  end if;

  begin
    insert into public.rooms (id, name, thumbnail_ref, background_ref,
      default_duration_seconds) values ('test_invalid_duration', 'Test', 'x', 'y', 6000);
    raise exception 'Invalid duration was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.room_hints (room_id, body, display_order)
      values ('missing_room', 'Test', 0);
    raise exception 'Missing room foreign key was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.room_hints (room_id, body, display_order)
      values ('anbar', 'Duplicate order', 0);
    raise exception 'Duplicate hint position was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.room_media (room_id, kind, asset_ref, display_order)
      values ('anbar', 'gm_image', 'missing-label.png', 100);
    raise exception 'Image without label was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.room_media (room_id, kind, asset_ref, display_order)
      values ('anbar', 'hint_sound', 'second.mp3', 100);
    raise exception 'Second hint sound was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.game_sessions (room_id, state)
      values ('anbar', '[]'::jsonb);
    raise exception 'Non-object session state was accepted';
  exception when check_violation then null;
  end;

  insert into public.game_sessions (room_id, state)
    values ('anbar', '{"status":"idle"}'::jsonb)
    returning id into trial_session_id;
  if not exists (select 1 from public.game_sessions where id = trial_session_id) then
    raise exception 'Valid session insert was not readable';
  end if;
end;
$$;

rollback;
select 'phase3 assertions passed' as result;
