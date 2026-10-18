-- Room theme music and non-destructive audio trimming.
-- Trims are start/end points in milliseconds; the stored file is never cut.
-- A null end plays to the end of the file. Existing rows keep full playback.
alter table public.room_media
  add column trim_start_ms integer not null default 0 check (trim_start_ms between 0 and 86400000),
  add column trim_end_ms integer check (trim_end_ms is null or trim_end_ms between 1 and 86400000);
alter table public.room_media add constraint room_media_trim_order
  check (trim_end_ms is null or trim_end_ms > trim_start_ms);

alter table public.room_media drop constraint room_media_kind_check;
alter table public.room_media add constraint room_media_kind_check
  check (kind in ('hint_sound','lose_sound','lose_video','gm_image','gm_sound','gm_video','theme_sound'));
-- Only sounds can be trimmed; images and videos always play in full.
alter table public.room_media add constraint room_media_trim_sound_only
  check (kind in ('hint_sound','lose_sound','gm_sound','theme_sound')
    or (trim_start_ms = 0 and trim_end_ms is null));
create unique index room_media_one_theme_sound_per_room
  on public.room_media(room_id) where kind = 'theme_sound';

alter table public.session_events drop constraint session_events_event_type_check;
alter table public.session_events add constraint session_events_event_type_check
  check (event_type in ('created','start','pause','resume','adjust','hint','image','video',
    'scale','signal','win','lose','timeout','expired','theme'));

-- Existing keys keep their shape for older clients. Trim data rides alongside:
-- *Trim objects for single sounds, trim fields on each GM sound, and one
-- themeSound object ({src,trimStartMs,trimEndMs}) or null.
create or replace function ahaji_private.room_presentation_config(p_room_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',r.id,'name',r.name,'thumbnail',r.thumbnail_ref,
    'backgroundImage',r.background_ref,'defaultDuration',r.default_duration_seconds,
    'presentation',r.presentation_settings,
    'hints',jsonb_build_object('items',coalesce((select jsonb_agg(h.body order by h.display_order)
      from public.room_hints h where h.room_id=r.id),'[]'::jsonb)),
    'media',jsonb_build_object(
      'hintSound',(select m.asset_ref from public.room_media m where m.room_id=r.id and m.kind='hint_sound' limit 1),
      'hintSoundTrim',(select jsonb_build_object('trimStartMs',m.trim_start_ms,'trimEndMs',m.trim_end_ms)
        from public.room_media m where m.room_id=r.id and m.kind='hint_sound' limit 1),
      'loseSound',(select m.asset_ref from public.room_media m where m.room_id=r.id and m.kind='lose_sound' limit 1),
      'loseSoundTrim',(select jsonb_build_object('trimStartMs',m.trim_start_ms,'trimEndMs',m.trim_end_ms)
        from public.room_media m where m.room_id=r.id and m.kind='lose_sound' limit 1),
      'loseVideo',(select m.asset_ref from public.room_media m where m.room_id=r.id and m.kind='lose_video' limit 1),
      'themeSound',(select jsonb_build_object('src',m.asset_ref,'trimStartMs',m.trim_start_ms,'trimEndMs',m.trim_end_ms)
        from public.room_media m where m.room_id=r.id and m.kind='theme_sound' limit 1),
      'gmImages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'label',m.label,'src',m.asset_ref) order by m.display_order)
        from public.room_media m where m.room_id=r.id and m.kind='gm_image'),'[]'::jsonb),
      'gmSounds',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'label',m.label,'src',m.asset_ref,
          'trimStartMs',m.trim_start_ms,'trimEndMs',m.trim_end_ms) order by m.display_order)
        from public.room_media m where m.room_id=r.id and m.kind='gm_sound'),'[]'::jsonb),
      'gmVideos',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'label',m.label,'src',m.asset_ref) order by m.display_order)
        from public.room_media m where m.room_id=r.id and m.kind='gm_video'),'[]'::jsonb)
    )) from public.rooms r where r.id=p_room_id;
$$;

-- New sessions start with the theme enabled when the room has one.
create or replace function public.create_game_session(p_room_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms%rowtype; v_id uuid := gen_random_uuid();
  v_token text := encode(extensions.gen_random_bytes(24),'hex'); v_state jsonb;
begin
  if not (select ahaji_private.can_access_room(p_room_id)) then
    raise exception 'Room access denied'; end if;
  select * into v_room from public.rooms where id=p_room_id and is_active;
  if not found then raise exception 'Active room not found'; end if;
  v_state := jsonb_build_object('roomId',p_room_id,'sessionId',v_id::text,
    'roomName',v_room.name,'image',v_room.background_ref,'status','idle',
    'remainingSeconds',v_room.default_duration_seconds,'endsAt',null,
    'hintText','','activeImageSrc',null,'activeVideoSrc',null,
    'activeImageScale',100,'viewMode','normal','resultState','normal',
    'isWin',false,'isLose',false,
    'themeEnabled',exists(select 1 from public.room_media m
      where m.room_id=p_room_id and m.kind='theme_sound'),
    'lastUpdatedAt',floor(extract(epoch from clock_timestamp())*1000));
  insert into public.game_sessions(id,room_id,gm_user_id,status,result,state,revision,
    remaining_seconds,cast_token_hash)
  values(v_id,p_room_id,auth.uid(),'idle','normal',v_state,1,
    v_room.default_duration_seconds,extensions.digest(v_token,'sha256'));
  insert into public.session_events(session_id,room_id,actor_user_id,event_type)
    values(v_id,p_room_id,auth.uid(),'created');
  return jsonb_build_object('sessionId',v_id::text,'castToken',v_token,
    'state',v_state || jsonb_build_object('roomConfig',ahaji_private.room_presentation_config(p_room_id)),
    'serverNow',floor(extract(epoch from clock_timestamp())*1000));
end;
$$;

-- Adds the 'theme' command ({"enabled": boolean}); every other branch is
-- unchanged from 20261012161900_room_presentation_profiles.sql.
create or replace function public.game_session_command(p_room_id text,p_session_id uuid,
  p_command text,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.game_sessions%rowtype; v_state jsonb; v_remaining integer;
  v_delta integer; v_ref text; v_kind text; v_text text; v_scale integer; v_hint_duration integer;
  v_now timestamptz := clock_timestamp(); v_event jsonb := '{}'::jsonb;
begin
  select * into v_session from public.game_sessions
    where id=p_session_id and room_id=p_room_id for update;
  if not found or not (coalesce((select ahaji_private.current_staff_role())='admin',false) or
    coalesce(v_session.gm_user_id=auth.uid() and (select ahaji_private.can_access_room(p_room_id)),false))
    then raise exception 'Session access denied'; end if;
  if v_session.expires_at <= v_now then raise exception 'Session expired'; end if;
  perform ahaji_private.settle_game_session(p_session_id);
  select * into v_session from public.game_sessions where id=p_session_id;
  if (v_session.status='ended' and v_session.state->>'lifecycleReason'='timeout') or
     (v_session.status='ended' and p_command='timeout') then
    return jsonb_build_object('state',v_session.state,
      'serverNow',floor(extract(epoch from v_now)*1000),'revision',v_session.revision);
  end if;
  v_state := v_session.state;
  v_remaining := case when v_session.status='running' then
    greatest(0,ceil(extract(epoch from v_session.ends_at-v_now))::integer)
    else v_session.remaining_seconds end;
  if v_session.status='running' and v_remaining=0 then
    v_session.status:='ended';v_session.result:='lose';v_session.ended_at:=v_now;
    v_session.ends_at:=null;v_session.remaining_seconds:=0;
    v_state:=v_state||jsonb_build_object('status','ended','resultState','lose',
      'viewMode','lose','isWin',false,'isLose',true,'remainingSeconds',0,'endsAt',null);
    insert into public.session_events(session_id,room_id,event_type)
      values(p_session_id,p_room_id,'timeout');
  end if;
  if p_command='start' and v_session.status='idle' then
    if v_remaining=0 then raise exception 'Timer is empty'; end if;
    v_session.started_at:=coalesce(v_session.started_at,v_now);
    v_session.status:='running';v_session.ends_at:=v_now+make_interval(secs=>v_remaining);
  elsif p_command='resume' and v_session.status='paused' and v_session.result='normal' then
    if v_remaining=0 then raise exception 'Timer is empty'; end if;
    v_session.status:='running';v_session.ends_at:=v_now+make_interval(secs=>v_remaining);
  elsif p_command='pause' and v_session.status='running' then
    v_session.status:='paused';v_session.ends_at:=null;v_session.remaining_seconds:=v_remaining;
  elsif p_command='adjust' and v_session.status in ('idle','running','paused') then
    v_delta:=(p_value->>'delta_seconds')::integer;
    if v_delta is null or abs(v_delta)>3600 then raise exception 'Invalid time adjustment'; end if;
    v_remaining:=greatest(0,least(5999,v_remaining+v_delta));
    v_session.remaining_seconds:=v_remaining;
    if v_session.status='running' then v_session.ends_at:=v_now+make_interval(secs=>v_remaining); end if;
    v_event:=jsonb_build_object('delta_seconds',v_delta);
  elsif p_command='hint' and v_session.status in ('idle','running','paused') then
    v_text:=coalesce(p_value->>'text','');
    if length(v_text)>1000 then raise exception 'Hint too long'; end if;
    select (presentation_settings->>'hintDurationSeconds')::integer into v_hint_duration
      from public.rooms where id=p_room_id;
    v_state:=v_state||jsonb_build_object('hintText',v_text,
      'hintExpiresAt',case when v_text='' or coalesce(v_hint_duration,0)=0 then null
        else floor(extract(epoch from (v_now+make_interval(secs=>v_hint_duration)))*1000) end);
    v_event:=jsonb_build_object('text',v_text);
  elsif p_command in ('image','video') and v_session.status in ('idle','running','paused') then
    v_kind:=case when p_command='image' then 'gm_image' else 'gm_video' end;
    if p_value->>'media_id' is null then v_ref:=null;
    else select asset_ref into v_ref from public.room_media
      where id=(p_value->>'media_id')::uuid and room_id=p_room_id and kind=v_kind;
      if not found then raise exception 'Media does not belong to this room'; end if;
    end if;
    v_state:=v_state||jsonb_build_object(case when p_command='image' then 'activeImageSrc' else 'activeVideoSrc' end,v_ref);
    if v_ref is not null then
      v_state:=v_state||jsonb_build_object(case when p_command='image' then 'activeVideoSrc' else 'activeImageSrc' end,null);
    end if;
    v_event:=jsonb_build_object('asset_ref',v_ref);
  elsif p_command='scale' and v_session.status in ('idle','running','paused') then
    v_scale:=(p_value->>'scale')::integer;
    if v_scale is null or v_scale not between 25 and 150 then raise exception 'Invalid image scale'; end if;
    v_state:=v_state||jsonb_build_object('activeImageScale',v_scale);
    v_event:=jsonb_build_object('scale',v_scale);
  elsif p_command='theme' and v_session.status in ('idle','running','paused') then
    if jsonb_typeof(p_value->'enabled') is distinct from 'boolean' then
      raise exception 'Invalid theme setting'; end if;
    if (p_value->>'enabled')::boolean and not exists(select 1 from public.room_media
      where room_id=p_room_id and kind='theme_sound') then
      raise exception 'Room has no theme sound'; end if;
    v_state:=v_state||jsonb_build_object('themeEnabled',(p_value->>'enabled')::boolean);
    v_event:=jsonb_build_object('enabled',(p_value->>'enabled')::boolean);
  elsif p_command='signal' and v_session.status in ('idle','running','paused') then
    v_text:=p_value->>'type';
    if v_text is null or v_text not in ('alert','hint-sound','lose-media','gm-sound') then
      raise exception 'Invalid signal'; end if;
    if v_text='gm-sound' then
      select asset_ref into v_ref from public.room_media where
        id=(p_value->>'media_id')::uuid and room_id=p_room_id and kind='gm_sound';
      if not found then raise exception 'Sound does not belong to this room'; end if;
    end if;
    v_event:=jsonb_build_object('type',v_text,'asset_ref',v_ref,
      'volume',least(1,greatest(0,coalesce((p_value->>'volume')::numeric,1))));
    v_state:=v_state||jsonb_build_object('signal',v_event||jsonb_build_object('revision',v_session.revision+1));
  elsif p_command in ('win','lose') and v_session.status in ('running','paused') then
    v_session.status:='ended';v_session.result:=p_command;v_session.ended_at:=v_now;
    v_session.ends_at:=null;v_session.remaining_seconds:=v_remaining;
    v_state:=v_state||jsonb_build_object('viewMode',p_command,'resultState',p_command,
      'isWin',p_command='win','isLose',p_command='lose');
  elsif p_command='timeout' and v_session.status='ended' and v_session.result='lose' then
    null;
  else raise exception 'Command is invalid for this session state'; end if;
  v_state:=v_state||jsonb_build_object('status',v_session.status,
    'remainingSeconds',v_session.remaining_seconds,
    'endsAt',case when v_session.ends_at is null then null else floor(extract(epoch from v_session.ends_at)*1000) end,
    'lastUpdatedAt',floor(extract(epoch from v_now)*1000));
  update public.game_sessions set status=v_session.status,result=v_session.result,
    started_at=v_session.started_at,ended_at=v_session.ended_at,
    remaining_seconds=v_session.remaining_seconds,ends_at=v_session.ends_at,
    state=v_state,revision=revision+1 where id=p_session_id;
  insert into public.session_events(session_id,room_id,actor_user_id,event_type,payload)
    values(p_session_id,p_room_id,auth.uid(),p_command,v_event);
  return jsonb_build_object('state',v_state,'serverNow',floor(extract(epoch from v_now)*1000),
    'revision',v_session.revision+1);
end;
$$;

-- Media drafts may carry a theme sound and trimStartMs/trimEndMs per item.
-- The room_media checks reject trims on non-sound kinds and bad ranges, so a
-- bad draft rolls back the whole save. Everything else is unchanged from
-- 20261014113852_room_draft_commit.sql.
create or replace function public.admin_save_room_draft(
  p_room_id text, p_expected_revision bigint, p_room jsonb,
  p_hints jsonb default null, p_media jsonb default null)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog, pg_temp as $$
declare
  v_room public.rooms%rowtype;
  v_image text;
  v_hint_ids uuid[] := '{}'::uuid[];
  v_media_ids uuid[] := '{}'::uuid[];
  v_offset integer;
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found' using errcode = 'P0002'; end if;
  if v_room.content_revision <> p_expected_revision then
    raise exception 'Room changed since editing began'
      using errcode = '40001';
  end if;
  if pg_catalog.jsonb_typeof(p_room) <> 'object' then
    raise exception 'Invalid room draft' using errcode = '22023';
  end if;
  v_image := p_room->>'imageRef';
  if v_image is null or (v_image <> v_room.background_ref
    and v_image <> 'images/ahajilogo.svg'
    and v_image !~ ('^storage://room-assets/' || p_room_id || '/[A-Za-z0-9._-]+$')) then
    raise exception 'Invalid room image reference' using errcode = '22023';
  end if;
  update public.rooms set
    name = pg_catalog.btrim(p_room->>'name'),
    description = coalesce(p_room->>'description',''),
    default_duration_seconds = (p_room->>'durationSeconds')::integer,
    is_active = (p_room->>'active')::boolean,
    thumbnail_ref = v_image,
    background_ref = v_image,
    presentation_settings = p_room->'presentation'
  where id = p_room_id;

  if p_hints is not null then
    if pg_catalog.jsonb_typeof(p_hints) <> 'array'
      or pg_catalog.jsonb_array_length(p_hints) > 500
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_hints) e
        where pg_catalog.jsonb_typeof(e) <> 'object'
          or pg_catalog.length(pg_catalog.btrim(e->>'text')) not between 1 and 2000) then
      raise exception 'Invalid hint draft' using errcode = '22023';
    end if;
    select coalesce(pg_catalog.array_agg((e->>'id')::uuid),'{}'::uuid[])
      into v_hint_ids from pg_catalog.jsonb_array_elements(p_hints) e
      where e->>'id' is not null;
    if (select count(*) from pg_catalog.unnest(v_hint_ids) x)
      <> (select count(distinct x) from pg_catalog.unnest(v_hint_ids) x)
      or exists (select 1 from pg_catalog.unnest(v_hint_ids) x
        where not exists (select 1 from public.room_hints h
          where h.id=x and h.room_id=p_room_id)) then
      raise exception 'Hint identity does not belong to room'
        using errcode = '22023';
    end if;
    delete from public.room_hints h where h.room_id=p_room_id
      and h.id <> all(v_hint_ids);
    select coalesce(max(display_order),0)
      + pg_catalog.jsonb_array_length(p_hints) + 1 into v_offset
      from public.room_hints where room_id=p_room_id;
    update public.room_hints h set display_order=h.display_order+v_offset
      where h.room_id=p_room_id and h.id=any(v_hint_ids);
    with desired as (
      select (e.value->>'id')::uuid id,e.value->>'text' body,
        (e.ordinality-1)::integer pos
      from pg_catalog.jsonb_array_elements(p_hints) with ordinality e
      where e.value->>'id' is not null
    )
    update public.room_hints h set body=d.body,display_order=d.pos
      from desired d where h.id=d.id and h.room_id=p_room_id;
    insert into public.room_hints(room_id,body,display_order)
      select p_room_id,e.value->>'text',(e.ordinality-1)::integer
      from pg_catalog.jsonb_array_elements(p_hints) with ordinality e
      where e.value->>'id' is null;
  end if;

  if p_media is not null then
    if pg_catalog.jsonb_typeof(p_media) <> 'array'
      or pg_catalog.jsonb_array_length(p_media) > 200
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_media) e
        where pg_catalog.jsonb_typeof(e) <> 'object'
          or e->>'kind' not in
            ('gm_image','gm_video','gm_sound','hint_sound','lose_sound','lose_video','theme_sound')
          or pg_catalog.length(pg_catalog.btrim(e->>'assetRef')) < 1
          or coalesce(pg_catalog.jsonb_typeof(e->'trimStartMs'),'null') not in ('number','null')
          or coalesce(pg_catalog.jsonb_typeof(e->'trimEndMs'),'null') not in ('number','null')
          or (e->>'kind' like 'gm_%'
            and pg_catalog.length(pg_catalog.btrim(e->>'label')) < 1)) then
      raise exception 'Invalid media draft' using errcode = '22023';
    end if;
    select coalesce(pg_catalog.array_agg((e->>'id')::uuid),'{}'::uuid[])
      into v_media_ids from pg_catalog.jsonb_array_elements(p_media) e
      where e->>'id' is not null;
    if (select count(*) from pg_catalog.unnest(v_media_ids) x)
      <> (select count(distinct x) from pg_catalog.unnest(v_media_ids) x)
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_media) e
        where e->>'id' is not null and not exists
          (select 1 from public.room_media m where m.id=(e->>'id')::uuid
           and m.room_id=p_room_id and m.kind=e->>'kind'))
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_media) e
        left join public.room_media m on m.id=(e->>'id')::uuid
          and m.room_id=p_room_id
        where (e->>'id' is null or m.asset_ref is distinct from e->>'assetRef')
          and e->>'assetRef' !~
            ('^storage://room-assets/' || p_room_id || '/[A-Za-z0-9._-]+$')) then
      raise exception 'Media identity or file reference is invalid'
        using errcode = '22023';
    end if;
    delete from public.room_media m where m.room_id=p_room_id
      and m.id <> all(v_media_ids);
    select coalesce(max(display_order),0)
      + pg_catalog.jsonb_array_length(p_media) + 1 into v_offset
      from public.room_media where room_id=p_room_id;
    update public.room_media m set display_order=m.display_order+v_offset
      where m.room_id=p_room_id and m.id=any(v_media_ids);
    with desired as (
      select (e.value->>'id')::uuid id,e.value->>'kind' kind,
        e.value->>'label' label,e.value->>'assetRef' asset_ref,
        coalesce((e.value->>'trimStartMs')::integer,0) trim_start_ms,
        (e.value->>'trimEndMs')::integer trim_end_ms,
        (e.ordinality-1)::integer pos
      from pg_catalog.jsonb_array_elements(p_media) with ordinality e
      where e.value->>'id' is not null
    )
    update public.room_media m set label=d.label,asset_ref=d.asset_ref,
      trim_start_ms=d.trim_start_ms,trim_end_ms=d.trim_end_ms,
      display_order=d.pos from desired d
      where m.id=d.id and m.room_id=p_room_id and m.kind=d.kind;
    insert into public.room_media(room_id,kind,label,asset_ref,
        trim_start_ms,trim_end_ms,display_order)
      select p_room_id,e.value->>'kind',e.value->>'label',
        e.value->>'assetRef',coalesce((e.value->>'trimStartMs')::integer,0),
        (e.value->>'trimEndMs')::integer,(e.ordinality-1)::integer
      from pg_catalog.jsonb_array_elements(p_media) with ordinality e
      where e.value->>'id' is null;
  end if;
  return pg_catalog.jsonb_build_object('revision',
    (select content_revision from public.rooms where id=p_room_id));
end;
$$;
