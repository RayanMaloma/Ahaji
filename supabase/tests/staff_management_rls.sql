-- Runs in one transaction and rolls back all trial changes.
begin;
do $qa$
declare uid uuid;sid uuid;blocked boolean:=false;
begin
  select a.user_id,s.id into uid,sid from public.staff_accounts a
    join auth.sessions s on s.user_id=a.user_id join auth.users u on u.id=a.user_id
    where a.role='admin' and a.active and u.email_confirmed_at is not null limit 1;
  if uid is null then raise exception 'A confirmed live Admin session is required';end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',sid)::text,true);
  execute 'set local role authenticated';
  perform public.admin_manage_staff(uid,'admin',true,'{}'::text[]);
  begin perform public.admin_manage_staff(uid,'game_master',true,'{}'::text[]);
  exception when others then blocked:=true;end;
  if not blocked then raise exception 'Last Admin demotion allowed';end if;
  if (select role from public.staff_accounts where user_id=uid)<>'admin' then
    raise exception 'Last Admin role changed';end if;
end;
$qa$;
rollback;
