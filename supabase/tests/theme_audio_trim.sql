-- Disposable restored database only. Every test mutation rolls back.
begin;
do $qa$
declare
  admin_id uuid;
  auth_session uuid := '55555555-5555-4555-8555-555555555555';
  room public.rooms%rowtype;
  room_payload jsonb;
  bad_media jsonb;
  saved_revision bigint;
  game jsonb;
  game_id uuid;
  config jsonb;
  denied boolean;
begin
  select user_id into admin_id from public.staff_accounts
    where role='admin' and active limit 1;
  if admin_id is null then raise exception 'Admin fixture missing'; end if;
  insert into auth.sessions(id,user_id) values(auth_session,admin_id);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('session_id',auth_session)::text,true);
  select * into room from public.rooms where id='anbar';
  if room.id is null then raise exception 'Room fixture missing'; end if;
  update public.rooms set is_active=true where id='anbar';
  select * into room from public.rooms where id='anbar';
  room_payload:=jsonb_build_object('name',room.name,'description',room.description,
    'durationSeconds',room.default_duration_seconds,'active',true,
    'imageRef',room.background_ref,'presentation',room.presentation_settings);

  -- A session created before the room has a theme starts with it off.
  game:=public.create_game_session('anbar');
  if (game->'state'->>'themeEnabled')::boolean then
    raise exception 'Theme enabled without a theme sound'; end if;
  denied:=false;
  begin perform public.game_session_command('anbar',(game->>'sessionId')::uuid,'theme',
    '{"enabled":true}'::jsonb);
  exception when others then denied:=true; end;
  if not denied then raise exception 'Theme enabled for a room without one'; end if;

  -- Theme plus trimmed sounds save atomically; untouched media are replaced
  -- by the draft list exactly as before.
  saved_revision:=(public.admin_save_room_draft('anbar',room.content_revision,room_payload,null,
    jsonb_build_array(
      jsonb_build_object('id',null,'kind','theme_sound','label','موسيقى الثيم',
        'assetRef','storage://room-assets/anbar/theme.mp3','trimStartMs',1500,'trimEndMs',null),
      jsonb_build_object('id',null,'kind','gm_sound','label','جرس',
        'assetRef','storage://room-assets/anbar/bell.mp3','trimStartMs',200,'trimEndMs',900)))
    ->>'revision')::bigint;
  if (select trim_start_ms from public.room_media where room_id='anbar' and kind='theme_sound')<>1500
    or (select trim_end_ms from public.room_media where room_id='anbar' and kind='gm_sound')<>900 then
    raise exception 'Trim points were not stored';
  end if;
  -- The private config builder is not callable by staff; read it the way
  -- GM and Cast do, through a session payload.
  config:=public.create_game_session('anbar')->'state'->'roomConfig';
  if config->'media'->'themeSound'->>'src'<>'storage://room-assets/anbar/theme.mp3'
    or (config->'media'->'themeSound'->>'trimStartMs')::integer<>1500
    or (config->'media'->'gmSounds'->0->>'trimEndMs')::integer<>900
    or not (config->'media' ? 'hintSoundTrim') then
    raise exception 'Presentation config lacks theme or trims';
  end if;

  -- Trims on images, inverted ranges, and a second theme are rejected and
  -- leave the saved revision untouched.
  foreach bad_media in array array[
    jsonb_build_array(jsonb_build_object('id',null,'kind','gm_image','label','صورة',
      'assetRef','storage://room-assets/anbar/a.png','trimStartMs',100)),
    jsonb_build_array(jsonb_build_object('id',null,'kind','gm_sound','label','عكسي',
      'assetRef','storage://room-assets/anbar/b.mp3','trimStartMs',900,'trimEndMs',200)),
    jsonb_build_array(
      jsonb_build_object('id',null,'kind','theme_sound','label','ثيم ١','assetRef','storage://room-assets/anbar/t1.mp3'),
      jsonb_build_object('id',null,'kind','theme_sound','label','ثيم ٢','assetRef','storage://room-assets/anbar/t2.mp3'))
  ] loop
    denied:=false;
    begin perform public.admin_save_room_draft('anbar',saved_revision,room_payload,null,bad_media);
    exception when others then denied:=true; end;
    if not denied or (select content_revision from public.rooms where id='anbar')<>saved_revision then
      raise exception 'Invalid media draft accepted: %',bad_media;
    end if;
  end loop;

  -- New sessions default the theme on; the GM can toggle it and it is logged.
  game:=public.create_game_session('anbar');
  game_id:=(game->>'sessionId')::uuid;
  if not (game->'state'->>'themeEnabled')::boolean then
    raise exception 'Theme not enabled by default'; end if;
  game:=public.game_session_command('anbar',game_id,'theme','{"enabled":false}'::jsonb);
  if (game->'state'->>'themeEnabled')::boolean
    or not exists(select 1 from public.session_events where session_id=game_id
      and event_type='theme' and payload->>'enabled'='false') then
    raise exception 'Theme toggle was not applied or logged';
  end if;
  denied:=false;
  begin perform public.game_session_command('anbar',game_id,'theme','{"enabled":"yes"}'::jsonb);
  exception when others then denied:=true; end;
  if not denied then raise exception 'Non-boolean theme value accepted'; end if;
end;
$qa$;
rollback;
