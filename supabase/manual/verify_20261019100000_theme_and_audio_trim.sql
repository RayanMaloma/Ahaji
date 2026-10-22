-- Read-only fingerprint of every object migration 20261019100000
-- (theme_and_audio_trim) creates or replaces. Run it on the live project and
-- on a disposable database built from supabase/migrations/; the migration's
-- effect is fully present live only when every row matches. Writes nothing.
with fn(sig) as (values
  ('ahaji_private.room_presentation_config(text)'),
  ('public.create_game_session(text)'),
  ('public.game_session_command(text,uuid,text,jsonb)'),
  ('public.admin_save_room_draft(text,bigint,jsonb,jsonb,jsonb)')
), items as (
  select 'column ' || column_name as item,
    md5(concat_ws('|', data_type, is_nullable, column_default)) as fingerprint
  from information_schema.columns
  where table_schema = 'public' and table_name = 'room_media'
    and column_name in ('trim_start_ms', 'trim_end_ms')
  union all
  select 'constraint ' || conrelid::regclass || '.' || conname,
    md5(pg_get_constraintdef(oid))
  from pg_constraint
  where conrelid in ('public.room_media'::regclass, 'public.session_events'::regclass)
    and (conname in ('room_media_trim_order', 'room_media_kind_check',
      'room_media_trim_sound_only', 'session_events_event_type_check')
      or (contype = 'c' and pg_get_constraintdef(oid) like '%trim_%'))
  union all
  select 'index ' || indexrelid::regclass, md5(pg_get_indexdef(indexrelid))
  from pg_index where indexrelid = to_regclass('public.room_media_one_theme_sound_per_room')
  union all
  select 'function ' || fn.sig,
    coalesce(md5(concat_ws('|', p.prosrc, p.prosecdef, array_to_string(p.proconfig, ','),
      pg_get_function_result(p.oid), p.provolatile,
      (select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a))), 'MISSING')
  from fn left join pg_proc p on p.oid = to_regprocedure(fn.sig)
)
select item, fingerprint from items order by item;
