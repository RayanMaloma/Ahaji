-- Run only on a disposable restored database. All probes roll back.
begin;
do $$
declare
  v_rooms integer;
  v_sessions integer;
begin
  select count(*) into v_rooms from public.rooms;
  select count(*) into v_sessions from public.game_sessions;
  if v_rooms <> 5 or v_sessions < 6 then
    raise exception 'Restored room/session counts changed';
  end if;
  if exists(select 1 from public.rooms where thumbnail_ref is distinct from background_ref) then
    raise exception 'A room still has two image references';
  end if;
  if (select background_ref from public.rooms where id='anbar') <> 'source/prison/background.jpg' then
    raise exception 'Original Cast background changed';
  end if;
  begin
    update public.rooms set id='changed' where id='anbar';
    raise exception 'Room ID update was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.rooms set thumbnail_ref='images/ahajilogo.svg' where id='anbar';
    raise exception 'Split room image was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.rooms(id,name,thumbnail_ref,background_ref)
      select id,'نسخة',thumbnail_ref,background_ref from public.rooms where id='anbar';
    raise exception 'Duplicate room ID was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.rooms(id,name,thumbnail_ref,background_ref)
      values('اسم عربي','غرفة','images/ahajilogo.svg','images/ahajilogo.svg');
    raise exception 'Invalid room ID was accepted';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
