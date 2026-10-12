-- Disposable PostgreSQL restore only. This test creates Auth fixtures and
-- rolls back every change. Never use its synthetic identities on hosted Auth.
begin;
grant select,insert,update,delete on storage.objects to authenticated;
do $qa$
declare admin_id uuid; admin_sid uuid:='11111111-1111-4111-8111-111111111111';
  operator_id uuid:='22222222-2222-4222-8222-222222222222';
  operator_sid uuid:='33333333-3333-4333-8333-333333333333';
  game jsonb; game_id uuid; response jsonb; denied boolean;
begin
  select user_id into admin_id from public.staff_accounts
    where role='admin' and active limit 1;
  if admin_id is null then raise exception 'Admin fixture missing'; end if;
  insert into auth.sessions(id,user_id) values(admin_sid,admin_id);
  insert into auth.users(id,email,email_confirmed_at)
    values(operator_id,'operator-qa@operators.ahaji.invalid',null);
  insert into public.staff_accounts(user_id,role,active,account_type,login_name)
    values(operator_id,'game_master',true,'operator','qaoperator_fixture');
  insert into auth.sessions(id,user_id) values(operator_sid,operator_id);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',admin_sid)::text,true);
  insert into public.staff_profiles(user_id,display_name)
    values(admin_id,'QA Admin')
    on conflict(user_id) do update set display_name=excluded.display_name;
  denied:=false;
  begin insert into public.staff_profiles(user_id,display_name)
    values(operator_id,'Impersonated');
  exception when others then denied:=true; end;
  if not denied then raise exception 'Admin inserted another owner profile'; end if;

  denied:=false;
  begin perform public.admin_manage_staff(operator_id,'admin',true,'{}'::text[]);
  exception when others then denied:=true; end;
  if not denied then raise exception 'Operator promoted to Admin'; end if;

  insert into public.rooms(id,name,thumbnail_ref,background_ref,presentation_settings)
    values('qa_refinement','QA room','images/ahajilogo.svg','images/ahajilogo.svg',
      jsonb_set((select presentation_settings from public.rooms limit 1),
        '{hintDurationSeconds}','5'::jsonb));
  game:=public.create_game_session('qa_refinement');
  game_id:=(game->>'sessionId')::uuid;
  update public.rooms set is_active=false where id='qa_refinement';
  if (select is_active from public.rooms where id='qa_refinement') then
    raise exception 'Room deactivation failed'; end if;
  denied:=false;
  begin perform public.create_game_session('qa_refinement');
  exception when others then denied:=true; end;
  if not denied then raise exception 'Inactive room accepted new session'; end if;
  response:=public.game_session_command('qa_refinement',game_id,'start','{}'::jsonb);
  response:=public.game_session_command('qa_refinement',game_id,'hint',
    '{"text":"QA hint"}'::jsonb);
  if (response->'state'->>'hintExpiresAt') is null then
    raise exception 'Hint expiry not server-stamped'; end if;
  denied:=false;
  begin update public.rooms set presentation_settings='{}'::jsonb
    where id='qa_refinement';
  exception when others then denied:=true; end;
  if not denied then raise exception 'Invalid presentation accepted'; end if;

  insert into storage.objects(bucket_id,name)
    values('profile-assets',admin_id::text||'/qa.png');
  perform set_config('request.jwt.claim.sub',operator_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',operator_sid)::text,true);
  if (select ahaji_private.current_staff_role())<>'game_master' then
    raise exception 'Operator without real email not authorized as GM'; end if;
  insert into public.staff_profiles(user_id,display_name)
    values(operator_id,'QA Operator');
  update public.staff_profiles set display_name='Changed' where user_id=admin_id;
  if (select display_name from public.staff_profiles where user_id=admin_id)='Changed' then
    raise exception 'Cross-profile update succeeded'; end if;
  denied:=false;
  begin insert into storage.objects(bucket_id,name)
    values('profile-assets',admin_id::text||'/stolen.png');
  exception when others then denied:=true; end;
  if not denied then raise exception 'Cross-profile Storage write succeeded'; end if;
  denied:=false;
  begin update public.rooms set name='Stolen' where id='qa_refinement';
  exception when others then denied:=true; end;
  if not denied and (select name from public.rooms where id='qa_refinement')='Stolen' then
    raise exception 'Operator edited room'; end if;
end;
$qa$;
rollback;
