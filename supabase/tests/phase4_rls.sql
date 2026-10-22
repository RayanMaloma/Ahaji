\set ON_ERROR_STOP on
-- Runs on a freshly seeded or a restored disposable database; all changes
-- roll back. Counts that depend on existing data compare with a baseline.
begin;
-- Existing staff are deactivated inside the transaction so the last-Admin
-- guard below is exercised against the fixture Admin alone.
insert into auth.users (id,email,email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000001','admin@test.invalid',now()),
  ('00000000-0000-4000-8000-000000000002','gm@test.invalid',now()),
  ('00000000-0000-4000-8000-000000000003','outsider@test.invalid',now());
insert into auth.sessions (id,user_id) values
  ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003');
insert into public.staff_accounts (user_id,role) values
  ('00000000-0000-4000-8000-000000000001','admin'),
  ('00000000-0000-4000-8000-000000000002','game_master');
insert into public.staff_room_access (user_id,room_id) values
  ('00000000-0000-4000-8000-000000000002','anbar');
update public.staff_accounts set active=false
  where user_id not in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
create temp table baseline on commit drop as select
  (select count(*) from public.rooms) as rooms,
  (select count(*) from public.staff_accounts) as staff,
  (select count(*) from public.staff_room_access) as access;
grant select on baseline to authenticated;

create function pg_temp.assert_equals(actual bigint, expected bigint, label text)
returns void language plpgsql as $$ begin
  if actual is distinct from expected then
    raise exception '%: expected %, got %', label, expected, actual;
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"session_id":"10000000-0000-4000-8000-000000000002","user_metadata":{"role":"admin"}}',true);
select pg_temp.assert_equals((select count(*) from public.rooms),1,'GM rooms');
select pg_temp.assert_equals((select count(*) from public.room_hints where room_id='haram'),0,'GM other hints');
select pg_temp.assert_equals((select count(*) from public.staff_accounts),1,'GM staff visibility');
select pg_temp.assert_equals((select count(*) from public.game_sessions),0,'GM sessions');
do $$ begin
  if (select role from public.staff_accounts) <> 'game_master' then
    raise exception 'JWT user_metadata escalated GM';
  end if;
  update public.rooms set name='tampered' where id='anbar';
  if found then raise exception 'GM updated room'; end if;
end $$;
do $$ declare blocked boolean := false; begin
  begin
    insert into public.staff_accounts (user_id,role)
      values ('00000000-0000-4000-8000-000000000003','admin');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'GM self-escalation was accepted'; end if;
end $$;

select set_config('request.jwt.claims','{"session_id":"00000000-0000-4000-8000-000000000099"}',true);
select pg_temp.assert_equals((select count(*) from public.rooms),0,'Expired session rooms');
select pg_temp.assert_equals((select count(*) from public.staff_accounts),0,'Expired session role');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"session_id":"10000000-0000-4000-8000-000000000003","user_metadata":{"role":"admin"}}',true);
select pg_temp.assert_equals((select count(*) from public.rooms),0,'Unassigned user rooms');
select pg_temp.assert_equals((select count(*) from public.staff_accounts),0,'Unassigned user role');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"session_id":"10000000-0000-4000-8000-000000000001"}',true);
select pg_temp.assert_equals((select count(*) from public.rooms),(select rooms from baseline),'Admin rooms');
select pg_temp.assert_equals((select count(*) from public.staff_accounts),(select staff from baseline),'Admin staff visibility');
select pg_temp.assert_equals((select count(*) from public.staff_room_access),(select access from baseline),'Admin assignments');
-- Even an Admin cannot write roles or assignments directly; they change
-- only through the trusted staff functions (20261011180939).
do $$ declare blocked boolean := false; begin
  begin
    insert into public.staff_accounts (user_id,role)
      values ('00000000-0000-4000-8000-000000000003','admin');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'Admin wrote staff_accounts directly'; end if;
  blocked := false;
  begin
    insert into public.staff_room_access (user_id,room_id)
      values ('00000000-0000-4000-8000-000000000002','haram');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'Admin wrote staff_room_access directly'; end if;
end $$;
select pg_temp.assert_equals((select count(*) from public.staff_accounts),(select staff from baseline),'Admin role assignment');

reset role;
update public.rooms set is_active=false where id='anbar';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"session_id":"10000000-0000-4000-8000-000000000002"}',true);
select pg_temp.assert_equals((select count(*) from public.rooms where id='anbar'),0,'Inactive GM room');
select pg_temp.assert_equals((select count(*) from public.room_hints where room_id='anbar'),0,'Inactive GM hints');
select pg_temp.assert_equals((select count(*) from public.room_media where room_id='anbar'),0,'Inactive GM media');
reset role;
do $$ begin
  begin
    update public.staff_accounts set active=false
      where user_id='00000000-0000-4000-8000-000000000001';
    raise exception 'Last Admin deactivation succeeded';
  exception when raise_exception then
    if sqlerrm <> 'At least one active Admin is required' then raise; end if;
  end;
end $$;
do $$ begin
  begin
    delete from public.staff_accounts
      where user_id='00000000-0000-4000-8000-000000000001';
    raise exception 'Last Admin deletion succeeded';
  exception when raise_exception then
    if sqlerrm <> 'At least one active Admin is required' then raise; end if;
  end;
end $$;
update public.staff_accounts set active=false
  where user_id='00000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"session_id":"10000000-0000-4000-8000-000000000002"}',true);
select pg_temp.assert_equals((select count(*) from public.rooms),0,'Revoked GM rooms');
rollback;
select 'phase4 RLS assertions passed' as result;
