-- Cross-feature checks for the merged PC and laptop work (BC-Work): a room
-- created by Admin, assigned to an operational account, played with theme
-- music by that account, and deleted. Disposable PostgreSQL 17 only;
-- self-contained and rolled back.
begin;
do $qa$
declare
  admin_id uuid := '50000000-0000-4000-8000-0000000000a1'; admin_sid uuid := gen_random_uuid();
  venue_id uuid := '50000000-0000-4000-8000-0000000000b1'; venue_sid uuid := gen_random_uuid();
  events_id uuid := '50000000-0000-4000-8000-0000000000b2'; events_sid uuid := gen_random_uuid();
  room public.rooms%rowtype; room_payload jsonb; revision bigint;
  game jsonb; game_id uuid; data jsonb; denied boolean; code text;
begin
  delete from public.staff_accounts where operational_slot is not null;
  insert into auth.users(id,email,email_confirmed_at) values
    (admin_id,'qa-admin-bc@test.invalid',now()),
    (venue_id,'operator-venue-bc@operators.ahaji.invalid',now()),
    (events_id,'operator-events-bc@operators.ahaji.invalid',now());
  insert into auth.sessions(id,user_id) values (admin_sid,admin_id),(venue_sid,venue_id),(events_sid,events_id);
  insert into public.staff_accounts(user_id,role,active,account_type,login_name,operational_slot) values
    (admin_id,'admin',true,'email',null,null),
    (venue_id,'game_master',true,'operator','bc_venue','venue'),
    (events_id,'game_master',true,'operator','bc_events','events');

  -- Admin creates a room the way the Admin UI does (laptop: full presentation
  -- profile by column default) and it appears unassigned in «ربط الغرف» (PC).
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  execute 'set local role authenticated';
  insert into public.rooms(id,name,default_duration_seconds,is_active,display_order,thumbnail_ref,background_ref)
    values ('qa_bc_new','غرفة تكامل',3600,true,90,'images/prison.jpg','images/prison.jpg');
  data := public.admin_room_assignments();
  if not exists(select 1 from jsonb_array_elements(data->'rooms') r
      where r->>'room_id'='qa_bc_new' and r->>'slot' is null) then
    raise exception 'New room missing from room assignments: %', data->'rooms'; end if;

  -- Admin saves theme music with a trim (laptop), then assigns the room (PC).
  select * into room from public.rooms where id='qa_bc_new';
  room_payload := jsonb_build_object('name',room.name,'description',room.description,
    'durationSeconds',room.default_duration_seconds,'active',true,
    'imageRef',room.background_ref,'presentation',room.presentation_settings);
  revision := (public.admin_save_room_draft('qa_bc_new',room.content_revision,room_payload,null,
    jsonb_build_array(jsonb_build_object('id',null,'kind','theme_sound','label','موسيقى الثيم',
      'assetRef','storage://room-assets/qa_bc_new/theme.mp3','trimStartMs',500,'trimEndMs',null)))
    ->>'revision')::bigint;
  if revision is null then raise exception 'Draft save returned no revision'; end if;
  perform public.admin_set_room_assignment('qa_bc_new','venue','');
  execute 'reset role';

  -- The other operational account cannot open a session in it.
  perform set_config('request.jwt.claim.sub',events_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',events_sid)::text,true);
  execute 'set local role authenticated';
  denied := false;
  begin perform public.create_game_session('qa_bc_new'); exception when others then denied := true; end;
  if not denied then raise exception 'Unassigned operational account opened a session'; end if;
  execute 'reset role';

  -- The venue account plays it: theme on by default, toggled through the
  -- 'theme' command, and the trimmed theme reaches the presentation config.
  perform set_config('request.jwt.claim.sub',venue_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',venue_sid)::text,true);
  execute 'set local role authenticated';
  game := public.create_game_session('qa_bc_new');
  game_id := (game->>'sessionId')::uuid;
  if not (game->'state'->>'themeEnabled')::boolean then raise exception 'Theme not on by default'; end if;
  if (game->'state'->'roomConfig'->'media'->'themeSound'->>'trimStartMs')::integer <> 500 then
    raise exception 'Theme trim missing for operational account'; end if;
  game := public.game_session_command('qa_bc_new',game_id,'start','{}'::jsonb);
  game := public.game_session_command('qa_bc_new',game_id,'theme','{"enabled":false}'::jsonb);
  if (game->'state'->>'themeEnabled')::boolean then raise exception 'Theme toggle ignored'; end if;
  execute 'reset role';

  -- While that game runs, the room cannot change hands (PC rule).
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  execute 'set local role authenticated';
  code := null;
  begin perform public.admin_set_room_assignment('qa_bc_new','events','venue');
  exception when others then code := sqlstate; end;
  if code is distinct from '55006' then raise exception 'Room moved during a running game (%).', code; end if;

  -- A played room cannot be deleted (laptop rule: 23503, deactivate instead),
  -- and the failed delete leaves the assignment intact.
  code := null;
  begin delete from public.rooms where id='qa_bc_new'; exception when others then code := sqlstate; end;
  if code is distinct from '23503' then raise exception 'Played room deletion gave %', code; end if;
  if not exists(select 1 from public.staff_room_access where room_id='qa_bc_new' and user_id=venue_id) then
    raise exception 'Failed delete dropped the assignment'; end if;

  -- An assigned room that was never played deletes cleanly; its assignment,
  -- theme media, and the «ربط الغرف» row go with it.
  insert into public.rooms(id,name,default_duration_seconds,is_active,display_order,thumbnail_ref,background_ref)
    values ('qa_bc_unplayed','غرفة جديدة',3600,true,91,'images/prison.jpg','images/prison.jpg');
  perform public.admin_set_room_assignment('qa_bc_unplayed','events','');
  delete from public.rooms where id='qa_bc_unplayed';
  if exists(select 1 from public.rooms where id='qa_bc_unplayed') then raise exception 'Room not deleted'; end if;
  execute 'reset role';
  if exists(select 1 from public.staff_room_access where room_id='qa_bc_unplayed') then
    raise exception 'Assignment survived room deletion'; end if;
  execute 'set local role authenticated';
  data := public.admin_room_assignments();
  if exists(select 1 from jsonb_array_elements(data->'rooms') r where r->>'room_id'='qa_bc_unplayed') then
    raise exception 'Deleted room still listed in room assignments'; end if;

  -- Game Masters still cannot delete rooms.
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',venue_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',venue_sid)::text,true);
  execute 'set local role authenticated';
  delete from public.rooms where id='qa_bc_new';
  execute 'reset role';
  if not exists(select 1 from public.rooms where id='qa_bc_new') then raise exception 'GM deleted a room'; end if;
end;
$qa$;
rollback;
