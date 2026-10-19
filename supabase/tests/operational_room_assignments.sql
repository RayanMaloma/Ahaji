-- Operational accounts and room assignment. Disposable PostgreSQL 17 only:
-- creates its own fixtures inside one transaction that is rolled back.
begin;
do $qa$
declare
  admin_id uuid := '20000000-0000-4000-8000-0000000000a1'; admin_sid uuid := gen_random_uuid();
  venue_id uuid := '20000000-0000-4000-8000-0000000000b1'; venue_sid uuid := gen_random_uuid();
  events_id uuid := '20000000-0000-4000-8000-0000000000b2'; events_sid uuid := gen_random_uuid();
  person_id uuid := '20000000-0000-4000-8000-0000000000b3'; person_sid uuid := gen_random_uuid();
  game uuid := gen_random_uuid(); idle_game uuid := gen_random_uuid();
  data jsonb; denied boolean; n integer; before_counts text; after_counts text; txt text;
begin
  insert into public.rooms(id,name,default_duration_seconds,is_active,display_order,thumbnail_ref,background_ref) values
    ('qa_anbar','عنبر 23',3600,true,80,'images/prison.jpg','images/prison.jpg'),
    ('qa_haram','الهرم',3600,true,81,'images/pyramid.png','images/pyramid.png'),
    ('qa_saleh','العم صالح',3600,true,82,'images/unclesaleh.png','images/unclesaleh.png'),
    ('qa_faw','أسرار الفاو',3600,true,83,'images/ahajilogo.svg','images/ahajilogo.svg');
  insert into public.room_hints(room_id,body,display_order) values ('qa_saleh','تلميح محفوظ',1);
  insert into public.room_media(room_id,kind,label,asset_ref,display_order)
    values ('qa_saleh','gm_image','صورة محفوظة','images/unclesaleh.png',1);
  insert into auth.users(id,email,email_confirmed_at) values
    (admin_id,'qa-admin-ops@test.invalid',now()),
    (venue_id,'operator-venue@operators.ahaji.invalid',now()),
    (events_id,'operator-events@operators.ahaji.invalid',now()),
    (person_id,'qa-person@test.invalid',now());
  insert into auth.sessions(id,user_id) values (admin_sid,admin_id),(venue_sid,venue_id),
    (events_sid,events_id),(person_sid,person_id);
  insert into public.staff_accounts(user_id,role,active,account_type,login_name) values
    (admin_id,'admin',true,'email',null),
    (venue_id,'game_master',true,'operator','ahaji_venue'),
    (events_id,'game_master',true,'operator','ahaji_events'),
    (person_id,'game_master',true,'email',null);
  insert into public.game_sessions(id,room_id,gm_user_id,status) values
    (idle_game,'qa_haram',venue_id,'ended');

  -- Game Masters cannot read or change assignments.
  perform set_config('request.jwt.claim.sub',venue_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',venue_sid)::text,true);
  execute 'set local role authenticated';
  if public.admin_room_assignments() is not null then raise exception 'GM read assignments'; end if;
  denied := false; begin perform public.admin_set_room_assignment('qa_faw','venue','');
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'GM assigned a room'; end if;
  denied := false; begin perform public.admin_set_operational_slot(venue_id,'events');
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'GM changed an operational account'; end if;
  execute 'reset role';
  execute 'set local role anon';
  denied := false; begin perform public.admin_room_assignments();
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Anonymous read assignments'; end if;
  execute 'reset role';

  -- Admin designates the two accounts and the initial distribution.
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  execute 'set local role authenticated';
  denied := false; begin perform public.admin_set_operational_slot(admin_id,'venue');
    exception when others then denied := true; end;
  if not denied then raise exception 'Admin account became operational'; end if;
  perform public.admin_set_operational_slot(venue_id,'venue');
  perform public.admin_set_operational_slot(events_id,'events');
  if (select display_name from public.staff_profiles where user_id = venue_id) <> 'حساب محل أحاجي' then
    raise exception 'Venue display name not set'; end if;
  -- New rooms start unassigned.
  data := public.admin_room_assignments();
  if (select count(*) from jsonb_array_elements(data->'rooms') r
      where r->>'room_id' like 'qa_%' and r->>'slot' is not null) <> 0 then
    raise exception 'Rooms were assigned by default'; end if;
  if jsonb_array_length(data->'accounts') <> 2 then raise exception 'Accounts missing: %', data->'accounts'; end if;
  perform public.admin_set_room_assignment('qa_anbar','venue','');
  perform public.admin_set_room_assignment('qa_haram','venue','');
  perform public.admin_set_room_assignment('qa_saleh','venue','');
  perform public.admin_set_room_assignment('qa_faw','events','');
  denied := false; begin perform public.admin_set_room_assignment('qa_faw','venue','');
    exception when serialization_failure then denied := true; end;
  if not denied then raise exception 'Stale assignment view accepted'; end if;
  execute 'reset role';

  -- Server-side scope: each account reaches only its rooms.
  perform set_config('request.jwt.claim.sub',venue_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',venue_sid)::text,true);
  execute 'set local role authenticated';
  select string_agg(id,',' order by id) into txt from public.rooms where id like 'qa_%';
  if txt <> 'qa_anbar,qa_haram,qa_saleh' then raise exception 'Venue sees %', txt; end if;
  if ahaji_private.can_access_room('qa_faw') then raise exception 'Venue reached the event room'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',events_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',events_sid)::text,true);
  execute 'set local role authenticated';
  select string_agg(id,',' order by id) into txt from public.rooms where id like 'qa_%';
  if txt <> 'qa_faw' then raise exception 'Events sees %', txt; end if;
  if (select count(*) from public.game_sessions where room_id like 'qa_%') <> 0 then
    raise exception 'Events reached venue sessions'; end if;
  execute 'reset role';

  -- A running game blocks a transfer; once it ends the move succeeds.
  insert into public.game_sessions(id,room_id,gm_user_id,status,started_at) values
    (game,'qa_anbar',venue_id,'running',now());
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  execute 'set local role authenticated';
  denied := false; begin perform public.admin_set_room_assignment('qa_anbar','events','venue');
    exception when object_in_use then denied := true; end;
  if not denied then raise exception 'Transfer during a running game allowed'; end if;
  execute 'reset role';
  update public.game_sessions set status = 'ended', ended_at = now() where id = game;

  -- Move: exactly one owner afterwards, previous owner loses access at once.
  execute 'set local role authenticated';
  perform public.admin_set_room_assignment('qa_haram','events','venue');
  execute 'reset role';
  if (select count(*) from public.staff_room_access where room_id = 'qa_haram') <> 1 or
     not exists(select 1 from public.staff_room_access where room_id = 'qa_haram' and user_id = events_id) then
    raise exception 'Move left the wrong assignments'; end if;
  perform set_config('request.jwt.claim.sub',venue_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',venue_sid)::text,true);
  execute 'set local role authenticated';
  if ahaji_private.can_access_room('qa_haram') then raise exception 'Previous owner kept access'; end if;
  if exists(select 1 from public.game_sessions where id = idle_game) then
    raise exception 'Previous owner still reads moved-room history'; end if;
  denied := false; begin perform public.game_session_command('qa_haram',idle_game,'start','{}'::jsonb);
    exception when others then denied := true; end;
  if not denied then raise exception 'Previous owner commanded a moved-room session'; end if;
  execute 'reset role';

  -- Unassign keeps the room and everything attached to it.
  select concat_ws('|',(select count(*) from public.rooms where id='qa_saleh'),
    (select count(*) from public.room_hints where room_id='qa_saleh'),
    (select count(*) from public.room_media where room_id='qa_saleh'),
    (select count(*) from public.game_sessions where room_id like 'qa_%')) into before_counts;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  execute 'set local role authenticated';
  perform public.admin_set_room_assignment('qa_saleh',null,'venue');
  data := public.admin_room_assignments();
  if (select r->>'slot' from jsonb_array_elements(data->'rooms') r where r->>'room_id'='qa_saleh') is not null then
    raise exception 'Unassigned room still owned'; end if;
  execute 'reset role';
  select concat_ws('|',(select count(*) from public.rooms where id='qa_saleh'),
    (select count(*) from public.room_hints where room_id='qa_saleh'),
    (select count(*) from public.room_media where room_id='qa_saleh'),
    (select count(*) from public.game_sessions where room_id like 'qa_%')) into after_counts;
  if before_counts <> after_counts then raise exception 'Unassign changed data % -> %', before_counts, after_counts; end if;
  if exists(select 1 from public.staff_room_access where room_id='qa_saleh') then
    raise exception 'Unassigned room still has access rows'; end if;
  if (select count(*) from public.admin_audit where entity_type='staff_room_access'
      and entity_id in (venue_id::text, events_id::text)) < 6 then raise exception 'Assignments not audited'; end if;

  -- One operational owner per room on every write path, but individual
  -- employee accounts may share a room with its operational account.
  denied := false; begin insert into public.staff_room_access(user_id,room_id) values (events_id,'qa_anbar');
    exception when unique_violation then denied := true; end;
  if not denied then raise exception 'Two operational owners allowed'; end if;
  insert into public.staff_room_access(user_id,room_id) values (person_id,'qa_anbar');
  denied := false; begin update public.staff_accounts set role = 'admin' where user_id = venue_id;
    exception when check_violation then denied := true; end;
  if not denied then raise exception 'Operational account promoted to Admin'; end if;
  raise notice 'operational_room_assignments.sql: all checks passed';
end;
$qa$;
rollback;
