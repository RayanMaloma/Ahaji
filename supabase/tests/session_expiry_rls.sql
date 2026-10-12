-- Run on a disposable database or in a rolled-back project transaction.
begin;
do $qa$
declare uid uuid; auth_session uuid; room text; created jsonb; sid uuid;
  token text; first_revision bigint; second_revision bigint; expired_id uuid;
  cast_state jsonb;
begin
  select a.user_id,s.id into uid,auth_session from public.staff_accounts a
    join auth.sessions s on s.user_id=a.user_id join auth.users u on u.id=a.user_id
    where a.role='admin' and a.active and u.email_confirmed_at is not null limit 1;
  select id into room from public.rooms where is_active order by id limit 1;
  if uid is null or room is null then raise exception 'Verified Admin and active room required'; end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',auth_session)::text,true);
  execute 'set local role authenticated';
  created:=public.create_game_session(room);sid:=(created->>'sessionId')::uuid;
  token:=created->>'castToken';
  perform public.game_session_command(room,sid,'start');
  execute 'set local role postgres';
  update public.game_sessions set ends_at=clock_timestamp()-interval '1 second' where id=sid;
  execute 'set local role anon';
  cast_state:=public.cast_session_state(room,sid,token);
  first_revision:=(cast_state->>'revision')::bigint;
  if cast_state->'state'->>'status' <> 'ended' then
    raise exception 'Cast read failed to settle elapsed timer';end if;
  execute 'set local role authenticated';
  select (public.game_session_command(room,sid,'timeout')->>'revision')::bigint
    into second_revision;
  if first_revision<>second_revision or
    (select count(*) from public.session_events where session_id=sid and event_type='timeout')<>1 then
    raise exception 'Timeout repeated or revision regressed';end if;
  created:=public.create_game_session(room);expired_id:=(created->>'sessionId')::uuid;
  execute 'set local role postgres';
  update public.game_sessions set expires_at=clock_timestamp()-interval '1 second'
    where id=expired_id;
  execute 'set local role authenticated';
  perform public.admin_settle_sessions();
  if (select status from public.game_sessions where id=expired_id)<>'ended' or
    (select state->>'lifecycleReason' from public.game_sessions where id=expired_id)<>'expired' or
    (select count(*) from public.session_events where session_id=expired_id and event_type='expired')<>1 then
    raise exception 'Expired session cleanup failed';end if;
end;
$qa$;
rollback;
