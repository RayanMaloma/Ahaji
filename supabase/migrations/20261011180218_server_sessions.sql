-- Server-owned game sessions. Clients submit named commands, never snapshots.
alter table public.game_sessions
  add column remaining_seconds integer not null default 3600 check (remaining_seconds between 0 and 5999),
  add column ends_at timestamptz,
  add column expires_at timestamptz not null default (now() + interval '12 hours'),
  add column cast_token_hash bytea;
create index game_sessions_expiry_idx on public.game_sessions(expires_at)
  where status <> 'ended';

create table public.session_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  room_id text not null references public.rooms(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in
    ('created','start','pause','resume','adjust','hint','image','video','scale','signal','win','lose','timeout','expired')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);
create index session_events_session_idx on public.session_events(session_id,id);
alter table public.session_events enable row level security;
revoke all on public.session_events from public, anon, authenticated;
grant select on public.session_events to authenticated;
create policy session_events_staff_read on public.session_events for select to authenticated
using ((select ahaji_private.current_staff_role()) = 'admin' or exists (
  select 1 from public.game_sessions s where s.id = session_id
    and s.gm_user_id = (select auth.uid())
    and (select ahaji_private.can_access_room(s.room_id))));

create policy sessions_owner_read on public.game_sessions for select to authenticated
using (gm_user_id = (select auth.uid())
  and (select ahaji_private.can_access_room(room_id)));

create or replace function ahaji_private.prevent_active_room_archive()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.is_active and not new.is_active and exists (
    select 1 from public.game_sessions s where s.room_id = old.id
      and s.status in ('idle','running','paused') and s.expires_at > now()
  ) then raise exception 'A room with an active session cannot be archived'; end if;
  return new;
end;
$$;

create function ahaji_private.room_presentation_config(p_room_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',r.id,'name',r.name,'thumbnail',r.thumbnail_ref,
    'backgroundImage',r.background_ref,'defaultDuration',r.default_duration_seconds,
    'hints',jsonb_build_object('items',coalesce((select jsonb_agg(h.body order by h.display_order)
      from public.room_hints h where h.room_id=r.id),'[]'::jsonb)),
    'media',jsonb_build_object(
      'hintSound',(select m.asset_ref from public.room_media m where m.room_id=r.id and m.kind='hint_sound' limit 1),
      'loseSound',(select m.asset_ref from public.room_media m where m.room_id=r.id and m.kind='lose_sound' limit 1),
      'loseVideo',(select m.asset_ref from public.room_media m where m.room_id=r.id and m.kind='lose_video' limit 1),
      'gmImages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'label',m.label,'src',m.asset_ref) order by m.display_order)
        from public.room_media m where m.room_id=r.id and m.kind='gm_image'),'[]'::jsonb),
      'gmSounds',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'label',m.label,'src',m.asset_ref) order by m.display_order)
        from public.room_media m where m.room_id=r.id and m.kind='gm_sound'),'[]'::jsonb),
      'gmVideos',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'label',m.label,'src',m.asset_ref) order by m.display_order)
        from public.room_media m where m.room_id=r.id and m.kind='gm_video'),'[]'::jsonb)
    )) from public.rooms r where r.id=p_room_id;
$$;
revoke all on function ahaji_private.room_presentation_config(text) from public, anon, authenticated;

create function public.create_game_session(p_room_id text)
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
    'isWin',false,'isLose',false,'lastUpdatedAt',floor(extract(epoch from clock_timestamp())*1000));
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
revoke all on function public.create_game_session(text) from public, anon, authenticated;
grant execute on function public.create_game_session(text) to authenticated;

create function public.get_game_session(p_room_id text,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions
    where id=p_session_id and room_id=p_room_id;
  if not found or not ((select ahaji_private.current_staff_role())='admin' or
    (v_session.gm_user_id=auth.uid() and (select ahaji_private.can_access_room(p_room_id))))
    then raise exception 'Session access denied'; end if;
  return jsonb_build_object('state',v_session.state || jsonb_build_object(
    'roomConfig',ahaji_private.room_presentation_config(p_room_id)),
    'serverNow',floor(extract(epoch from clock_timestamp())*1000),
    'revision',v_session.revision);
end;
$$;
revoke all on function public.get_game_session(text,uuid) from public, anon, authenticated;
grant execute on function public.get_game_session(text,uuid) to authenticated;

create function public.game_session_command(p_room_id text,p_session_id uuid,
  p_command text,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.game_sessions%rowtype; v_state jsonb; v_remaining integer;
  v_delta integer; v_ref text; v_kind text; v_text text; v_scale integer;
  v_now timestamptz := clock_timestamp(); v_event jsonb := '{}'::jsonb;
begin
  select * into v_session from public.game_sessions
    where id=p_session_id and room_id=p_room_id for update;
  if not found or not ((select ahaji_private.current_staff_role())='admin' or
    (v_session.gm_user_id=auth.uid() and (select ahaji_private.can_access_room(p_room_id))))
    then raise exception 'Session access denied'; end if;
  if v_session.expires_at <= v_now then raise exception 'Session expired'; end if;
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
    v_state:=v_state||jsonb_build_object('hintText',v_text);
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
    if v_scale not between 25 and 150 then raise exception 'Invalid image scale'; end if;
    v_state:=v_state||jsonb_build_object('activeImageScale',v_scale);
    v_event:=jsonb_build_object('scale',v_scale);
  elsif p_command='signal' and v_session.status in ('idle','running','paused') then
    v_text:=p_value->>'type';
    if v_text not in ('alert','hint-sound','lose-media','gm-sound') then
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
revoke all on function public.game_session_command(text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.game_session_command(text,uuid,text,jsonb) to authenticated;

create function public.cast_session_state(p_room_id text,p_session_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.game_sessions%rowtype; v_now timestamptz := clock_timestamp();
  v_state jsonb;
begin
  if length(coalesce(p_token,'')) <> 48 then raise exception 'Invalid display access'; end if;
  select * into v_session from public.game_sessions where id=p_session_id and room_id=p_room_id
    and cast_token_hash=extensions.digest(p_token,'sha256') for update;
  if not found or v_session.expires_at <= v_now then raise exception 'Invalid or expired display access'; end if;
  v_state:=v_session.state;
  if v_session.status='running' and v_session.ends_at<=v_now then
    v_state:=v_state||jsonb_build_object('status','ended','resultState','lose',
      'viewMode','lose','isWin',false,'isLose',true,'remainingSeconds',0,'endsAt',null,
      'lastUpdatedAt',floor(extract(epoch from v_now)*1000));
    update public.game_sessions set status='ended',result='lose',remaining_seconds=0,
      ends_at=null,ended_at=v_now,state=v_state,revision=revision+1 where id=p_session_id;
    insert into public.session_events(session_id,room_id,event_type)
      values(p_session_id,p_room_id,'timeout');
  end if;
  return jsonb_build_object('state',v_state || jsonb_build_object(
    'roomConfig',ahaji_private.room_presentation_config(p_room_id)),
    'serverNow',floor(extract(epoch from v_now)*1000),
    'revision',v_session.revision);
end;
$$;
revoke all on function public.cast_session_state(text,uuid,text) from public, anon, authenticated;
grant execute on function public.cast_session_state(text,uuid,text) to anon, authenticated;

-- Function names are a narrow API. No INSERT/UPDATE/DELETE grant on sessions
-- or event history is given to browsers.
