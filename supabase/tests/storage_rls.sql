-- Disposable database only. Supabase Storage supplies its own object grants.
begin;
grant select,insert,update,delete on storage.objects to authenticated;
do $qa$
declare uid uuid; sid uuid; denied boolean := false;
begin
  select a.user_id,s.id into uid,sid from public.staff_accounts a
    join auth.sessions s on s.user_id=a.user_id join auth.users u on u.id=a.user_id
    where a.role='admin' and a.active and u.email_confirmed_at is not null limit 1;
  if uid is null then raise exception 'A confirmed live Admin session is required'; end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',sid)::text,true);
  execute 'set local role authenticated';
  insert into storage.objects(bucket_id,name)
    values('room-assets','anbar/qa_storage_policy.jpg');
  if not exists (select 1 from storage.objects where name='anbar/qa_storage_policy.jpg')
    then raise exception 'Admin Storage insert failed'; end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
  perform set_config('request.jwt.claims','{"session_id":"00000000-0000-0000-0000-000000000000"}',true);
  begin
    insert into storage.objects(bucket_id,name)
      values('room-assets','anbar/qa_storage_denied.jpg');
  exception when others then denied := true; end;
  if not denied then raise exception 'Unassigned user uploaded to Storage'; end if;
end;
$qa$;
rollback;
