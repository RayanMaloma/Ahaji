-- Presentation controls are deliberately limited to values used by the Cast
-- renderer. Existing rooms receive the visual defaults of the previous build.
create or replace function ahaji_private.valid_room_presentation(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p) <> 'object' or
    (select count(*) from jsonb_object_keys(p)) <> 11 or
    not (p ?& array['timerScale','timerPosition','timerColor','timerFont',
      'hintScale','hintPosition','hintDurationSeconds','imageFit','videoFit',
      'winMessage','loseMessage']) then return false; end if;
  return coalesce((p->>'timerScale')::numeric between 0.7 and 1.3
    and p->>'timerPosition' in ('top','center','bottom')
    and p->>'timerColor' ~ '^#[0-9A-Fa-f]{6}$'
    and p->>'timerFont' in ('mono','serif')
    and (p->>'hintScale')::numeric between 0.75 and 1.5
    and p->>'hintPosition' in ('top','bottom')
    and (p->>'hintDurationSeconds')::integer between 0 and 120
    and p->>'imageFit' in ('contain','cover')
    and p->>'videoFit' in ('contain','cover')
    and length(p->>'winMessage') between 1 and 80
    and length(p->>'loseMessage') between 1 and 80,false);
exception when others then return false;
end;
$$;
revoke all on function ahaji_private.valid_room_presentation(jsonb)
  from public, anon, authenticated;
grant execute on function ahaji_private.valid_room_presentation(jsonb)
  to authenticated;

alter table public.rooms add column presentation_settings jsonb not null default
  '{"timerScale":1,"timerPosition":"center","timerColor":"#ffffff","timerFont":"mono","hintScale":1,"hintPosition":"bottom","hintDurationSeconds":0,"imageFit":"contain","videoFit":"contain","winMessage":"مبروك الفوز","loseMessage":"كنتم قريبين جداً"}'::jsonb;
alter table public.rooms add constraint rooms_presentation_valid
  check (ahaji_private.valid_room_presentation(presentation_settings));

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

-- A profile carries display data only. Roles remain exclusively in
-- staff_accounts; profile edits cannot alter authorization.
create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_ref text,
  updated_at timestamptz not null default now(),
  constraint staff_profiles_name_valid check (length(display_name) <= 80),
  constraint staff_profiles_avatar_valid check (avatar_ref is null or
    avatar_ref ~ ('^storage://profile-assets/' || user_id::text || '/[A-Za-z0-9._-]+$'))
);
alter table public.staff_profiles enable row level security;
revoke all on public.staff_profiles from public, anon, authenticated;
grant select,insert,update on public.staff_profiles to authenticated;
create policy staff_profiles_read on public.staff_profiles for select to authenticated
using (user_id = (select auth.uid()) or
  (select ahaji_private.current_staff_role()) = 'admin');
create policy staff_profiles_insert on public.staff_profiles for insert to authenticated
with check (user_id = (select auth.uid()) and
  (select ahaji_private.current_staff_role()) is not null);
create policy staff_profiles_update on public.staff_profiles for update to authenticated
using (user_id = (select auth.uid()) and
  (select ahaji_private.current_staff_role()) is not null)
with check (user_id = (select auth.uid()) and
  (select ahaji_private.current_staff_role()) is not null);
create function ahaji_private.touch_staff_profile()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
revoke all on function ahaji_private.touch_staff_profile() from public,anon,authenticated;
create trigger staff_profiles_updated_at before update on public.staff_profiles
for each row execute function ahaji_private.touch_staff_profile();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-assets','profile-assets',true,2097152,
  array['image/jpeg','image/png','image/webp']) on conflict (id) do nothing;
create policy profile_assets_owner_insert on storage.objects for insert to authenticated
with check (bucket_id='profile-assets'
  and (storage.foldername(storage.objects.name))[1]=(select auth.uid())::text
  and (select ahaji_private.current_staff_role()) is not null);
create policy profile_assets_owner_select on storage.objects for select to authenticated
using (bucket_id='profile-assets' and
  ((storage.foldername(storage.objects.name))[1]=(select auth.uid())::text or
    (select ahaji_private.current_staff_role())='admin'));
create policy profile_assets_owner_update on storage.objects for update to authenticated
using (bucket_id='profile-assets' and
  (storage.foldername(storage.objects.name))[1]=(select auth.uid())::text and
  (select ahaji_private.current_staff_role()) is not null)
with check (bucket_id='profile-assets' and
  (storage.foldername(storage.objects.name))[1]=(select auth.uid())::text and
  (select ahaji_private.current_staff_role()) is not null);
create policy profile_assets_owner_delete on storage.objects for delete to authenticated
using (bucket_id='profile-assets' and
  (storage.foldername(storage.objects.name))[1]=(select auth.uid())::text and
  (select ahaji_private.current_staff_role()) is not null);

-- The directory includes a display name/avatar but never editable role data.
drop function public.admin_staff_directory();
create function public.admin_staff_directory()
returns table(user_id uuid,email text,email_confirmed boolean,role text,active boolean,
  created_at timestamptz,room_ids text[],display_name text,avatar_ref text)
language sql stable security definer set search_path = '' as $$
  select sa.user_id, u.email::text, u.email_confirmed_at is not null,
    sa.role, sa.active, sa.created_at,
    coalesce(array_agg(a.room_id order by a.room_id)
      filter (where a.room_id is not null), '{}'::text[]),
    coalesce(p.display_name,''), p.avatar_ref
  from public.staff_accounts sa
  join auth.users u on u.id = sa.user_id
  left join public.staff_room_access a on a.user_id = sa.user_id
  left join public.staff_profiles p on p.user_id = sa.user_id
  where (select ahaji_private.current_staff_role()) = 'admin'
  group by sa.user_id, u.email, u.email_confirmed_at, sa.role,
    sa.active, sa.created_at, p.display_name, p.avatar_ref;
$$;
revoke all on function public.admin_staff_directory() from public,anon,authenticated;
grant execute on function public.admin_staff_directory() to authenticated;

-- Assignment remains valid for a live session after room deactivation.
-- create_game_session separately requires rooms.is_active, so no new session
-- can be created for a disabled room.
create or replace function ahaji_private.can_access_room(p_room_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select ahaji_private.current_staff_role())='admin'
    or ((select ahaji_private.current_staff_role())='game_master'
      and exists(select 1 from public.staff_room_access a
        where a.user_id=(select auth.uid()) and a.room_id=p_room_id)),false);
$$;

-- Hint visibility duration is stamped by the server, not a client clock.
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
