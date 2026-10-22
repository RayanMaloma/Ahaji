-- Storage cleanup after room deletion. Disposable PostgreSQL 17 only;
-- self-contained and rolled back. storage.objects is the local model from
-- supabase/backup/local_full_bootstrap.sql, so this checks which files are
-- queued and which deletes the policy allows, not Storage byte removal.
begin;
grant select, insert, update, delete on storage.objects to authenticated;
do $qa$
declare
  admin_id uuid := '60000000-0000-4000-8000-0000000000a1'; admin_sid uuid := gen_random_uuid();
  gm_id uuid := '60000000-0000-4000-8000-0000000000b1'; gm_sid uuid := gen_random_uuid();
  result jsonb; queued text[]; n integer; denied boolean; code text;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (admin_id,'qa-admin-storage@test.invalid',now()),(gm_id,'qa-gm-storage@test.invalid',now());
  insert into auth.sessions(id,user_id) values (admin_sid,admin_id),(gm_sid,gm_id);
  insert into public.staff_accounts(user_id,role,active) values (admin_id,'admin',true),(gm_id,'game_master',true);
  insert into storage.buckets(id,name,public) values ('room-assets','room-assets',true) on conflict (id) do nothing;

  -- Room A owns a1 (used), a2 (leftover, unused), and a3, which room B also
  -- uses. Room B owns b1 and also points at A's a4 as its image.
  insert into public.rooms(id,name,default_duration_seconds,is_active,display_order,thumbnail_ref,background_ref) values
    ('qa_sc_a','غرفة أ',3600,true,95,'storage://room-assets/qa_sc_a/a1.png','storage://room-assets/qa_sc_a/a1.png'),
    ('qa_sc_b','غرفة ب',3600,true,96,'storage://room-assets/qa_sc_a/a4.png','storage://room-assets/qa_sc_a/a4.png');
  insert into public.room_media(room_id,kind,label,asset_ref,display_order) values
    ('qa_sc_a','gm_sound','صوت أ','storage://room-assets/qa_sc_a/a3.mp3',0),
    ('qa_sc_b','gm_sound','صوت مشترك','storage://room-assets/qa_sc_a/a3.mp3',0),
    ('qa_sc_b','gm_image','صورة ب','storage://room-assets/qa_sc_b/b1.png',0);
  insert into storage.objects(bucket_id,name) values
    ('room-assets','qa_sc_a/a1.png'),('room-assets','qa_sc_a/a2.png'),('room-assets','qa_sc_a/a3.mp3'),
    ('room-assets','qa_sc_a/a4.png'),('room-assets','qa_sc_b/b1.png'),('room-assets','qa_sc_ab/x.png');

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  execute 'set local role authenticated';

  -- In-use files cannot be deleted through Storage by any path, before or
  -- after the deletion; unused ones can (e.g. staged-upload cleanup).
  delete from storage.objects where bucket_id='room-assets' and name='qa_sc_a/a1.png';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Deleted a file its room still uses'; end if;

  result := public.admin_delete_room('qa_sc_a','غرفة أ');
  if (result->>'storageQueued')::integer <> 2 then raise exception 'Expected 2 queued files, got %', result; end if;
  select array_agg(object_name order by object_name) into queued from public.admin_room_asset_cleanup_pending();
  -- a3 and a4 are used by room B; b1 and qa_sc_ab/ belong to other folders
  -- (qa_sc_ab only shares a name prefix).
  if queued is distinct from array['qa_sc_a/a1.png','qa_sc_a/a2.png'] then
    raise exception 'Wrong files queued: %', queued; end if;

  delete from storage.objects where bucket_id='room-assets' and name in ('qa_sc_a/a3.mp3','qa_sc_a/a4.png','qa_sc_b/b1.png');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Deleted a file another room uses'; end if;

  -- Client removes a1 only; it claims success for a2 too. The server checks
  -- the object rows: a1 completes, a2 stays queued with an attempt counted.
  delete from storage.objects where bucket_id='room-assets' and name='qa_sc_a/a1.png';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Queued file could not be removed'; end if;
  result := public.admin_record_room_asset_cleanup(jsonb_build_array(
    jsonb_build_object('name','qa_sc_a/a1.png','error',null),
    jsonb_build_object('name','qa_sc_a/a2.png','error',null),
    jsonb_build_object('name','qa_sc_b/b1.png','error',null),
    jsonb_build_object('name','../etc/passwd','error',null)));
  if result <> '{"removed":1,"failed":1}'::jsonb then raise exception 'Unexpected record result %', result; end if;
  execute 'reset role';
  if (select outcome from public.room_asset_cleanup where object_name='qa_sc_a/a1.png') <> 'removed'
    or (select attempts from public.room_asset_cleanup where object_name='qa_sc_a/a2.png') <> 1
    or (select completed_at from public.room_asset_cleanup where object_name='qa_sc_a/a2.png') is not null
    or exists(select 1 from public.room_asset_cleanup where object_name in ('qa_sc_b/b1.png','../etc/passwd')) then
    raise exception 'Cleanup trusted a client claim'; end if;
  if not exists(select 1 from storage.objects where name='qa_sc_b/b1.png') then
    raise exception 'Unqueued file was removed'; end if;

  -- A queued file that becomes referenced again is kept, never removed.
  insert into public.room_media(room_id,kind,label,asset_ref,display_order)
    values ('qa_sc_b','gm_image','أُعيد استخدامها','storage://room-assets/qa_sc_a/a2.png',1);
  execute 'set local role authenticated';
  if exists(select 1 from public.admin_room_asset_cleanup_pending()) then
    raise exception 'Re-used file still pending'; end if;
  execute 'reset role';
  if (select outcome from public.room_asset_cleanup where object_name='qa_sc_a/a2.png') <> 'kept_in_use' then
    raise exception 'Re-used file not marked kept'; end if;

  -- Retries stop after ten failed attempts.
  insert into public.room_asset_cleanup(object_name,room_id,attempts) values ('qa_sc_gone/z.png','qa_sc_gone',10);
  execute 'set local role authenticated';
  if exists(select 1 from public.admin_room_asset_cleanup_pending() where object_name='qa_sc_gone/z.png') then
    raise exception 'Exhausted file still retried'; end if;
  execute 'reset role';

  -- Game Masters and anon cannot see or drive the queue.
  perform set_config('request.jwt.claim.sub',gm_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',gm_sid)::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.room_asset_cleanup) then raise exception 'GM read the cleanup queue'; end if;
  code := null;
  begin perform public.admin_room_asset_cleanup_pending(); exception when others then code := sqlstate; end;
  if code is distinct from '42501' then raise exception 'GM read pending files (%).', code; end if;
  code := null;
  begin perform public.admin_record_room_asset_cleanup('[]'::jsonb); exception when others then code := sqlstate; end;
  if code is distinct from '42501' then raise exception 'GM recorded cleanup (%).', code; end if;
  delete from storage.objects where bucket_id='room-assets' and name='qa_sc_a/a2.png';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'GM deleted a Storage object'; end if;
  execute 'reset role';
  execute 'set local role anon';
  denied := false;
  begin perform public.admin_room_asset_cleanup_pending(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Anonymous pending call allowed'; end if;
  execute 'reset role';
end;
$qa$;
rollback;
