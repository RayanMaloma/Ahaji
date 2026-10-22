-- Cross-feature checks for the merged PC and laptop work (BC-Work): a room
-- created by Admin, assigned to an operational account, played with theme
-- music by that account, and deleted with its history. Disposable PostgreSQL 17 only;
-- self-contained and rolled back.
begin;
do $qa$
declare
  admin_id uuid := '50000000-0000-4000-8000-0000000000a1'; admin_sid uuid := gen_random_uuid();
  venue_id uuid := '50000000-0000-4000-8000-0000000000b1'; venue_sid uuid := gen_random_uuid();
  events_id uuid := '50000000-0000-4000-8000-0000000000b2'; events_sid uuid := gen_random_uuid();
  room public.rooms%rowtype; room_payload jsonb; revision bigint;
  game jsonb; game_id uuid; data jsonb; denied boolean; code text; others text; result jsonb;
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

  -- A room cannot be deleted while its game runs, whatever the confirmation;
  -- room, sessions and assignment stay intact. Unrelated rooms are measured
  -- before and after to prove nothing else is touched.
  execute 'reset role';
  others := (select string_agg(r.id||':'||(select count(*) from public.room_hints h where h.room_id=r.id)
      ||':'||(select count(*) from public.room_media m where m.room_id=r.id)
      ||':'||(select count(*) from public.game_sessions g where g.room_id=r.id), ',' order by r.id)
    from public.rooms r where r.id <> 'qa_bc_new');
  execute 'set local role authenticated';
  code := null;
  begin perform public.admin_delete_room('qa_bc_new','غرفة تكامل'); exception when others then code := sqlstate; end;
  if code is distinct from '55006' then raise exception 'Room deleted during a running game (%).', code; end if;
  execute 'reset role';
  if not exists(select 1 from public.game_sessions where id=game_id)
    or not exists(select 1 from public.staff_room_access where room_id='qa_bc_new' and user_id=venue_id) then
    raise exception 'Refused delete changed the room'; end if;

  -- The game ends; the played room is then deleted together with its history.
  perform set_config('request.jwt.claim.sub',venue_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',venue_sid)::text,true);
  execute 'set local role authenticated';
  perform public.game_session_command('qa_bc_new',game_id,'win','{}'::jsonb);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  execute 'set local role authenticated';
  code := null;
  begin perform public.admin_delete_room('qa_bc_new','غرفة أخرى'); exception when others then code := sqlstate; end;
  if code is distinct from '22023' then raise exception 'Wrong confirmation gave %', code; end if;
  result := public.admin_delete_room('qa_bc_new','غرفة تكامل');
  if (result->>'sessions')::integer < 1 or (result->>'events')::integer < 1
    or (result->>'assignments')::integer <> 1 then
    raise exception 'Unexpected deletion summary %', result; end if;
  execute 'reset role';
  if exists(select 1 from public.rooms where id='qa_bc_new')
    or exists(select 1 from public.game_sessions where room_id='qa_bc_new')
    or exists(select 1 from public.session_events where room_id='qa_bc_new')
    or exists(select 1 from public.room_media where room_id='qa_bc_new')
    or exists(select 1 from public.staff_room_access where room_id='qa_bc_new') then
    raise exception 'Deleted room left rows behind'; end if;
  if not exists(select 1 from public.admin_audit where action='delete_with_history'
      and entity_id='qa_bc_new' and actor_user_id=admin_id and before_record->>'name'='غرفة تكامل') then
    raise exception 'Room deletion was not audited'; end if;
  if others is distinct from (select string_agg(r.id||':'||(select count(*) from public.room_hints h where h.room_id=r.id)
      ||':'||(select count(*) from public.room_media m where m.room_id=r.id)
      ||':'||(select count(*) from public.game_sessions g where g.room_id=r.id), ',' order by r.id)
    from public.rooms r) then
    raise exception 'Deleting one room changed another'; end if;
  execute 'set local role authenticated';
  data := public.admin_room_assignments();
  if exists(select 1 from jsonb_array_elements(data->'rooms') r where r->>'room_id'='qa_bc_new') then
    raise exception 'Deleted room still listed in room assignments'; end if;

  -- An assigned room that was never played deletes the same way.
  insert into public.rooms(id,name,default_duration_seconds,is_active,display_order,thumbnail_ref,background_ref)
    values ('qa_bc_unplayed','غرفة جديدة',3600,true,91,'images/prison.jpg','images/prison.jpg');
  perform public.admin_set_room_assignment('qa_bc_unplayed','events','');
  perform public.admin_delete_room('qa_bc_unplayed','غرفة جديدة');
  execute 'reset role';
  if exists(select 1 from public.rooms where id='qa_bc_unplayed')
    or exists(select 1 from public.staff_room_access where room_id='qa_bc_unplayed') then
    raise exception 'Unplayed room or its assignment survived'; end if;

  -- The table path is closed even to Admin; Game Masters and anon cannot call
  -- the function.
  insert into public.rooms(id,name,default_duration_seconds,is_active,display_order,thumbnail_ref,background_ref)
    values ('qa_bc_guard','غرفة محمية',3600,true,92,'images/prison.jpg','images/prison.jpg');
  execute 'set local role authenticated';
  denied := false;
  begin delete from public.rooms where id='qa_bc_guard'; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Admin deleted a room through the table'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',venue_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',venue_sid)::text,true);
  execute 'set local role authenticated';
  code := null;
  begin perform public.admin_delete_room('qa_bc_guard','غرفة محمية'); exception when others then code := sqlstate; end;
  if code is distinct from '42501' then raise exception 'GM room deletion gave %', code; end if;
  execute 'reset role';
  execute 'set local role anon';
  denied := false;
  begin perform public.admin_delete_room('qa_bc_guard','غرفة محمية'); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Anonymous room deletion was callable'; end if;
  execute 'reset role';
  if not exists(select 1 from public.rooms where id='qa_bc_guard') then raise exception 'Guard room deleted'; end if;
end;
$qa$;
rollback;
