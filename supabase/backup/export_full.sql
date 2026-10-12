-- Project gbhleqizxcmxmutgcjon only. Save the single JSON value in ignored,
-- access-controlled backups/. Auth identities are a mapping, not an Auth backup.
-- Storage metadata is included; object bytes require backup-room-assets.mjs.
select jsonb_build_object(
  'format','ahaji-full-snapshot-v1',
  'project_ref','gbhleqizxcmxmutgcjon',
  'captured_at',clock_timestamp(),
  'migration_versions',(select jsonb_agg(version order by version)
    from supabase_migrations.schema_migrations),
  'auth_identity_map',coalesce((select jsonb_agg(jsonb_build_object(
    'id',u.id,'email',u.email,'confirmed',u.email_confirmed_at is not null,
    'deleted',u.deleted_at is not null) order by u.id) from auth.users u),'[]'::jsonb),
  'platform_inventory',jsonb_build_object(
    'auth_users',(select count(*) from auth.users),
    'storage_buckets',(select count(*) from storage.buckets),
    'storage_objects',(select count(*) from storage.objects where bucket_id='room-assets')),
  'storage_objects',coalesce((select jsonb_agg(jsonb_build_object(
    'bucket_id',o.bucket_id,'name',o.name,'metadata',o.metadata) order by o.name)
    from storage.objects o where o.bucket_id='room-assets'),'[]'::jsonb),
  'tables',jsonb_build_object(
    'rooms',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.rooms r),'[]'::jsonb),
    'room_hints',coalesce((select jsonb_agg(to_jsonb(h) order by h.room_id,h.display_order) from public.room_hints h),'[]'::jsonb),
    'room_media',coalesce((select jsonb_agg(to_jsonb(m) order by m.room_id,m.kind,m.display_order) from public.room_media m),'[]'::jsonb),
    'game_sessions',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.game_sessions s),'[]'::jsonb),
    'session_events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.session_events e),'[]'::jsonb),
    'staff_accounts',coalesce((select jsonb_agg(to_jsonb(a) order by a.user_id) from public.staff_accounts a),'[]'::jsonb),
    'staff_room_access',coalesce((select jsonb_agg(to_jsonb(a) order by a.user_id,a.room_id) from public.staff_room_access a),'[]'::jsonb),
    'admin_audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.admin_audit a),'[]'::jsonb)
  )
) as snapshot;
