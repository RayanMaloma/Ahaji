\set ON_ERROR_STOP on
begin;
insert into public.rooms (id,name,thumbnail_ref,background_ref)
values ('anbar','Test room','source/test/background.jpg','source/test/background.jpg')
on conflict (id) do nothing;
insert into auth.users (id,email,email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000011','admin@test.invalid',now()),
  ('00000000-0000-4000-8000-000000000012','gm@test.invalid',now());
insert into auth.sessions (id,user_id) values
  ('10000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000012');
insert into public.staff_accounts (user_id,role) values
  ('00000000-0000-4000-8000-000000000011','admin'),
  ('00000000-0000-4000-8000-000000000012','game_master');
insert into public.staff_room_access (user_id,room_id) values
  ('00000000-0000-4000-8000-000000000012','anbar');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
select set_config('request.jwt.claims','{"session_id":"10000000-0000-4000-8000-000000000011"}',true);
do $$ begin
  -- The directory lists every staff account, including any already present
  -- in a restored database, and both fixtures.
  if (select count(*) from public.admin_staff_directory()) <> (select count(*) from public.staff_accounts)
    or (select count(*) from public.admin_staff_directory() where user_id in
      ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012')) <> 2 then
    raise exception 'Admin directory did not return both staff';
  end if;
  if (select room_ids from public.admin_staff_directory()
      where user_id='00000000-0000-4000-8000-000000000012') <> array['anbar']::text[] then
    raise exception 'GM assignment not returned';
  end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',true);
select set_config('request.jwt.claims','{"session_id":"10000000-0000-4000-8000-000000000012","user_metadata":{"role":"admin"}}',true);
do $$ begin
  if (select count(*) from public.admin_staff_directory()) <> 0 then
    raise exception 'GM accessed Admin directory';
  end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
select set_config('request.jwt.claims','{"session_id":"00000000-0000-4000-8000-000000000099"}',true);
do $$ begin
  if (select count(*) from public.admin_staff_directory()) <> 0 then
    raise exception 'Expired session accessed Admin directory';
  end if;
end $$;
rollback;

begin;
set local role anon;
do $$ declare blocked boolean := false; begin
  begin perform public.admin_staff_directory();
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'Anonymous directory execute granted'; end if;
end $$;
rollback;
select 'phase5 directory authorization passed' as result;
