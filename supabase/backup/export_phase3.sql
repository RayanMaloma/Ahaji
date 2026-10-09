-- One-row JSON export of every Phase 3 application table.
-- Run only against project gbhleqizxcmxmutgcjon through authorized SQL access.
-- Auth users and Storage objects must be checked separately before claiming
-- this is a complete application backup.
select jsonb_build_object(
  'format', 'ahaji-phase3-snapshot-v1',
  'project_ref', 'gbhleqizxcmxmutgcjon',
  'captured_at', clock_timestamp(),
  'migration_version', (
    select max(version) from supabase_migrations.schema_migrations
  ),
  'platform_inventory', jsonb_build_object(
    'auth_users', (select count(*) from auth.users),
    'storage_buckets', (select count(*) from storage.buckets),
    'storage_objects', (select count(*) from storage.objects)
  ),
  'tables', jsonb_build_object(
    'rooms', coalesce((select jsonb_agg(to_jsonb(r) order by r.id)
      from public.rooms r), '[]'::jsonb),
    'room_hints', coalesce((select jsonb_agg(to_jsonb(h) order by h.room_id, h.display_order)
      from public.room_hints h), '[]'::jsonb),
    'room_media', coalesce((select jsonb_agg(to_jsonb(m) order by m.room_id, m.kind, m.display_order)
      from public.room_media m), '[]'::jsonb),
    'game_sessions', coalesce((select jsonb_agg(to_jsonb(s) order by s.id)
      from public.game_sessions s), '[]'::jsonb)
  )
) as snapshot;
