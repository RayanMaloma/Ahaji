-- Correct SQL NULL authorization guards; unverified or revoked callers are rejected.

create or replace function public.admin_reorder_hints(p_room_id text, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_id uuid; v_position integer := 0;
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required';
  end if;
  perform 1 from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  select count(*) into v_count from public.room_hints where room_id = p_room_id;
  if cardinality(p_ids) <> v_count or
     (select count(distinct x) from unnest(p_ids) x) <> v_count or
     (select count(*) from public.room_hints where room_id = p_room_id and id = any(p_ids)) <> v_count then
    raise exception 'Hint order must contain every hint exactly once';
  end if;
  update public.room_hints set display_order = display_order + 1000000
    where room_id = p_room_id;
  foreach v_id in array p_ids loop
    update public.room_hints set display_order = v_position where id = v_id;
    v_position := v_position + 1;
  end loop;
end;
$$;

create or replace function public.get_game_session(p_room_id text,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions
    where id=p_session_id and room_id=p_room_id;
  if not found or not (coalesce((select ahaji_private.current_staff_role())='admin',false) or
    coalesce(v_session.gm_user_id=auth.uid() and (select ahaji_private.can_access_room(p_room_id)),false))
    then raise exception 'Session access denied'; end if;
  return jsonb_build_object('state',v_session.state || jsonb_build_object(
    'roomConfig',ahaji_private.room_presentation_config(p_room_id)),
    'serverNow',floor(extract(epoch from clock_timestamp())*1000),
    'revision',v_session.revision);
end;
$$;

create or replace function public.game_session_command(p_room_id text,p_session_id uuid,
  p_command text,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.game_sessions%rowtype; v_state jsonb; v_remaining integer;
  v_delta integer; v_ref text; v_kind text; v_text text; v_scale integer;
  v_now timestamptz := clock_timestamp(); v_event jsonb := '{}'::jsonb;
begin
  select * into v_session from public.game_sessions
    where id=p_session_id and room_id=p_room_id for update;
  if not found or not (coalesce((select ahaji_private.current_staff_role())='admin',false) or
    coalesce(v_session.gm_user_id=auth.uid() and (select ahaji_private.can_access_room(p_room_id)),false))
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

create or replace function public.admin_manage_staff(p_user_id uuid,p_role text,p_active boolean,p_room_ids text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required'; end if;
  if p_role not in ('admin','game_master') or p_active is null then
    raise exception 'Invalid staff role or status'; end if;
  perform 1 from public.staff_accounts where user_id=p_user_id for update;
  if not found then raise exception 'Staff account not found';end if;
  select count(distinct x) into v_count from unnest(coalesce(p_room_ids,'{}'::text[])) x;
  if v_count <> coalesce(cardinality(p_room_ids),0) then
    raise exception 'Duplicate room assignment';end if;
  if p_role='game_master' and exists (
    select 1 from unnest(coalesce(p_room_ids,'{}'::text[])) x
    where not exists(select 1 from public.rooms r where r.id=x and r.is_active)
  ) then raise exception 'An assigned room is unavailable';end if;
  update public.staff_accounts set role=p_role,active=p_active where user_id=p_user_id;
  delete from public.staff_room_access where user_id=p_user_id;
  if p_role='game_master' then
    insert into public.staff_room_access(user_id,room_id)
      select p_user_id,x from unnest(coalesce(p_room_ids,'{}'::text[])) x;
  end if;
end;
$$;
