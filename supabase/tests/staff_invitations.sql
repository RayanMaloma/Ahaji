-- Staff invitation lifecycle. Disposable PostgreSQL 17 only: it creates its own
-- Auth fixtures and runs in one transaction that is rolled back.
begin;
do $qa$
declare
  admin_id uuid := '10000000-0000-4000-8000-0000000000a1'; admin_sid uuid := gen_random_uuid();
  gm_id uuid := '10000000-0000-4000-8000-0000000000b1'; gm_sid uuid := gen_random_uuid();
  inv_id uuid := '10000000-0000-4000-8000-0000000000c1'; inv_sid uuid := gen_random_uuid();
  exp_id uuid := '10000000-0000-4000-8000-0000000000c2'; exp_sid uuid := gen_random_uuid();
  rev_id uuid := '10000000-0000-4000-8000-0000000000c3'; rev_sid uuid := gen_random_uuid();
  pend_id uuid := '10000000-0000-4000-8000-0000000000c4';
  invitation uuid; exp_invitation uuid; rev_invitation uuid; pend_invitation uuid;
  result jsonb; txt text; n integer; denied boolean; r record;
begin
  insert into public.rooms(id,name,default_duration_seconds,is_active,display_order,thumbnail_ref,background_ref)
    values ('qa_inv_room','غرفة الدعوة',3600,true,90,'images/ahajilogo.svg','images/ahajilogo.svg'),
           ('qa_inv_other','غرفة أخرى',3600,true,91,'images/ahajilogo.svg','images/ahajilogo.svg'),
           ('qa_inv_off','غرفة متوقفة',3600,false,92,'images/ahajilogo.svg','images/ahajilogo.svg');
  insert into auth.users(id,email,email_confirmed_at,encrypted_password) values
    (admin_id,'qa-admin@test.invalid',now(),'$2a$hash'),
    (gm_id,'qa-gm@test.invalid',now(),'$2a$hash'),
    (inv_id,'qa-invitee@test.invalid',null,null),
    (exp_id,'qa-expired@test.invalid',null,null),
    (rev_id,'qa-revoked@test.invalid',null,null),
    (pend_id,'qa-pending@test.invalid',null,null);
  insert into auth.sessions(id,user_id) values (admin_sid,admin_id),(gm_sid,gm_id),
    (inv_sid,inv_id),(exp_sid,exp_id),(rev_sid,rev_id);
  insert into public.staff_accounts(user_id,role,active) values (admin_id,'admin',true),(gm_id,'game_master',true);

  -- A Game Master cannot provision, refresh, revoke, or list staff.
  perform set_config('request.jwt.claim.sub',gm_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',gm_sid)::text,true);
  execute 'set local role authenticated';
  denied := false; begin perform public.admin_prepare_staff_invitation('x@test.invalid');
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'GM prepared an invitation'; end if;
  denied := false; begin perform public.admin_record_staff_invitation(inv_id,'qa-invitee@test.invalid','x','admin','{}');
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'GM recorded an invitation'; end if;
  if (select count(*) from public.admin_staff_directory()) <> 0 then raise exception 'GM listed staff'; end if;
  denied := false; begin perform count(*) from public.staff_invitations;
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Invitation table directly readable'; end if;
  execute 'reset role';

  -- Anonymous callers cannot execute any invitation function.
  execute 'set local role anon';
  denied := false; begin perform public.accept_staff_invitation();
    exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Anonymous accept allowed'; end if;
  execute 'reset role';

  -- Admin provisioning.
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  execute 'set local role authenticated';
  select mode into txt from public.admin_prepare_staff_invitation('Nobody@Test.invalid');
  if txt <> 'new' then raise exception 'Unknown email mode %', txt; end if;
  select mode into txt from public.admin_prepare_staff_invitation('QA-Invitee@test.invalid');
  if txt <> 'reinvite' then raise exception 'Unconfirmed identity mode %', txt; end if;
  denied := false; begin perform public.admin_prepare_staff_invitation('qa-gm@test.invalid');
    exception when unique_violation then denied := true; end;
  if not denied then raise exception 'Existing staff could be re-invited'; end if;
  denied := false; begin perform public.admin_record_staff_invitation(inv_id,'qa-invitee@test.invalid','ليلى','game_master','{qa_inv_off}');
    exception when others then denied := true; end;
  if not denied then raise exception 'Inactive room assigned'; end if;
  denied := false; begin perform public.admin_record_staff_invitation(inv_id,'other@test.invalid','ليلى','game_master','{}');
    exception when others then denied := true; end;
  if not denied then raise exception 'Identity/email mismatch accepted'; end if;
  invitation := public.admin_record_staff_invitation(inv_id,'qa-invitee@test.invalid','ليلى','game_master','{qa_inv_room}');
  denied := false; begin perform public.admin_prepare_staff_invitation('qa-invitee@test.invalid');
    exception when unique_violation then denied := true; end;
  if not denied then raise exception 'Duplicate pending invitation allowed'; end if;
  denied := false; begin perform public.admin_manage_staff(inv_id,'game_master',true,'{qa_inv_room}');
    exception when others then denied := true; end;
  if not denied then raise exception 'Admin activated a pending account'; end if;
  select * into r from public.admin_staff_directory() d where d.user_id = inv_id;
  if r.invitation_status <> 'pending' or r.active or r.display_name <> 'ليلى' or r.room_ids <> '{qa_inv_room}' then
    raise exception 'Directory pending row wrong: %', row_to_json(r); end if;
  exp_invitation := public.admin_record_staff_invitation(exp_id,'qa-expired@test.invalid','','admin','{}');
  rev_invitation := public.admin_record_staff_invitation(rev_id,'qa-revoked@test.invalid','','game_master','{qa_inv_room}');
  pend_invitation := public.admin_record_staff_invitation(pend_id,'qa-pending@test.invalid','','game_master','{}');
  execute 'reset role';
  if exists(select 1 from public.staff_accounts where user_id in (inv_id,exp_id,rev_id,pend_id) and active) then
    raise exception 'Invitation granted access before activation'; end if;
  if (select count(*) from public.admin_audit where entity_type='staff_invitations') < 4 then
    raise exception 'Invitations not audited'; end if;

  -- Invitee activation is gated on confirmation, password, and expiry.
  perform set_config('request.jwt.claim.sub',inv_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',inv_sid)::text,true);
  execute 'set local role authenticated';
  if ahaji_private.current_staff_role() is not null then raise exception 'Pending invitee has a role'; end if;
  select status into txt from public.my_staff_invitation();
  if txt <> 'pending' then raise exception 'Own invitation status %', txt; end if;
  result := public.accept_staff_invitation();
  if result->>'status' <> 'unconfirmed' then raise exception 'Unconfirmed accept: %', result; end if;
  execute 'reset role';
  update auth.users set email_confirmed_at = now() where id = inv_id;
  execute 'set local role authenticated';
  result := public.accept_staff_invitation();
  if result->>'status' <> 'password_required' then raise exception 'Passwordless accept: %', result; end if;
  if ahaji_private.current_staff_role() is not null or ahaji_private.can_access_room('qa_inv_room') then
    raise exception 'Access before password setup'; end if;
  execute 'reset role';
  update auth.users set encrypted_password = '$2a$set-by-auth' where id = inv_id;
  execute 'set local role authenticated';
  result := public.accept_staff_invitation();
  if result->>'status' <> 'accepted' or result->>'role' <> 'game_master' then raise exception 'Accept: %', result; end if;
  if ahaji_private.current_staff_role() <> 'game_master' then raise exception 'No role after activation'; end if;
  if not ahaji_private.can_access_room('qa_inv_room') or ahaji_private.can_access_room('qa_inv_other') then
    raise exception 'Room scope wrong after activation'; end if;
  result := public.accept_staff_invitation();
  if result->>'status' <> 'accepted' then raise exception 'Second accept changed state: %', result; end if;
  execute 'reset role';

  -- Expired invitations cannot be activated.
  update public.staff_invitations set expires_at = now() - interval '1 minute' where id = exp_invitation;
  update auth.users set email_confirmed_at = now(), encrypted_password = '$2a$x' where id = exp_id;
  perform set_config('request.jwt.claim.sub',exp_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',exp_sid)::text,true);
  execute 'set local role authenticated';
  result := public.accept_staff_invitation();
  if result->>'status' <> 'expired' then raise exception 'Expired accept: %', result; end if;
  if ahaji_private.current_staff_role() is not null then raise exception 'Expired invitee has a role'; end if;
  execute 'reset role';

  -- Revocation ends the link session and blocks activation.
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  execute 'set local role authenticated';
  perform public.admin_revoke_staff_invitation(rev_invitation);
  denied := false; begin perform public.admin_refresh_staff_invitation(rev_invitation);
    exception when others then denied := true; end;
  if not denied then raise exception 'Revoked invitation resent'; end if;
  denied := false; begin perform public.admin_refresh_staff_invitation(invitation);
    exception when others then denied := true; end;
  if not denied then raise exception 'Accepted invitation resent'; end if;
  denied := false; begin perform public.admin_refresh_staff_invitation(pend_invitation);
    exception when others then denied := true; end;
  if not denied then raise exception 'Resend allowed inside cooldown'; end if;
  execute 'reset role';
  if exists(select 1 from auth.sessions where user_id = rev_id) then raise exception 'Revoked sessions remain'; end if;
  insert into auth.sessions(id,user_id) values (rev_sid,rev_id);
  update auth.users set email_confirmed_at = now(), encrypted_password = '$2a$x' where id = rev_id;
  perform set_config('request.jwt.claim.sub',rev_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',rev_sid)::text,true);
  execute 'set local role authenticated';
  result := public.accept_staff_invitation();
  if result->>'status' <> 'revoked' or ahaji_private.current_staff_role() is not null then
    raise exception 'Revoked accept: %', result; end if;
  execute 'reset role';

  -- Safe resend after the cooldown extends the same pending invitation.
  update public.staff_invitations set last_sent_at = now() - interval '2 minutes',
    expires_at = now() - interval '1 hour' where id = pend_invitation;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  execute 'set local role authenticated';
  select mode into txt from public.admin_refresh_staff_invitation(pend_invitation);
  if txt <> 'reinvite' then raise exception 'Resend mode %', txt; end if;
  select * into r from public.admin_staff_directory() d where d.user_id = pend_id;
  if r.invitation_status <> 'pending' or r.invitation_expires_at <= now() then
    raise exception 'Resend did not extend: %', row_to_json(r); end if;
  -- An activated member is not re-invitable.
  denied := false; begin perform public.admin_prepare_staff_invitation('qa-invitee@test.invalid');
    exception when unique_violation then denied := true; end;
  if not denied then raise exception 'Activated member re-invited'; end if;
  execute 'reset role';
  if (select send_count from public.staff_invitations where id = pend_invitation) <> 2 then
    raise exception 'Send count not incremented'; end if;
  raise notice 'staff_invitations.sql: all checks passed';
end;
$qa$;
rollback;
