-- Disposable restored database only. Every test mutation rolls back.
begin;
do $qa$
declare
  admin_id uuid;
  session_id uuid := '44444444-4444-4444-8444-444444444444';
  room public.rooms%rowtype;
  first_hint uuid;
  foreign_hint uuid;
  start_revision bigint;
  saved_revision bigint;
  payload jsonb;
  denied boolean;
begin
  select user_id into admin_id from public.staff_accounts
    where role='admin' and active limit 1;
  if admin_id is null then raise exception 'Admin fixture missing'; end if;
  insert into auth.sessions(id,user_id) values(session_id,admin_id);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('session_id',session_id)::text,true);
  select * into room from public.rooms where id='anbar';
  select id into first_hint from public.room_hints where room_id='anbar'
    order by display_order limit 1;
  select id into foreign_hint from public.room_hints where room_id='haram'
    order by display_order limit 1;
  if room.id is null or first_hint is null or foreign_hint is null then
    raise exception 'Room fixtures missing';
  end if;
  start_revision:=room.content_revision;
  payload:=jsonb_build_object(
    'name','مسودة اختبار','description',room.description,
    'durationSeconds',room.default_duration_seconds,
    'active',room.is_active,'imageRef',room.background_ref,
    'presentation',room.presentation_settings);
  saved_revision:=(public.admin_save_room_draft('anbar',start_revision,payload,
    jsonb_build_array(jsonb_build_object('id',first_hint,'text','تلميح معدل'),
      jsonb_build_object('id',null,'text','تلميح جديد')),null)->>'revision')::bigint;
  if saved_revision<=start_revision or
    (select name from public.rooms where id='anbar')<>'مسودة اختبار' or
    (select count(*) from public.room_hints where room_id='anbar')<>2 or
    (select body from public.room_hints where id=first_hint)<>'تلميح معدل' then
    raise exception 'Atomic room draft save failed';
  end if;
  denied:=false;
  begin perform public.admin_save_room_draft('anbar',start_revision,payload,null,null);
  exception when sqlstate '40001' then denied:=true; end;
  if not denied then raise exception 'Stale revision accepted'; end if;
  denied:=false;
  begin perform public.admin_save_room_draft('anbar',saved_revision,payload,
    jsonb_build_array(jsonb_build_object('id',foreign_hint,'text','خارج الغرفة')),null);
  exception when others then denied:=true; end;
  if not denied or
    (select content_revision from public.rooms where id='anbar')<>saved_revision then
    raise exception 'Cross-room hint or failed transaction was accepted';
  end if;
  denied:=false;
  begin perform public.admin_save_room_draft('anbar',saved_revision,payload,null,
    jsonb_build_array(jsonb_build_object('id',null,'kind','gm_sound',
      'label','خطأ','assetRef','storage://room-assets/haram/foreign.mp3')));
  exception when others then denied:=true; end;
  if not denied or
    (select count(*) from public.room_media where room_id='anbar' and label='خطأ')<>0 then
    raise exception 'Cross-room file reference was accepted';
  end if;
  perform set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000000',true);
  denied:=false;
  begin perform public.admin_save_room_draft('anbar',saved_revision,payload,null,null);
  exception when others then denied:=true; end;
  if not denied then raise exception 'Anonymous draft save accepted'; end if;
end;
$qa$;
rollback;
