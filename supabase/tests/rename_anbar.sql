-- Migration 20261023100000 (anbar displayed as «عنبر 23"). Runs after all
-- migrations on a fresh seed or a restored snapshot; rolled back.
begin;
do $qa$
declare n integer; sessions_before integer; access_before integer; media_before integer;
begin
  if (select name from public.rooms where id = 'anbar') is distinct from 'عنبر 23' then
    raise exception 'anbar is not displayed as عنبر 23'; end if;
  if exists(select 1 from public.rooms where name = 'السجن') then
    raise exception 'A room is still named السجن'; end if;
  select count(*) into sessions_before from public.game_sessions where room_id = 'anbar';
  select count(*) into access_before from public.staff_room_access where room_id = 'anbar';
  select count(*) into media_before from public.room_media where room_id = 'anbar';

  -- Re-running the migration statement changes nothing.
  update public.rooms set name = 'عنبر 23' where id = 'anbar' and name = 'السجن';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Rename is not idempotent'; end if;

  -- A name an Admin chose later is never overwritten.
  update public.rooms set name = 'اسم اختاره المدير' where id = 'anbar';
  update public.rooms set name = 'عنبر 23' where id = 'anbar' and name = 'السجن';
  if (select name from public.rooms where id = 'anbar') <> 'اسم اختاره المدير' then
    raise exception 'Rename overwrote a later Admin name'; end if;

  -- From the old name it renames exactly one row, keeping ID and relations.
  update public.rooms set name = 'السجن' where id = 'anbar';
  update public.rooms set name = 'عنبر 23' where id = 'anbar' and name = 'السجن';
  get diagnostics n = row_count;
  if n <> 1 or (select count(*) from public.game_sessions where room_id = 'anbar') <> sessions_before
    or (select count(*) from public.staff_room_access where room_id = 'anbar') <> access_before
    or (select count(*) from public.room_media where room_id = 'anbar') <> media_before then
    raise exception 'Rename changed more than the display name'; end if;
end;
$qa$;
rollback;
