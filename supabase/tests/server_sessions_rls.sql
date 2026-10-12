-- Run only against gbhleqizxcmxmutgcjon or an equivalent disposable clone.
-- Uses an existing confirmed Admin session, creates temporary game data, and rolls it back.
begin;
do $qa$
declare uid uuid; sid uuid; created jsonb; game_id uuid; token text;
  result jsonb; blocked boolean:=false;
begin
  select a.user_id,s.id into uid,sid from public.staff_accounts a
    join auth.sessions s on s.user_id=a.user_id join auth.users u on u.id=a.user_id
    where a.role='admin' and a.active and u.email_confirmed_at is not null limit 1;
  if uid is null then raise exception 'A confirmed live Admin session is required';end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id',sid)::text,true);
  execute 'set local role authenticated';
  created:=public.create_game_session('anbar');
  game_id:=(created->>'sessionId')::uuid;token:=created->>'castToken';
  if length(token)<>48 then raise exception 'Pairing token is invalid';end if;
  result:=public.game_session_command('anbar',game_id,'start','{}'::jsonb);
  if result->'state'->>'status'<>'running' then raise exception 'Start failed';end if;
  result:=public.game_session_command('anbar',game_id,'hint','{"text":"QA hint"}'::jsonb);
  if result->'state'->>'hintText'<>'QA hint' then raise exception 'Hint failed';end if;
  result:=public.cast_session_state('anbar',game_id,token);
  if result->'state'->>'hintText'<>'QA hint' then raise exception 'Cast sync failed';end if;
  begin perform public.cast_session_state('haram',game_id,token);
  exception when others then blocked:=true;end;
  if not blocked then raise exception 'Cross-room Cast access allowed';end if;
  blocked:=false;
  begin perform public.game_session_command('anbar',game_id,'scale','{}'::jsonb);
  exception when others then blocked:=true;end;
  if not blocked then raise exception 'NULL image scale accepted';end if;
  blocked:=false;
  begin perform public.game_session_command('anbar',game_id,'signal','{}'::jsonb);
  exception when others then blocked:=true;end;
  if not blocked then raise exception 'NULL signal type accepted';end if;
  result:=public.game_session_command('anbar',game_id,'win','{}'::jsonb);
  if result->'state'->>'viewMode'<>'win' then raise exception 'Win failed';end if;
  if (select count(*) from public.session_events where session_id=game_id)<4 then
    raise exception 'Event history missing';end if;
end;
$qa$;
rollback;
