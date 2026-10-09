-- Run against a database after the foundation migration and seed.
-- Every trial write is rolled back; errors fail the check.
begin;

do $$
declare
  trial_session_id uuid;
begin
  if (select count(*) from public.rooms) <> 3 then
    raise exception 'Expected exactly three seeded rooms';
  end if;
  if (select count(*) from public.room_hints) <> 129 then
    raise exception 'Hint seed count differs from the approved files';
  end if;
  if (select count(*) from public.room_media) <> 10 then
    raise exception 'Media seed count differs from the room configuration';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('rooms', 'room_hints', 'room_media', 'game_sessions')
      and (
        not c.relrowsecurity
        or has_table_privilege('anon', c.oid, 'select')
        or has_table_privilege('anon', c.oid, 'insert')
        or has_table_privilege('authenticated', c.oid, 'select')
        or has_table_privilege('authenticated', c.oid, 'insert')
        or not has_table_privilege('service_role', c.oid, 'select')
      )
  ) then
    raise exception 'Table grants or RLS differ from the deny-by-default contract';
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
