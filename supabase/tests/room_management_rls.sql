-- Disposable or project-scoped transaction; all trial rows are rolled back.
begin;
do $qa$
declare uid uuid;sid uuid;ids uuid[];blocked boolean:=false;
begin
  select a.user_id,s.id into uid,sid from public.staff_accounts a
    join auth.sessions s on s.user_id=a.user_id join auth.users u on u.id=a.user_id
    where a.role='admin' and a.active and u.email_confirmed_at is not null limit 1;
  if uid is null then raise exception 'A confirmed live Admin session is required';end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',sid)::text,true);
  execute 'set local role authenticated';
  insert into public.rooms(id,name,thumbnail_ref,background_ref,description)
    values('qa_room','QA room','images/ahajilogo.svg','images/ahajilogo.svg','QA');
  insert into public.room_hints(room_id,body,display_order) values
    ('qa_room','First',0),('qa_room','Second',1);
  select array_agg(id order by display_order desc) into ids from public.room_hints where room_id='qa_room';
  perform public.admin_reorder_hints('qa_room',ids);
  if (select body from public.room_hints where room_id='qa_room' order by display_order limit 1)<>'Second'
    then raise exception 'Hint reorder failed';end if;
  insert into public.room_media(room_id,kind,label,asset_ref)
    values('qa_room','gm_image','QA image','images/prison.jpg');
  update public.rooms set name='Edited QA room',is_active=false where id='qa_room';
  if (select is_active from public.rooms where id='qa_room') then raise exception 'Archive failed';end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
  perform set_config('request.jwt.claims','{"session_id":"00000000-0000-0000-0000-000000000000"}',true);
  begin insert into public.rooms(id,name,thumbnail_ref,background_ref)
    values('qa_denied','Denied','images/ahajilogo.svg','images/ahajilogo.svg');
  exception when others then blocked:=true;end;
  if not blocked then raise exception 'Unassigned user created a room';end if;
end;
$qa$;
rollback;
