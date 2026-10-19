-- Super Admin, reserved operational identities, and staff deletion.
-- Disposable PostgreSQL 17 only; self-contained and rolled back.
begin;
do $qa$
declare
  super_id uuid := '40000000-0000-4000-8000-0000000000a1'; super_sid uuid := gen_random_uuid();
  admin_id uuid := '40000000-0000-4000-8000-0000000000a2'; admin_sid uuid := gen_random_uuid();
  venue_id uuid := '40000000-0000-4000-8000-0000000000b1'; venue_sid uuid := gen_random_uuid();
  gm_id uuid := '40000000-0000-4000-8000-0000000000b2'; gm_sid uuid := gen_random_uuid();
  game uuid := gen_random_uuid(); denied boolean; result jsonb; n integer; audit_before integer;
begin
  -- The migration designated the only active verified Admin, if any; start clean.
  update public.staff_accounts set is_super_admin = false;
  insert into public.rooms(id,name,default_duration_seconds,is_active,display_order,thumbnail_ref,background_ref)
    values ('qa_del_room','غرفة الحذف',3600,true,70,'images/prison.jpg','images/prison.jpg');
  insert into auth.users(id,email,email_confirmed_at) values
    (super_id,'qa-super@test.invalid',now()),(admin_id,'qa-admin2@test.invalid',now()),
    (venue_id,'operator-qa-venue@operators.ahaji.invalid',now()),(gm_id,'qa-gm-delete@test.invalid',now());
  insert into auth.sessions(id,user_id) values (super_sid,super_id),(admin_sid,admin_id),(venue_sid,venue_id),(gm_sid,gm_id);
  insert into public.staff_accounts(user_id,role,active,account_type,login_name,operational_slot,is_super_admin) values
    (super_id,'admin',true,'email',null,null,true),
    (admin_id,'admin',true,'email',null,null,false),
    (gm_id,'game_master',true,'email',null,null,false);
  delete from public.staff_accounts where operational_slot = 'venue' or login_name = 'venue';
  insert into public.staff_accounts(user_id,role,active,account_type,login_name,operational_slot)
    values (venue_id,'game_master',true,'operator','venue','venue');
  insert into public.staff_room_access(user_id,room_id) values (gm_id,'qa_del_room');
  insert into public.staff_profiles(user_id,display_name) values (gm_id,'مدير لعبة سابق');
  insert into public.game_sessions(id,room_id,gm_user_id,status,result,started_at,ended_at)
    values (game,'qa_del_room',gm_id,'ended','win',now()-interval '1 hour',now());
  insert into public.session_events(session_id,room_id,event_type,actor_user_id,payload) values (game,'qa_del_room','win',gm_id,'{}');

  -- Reserved identities: a duplicate or unbound venue/events login is rejected.
  denied := false; begin
    insert into auth.users(id,email) values ('40000000-0000-4000-8000-0000000000c1','x@operators.ahaji.invalid');
    insert into public.staff_accounts(user_id,role,active,account_type,login_name)
      values ('40000000-0000-4000-8000-0000000000c1','game_master',false,'operator','events');
    exception when check_violation or unique_violation then denied := true; end;
  if not denied then raise exception 'Unbound reserved login accepted'; end if;
  denied := false; begin
    insert into auth.users(id,email) values ('40000000-0000-4000-8000-0000000000c2','y@operators.ahaji.invalid');
    insert into public.staff_accounts(user_id,role,active,account_type,login_name)
      values ('40000000-0000-4000-8000-0000000000c2','game_master',false,'operator','venue');
    exception when check_violation or unique_violation then denied := true; end;
  if not denied then raise exception 'Duplicate reserved login accepted'; end if;

  -- Ordinary Admin: no deletion, no Super Admin changes, no slot assignment.
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  execute 'set local role authenticated';
  if ahaji_private.is_super_admin() then raise exception 'Ordinary Admin is Super Admin'; end if;
  denied := false; begin perform public.admin_prepare_staff_deletion(gm_id);
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Ordinary Admin deleted an account'; end if;
  denied := false; begin perform public.admin_manage_staff(super_id,'admin',false,'{}');
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Ordinary Admin deactivated the Super Admin'; end if;
  denied := false; begin perform public.admin_set_operational_slot(gm_id,'events');
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Browser can still assign operational slots'; end if;
  -- Deactivation and reactivation stay available to ordinary Admins.
  perform public.admin_manage_staff(gm_id,'game_master',false,'{qa_del_room}');
  perform public.admin_manage_staff(gm_id,'game_master',true,'{qa_del_room}');
  execute 'reset role';

  -- API requests can never grant the flag, even through a definer function path.
  denied := false; begin update public.staff_accounts set is_super_admin = true where user_id = admin_id;
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Super Admin granted from an API context'; end if;

  -- Game Master: no deletion.
  perform set_config('request.jwt.claim.sub',gm_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',gm_sid)::text,true);
  execute 'set local role authenticated';
  denied := false; begin perform public.admin_prepare_staff_deletion(admin_id);
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Game Master deleted an account'; end if;
  execute 'reset role';
  execute 'set local role anon';
  denied := false; begin perform public.admin_prepare_staff_deletion(gm_id);
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Anonymous deletion allowed'; end if;
  execute 'reset role';

  -- Super Admin rules: no self, no Super Admin, no reserved account, no last Admin.
  perform set_config('request.jwt.claim.sub',super_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',super_sid)::text,true);
  execute 'set local role authenticated';
  if not ahaji_private.is_super_admin() then raise exception 'Super Admin not recognised'; end if;
  denied := false; begin perform public.admin_prepare_staff_deletion(super_id);
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Self-deletion allowed'; end if;
  denied := false; begin perform public.admin_prepare_staff_deletion(venue_id);
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Reserved operational account deletable'; end if;
  execute 'reset role';
  -- Owner-level changes (as in the SQL editor): no API identity in context.
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','',true);
  update public.staff_accounts set active = false where role = 'admin' and user_id not in (super_id, admin_id);
  update public.staff_accounts set is_super_admin = false where user_id = super_id;
  update public.staff_accounts set active = false where user_id = super_id;
  update public.staff_accounts set is_super_admin = true where user_id = admin_id;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  execute 'set local role authenticated';
  -- admin_id is now the only active Admin and Super Admin; deleting the other
  -- (inactive) Admin is allowed, but the rule for the last active Admin holds.
  denied := false; begin perform public.admin_prepare_staff_deletion(admin_id);
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Last Admin self-deletion allowed'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','',true);
  update public.staff_accounts set is_super_admin = false where user_id = admin_id;
  update public.staff_accounts set active = true where user_id = super_id;
  update public.staff_accounts set is_super_admin = true where user_id = super_id;

  -- Deleting the Game Master: prepare, then the Auth identity is removed.
  select count(*) into audit_before from public.admin_audit;
  perform set_config('request.jwt.claim.sub',super_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',super_sid)::text,true);
  execute 'set local role authenticated';
  result := public.admin_prepare_staff_deletion(gm_id);
  if (result->>'already_prepared')::boolean then raise exception 'First prepare reported a retry'; end if;
  execute 'reset role';
  if exists(select 1 from auth.sessions where user_id = gm_id) then raise exception 'Sessions not revoked'; end if;
  if exists(select 1 from public.staff_room_access where user_id = gm_id) then raise exception 'Access remains'; end if;
  if (select active from public.staff_accounts where user_id = gm_id) then raise exception 'Account still active'; end if;
  perform set_config('request.jwt.claim.sub',gm_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',gm_sid)::text,true);
  execute 'set local role authenticated';
  if ahaji_private.current_staff_role() is not null then raise exception 'Prepared account still authorized'; end if;
  execute 'reset role';
  -- What GoTrue's admin deleteUser does at the database level (no API identity).
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','',true);
  delete from auth.users where id = gm_id;
  if exists(select 1 from public.staff_accounts where user_id = gm_id) then raise exception 'Staff row survived'; end if;
  if (select gm_user_id from public.game_sessions where id = game) is not null
     or (select g.result from public.game_sessions g where g.id = game) <> 'win' then raise exception 'Session history changed'; end if;
  if (select count(*) from public.session_events where session_id = game) <> 1 then raise exception 'Events lost'; end if;
  if (select session_ids from public.deleted_staff_accounts where former_user_id = gm_id) <> array[game] or
     (select label from public.deleted_staff_accounts where former_user_id = gm_id) <> 'مدير لعبة سابق' then
    raise exception 'Tombstone wrong'; end if;
  if not exists(select 1 from public.admin_audit where action = 'delete_account' and entity_id = gm_id::text
      and actor_user_id = super_id and not (before_record ? 'password')) then raise exception 'Deletion not audited'; end if;
  if (select count(*) from public.admin_audit) < audit_before then raise exception 'Audit rows removed'; end if;
  -- A retry after Auth deletion is a safe no-op.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',super_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',super_sid)::text,true);
  result := public.admin_prepare_staff_deletion(gm_id);
  if not (result->>'already_prepared')::boolean then raise exception 'Retry not idempotent'; end if;
  select count(*) into n from public.admin_deleted_staff() where former_user_id = gm_id;
  if n <> 1 then raise exception 'Deleted label not readable by Admin'; end if;
  execute 'reset role';
  -- Operational account and its login stay intact throughout.
  if not exists(select 1 from public.staff_accounts where user_id = venue_id and login_name = 'venue'
      and operational_slot = 'venue' and active) then raise exception 'Operational account changed'; end if;
  raise notice 'staff_account_deletion.sql: all checks passed';
end;
$qa$;
rollback;
