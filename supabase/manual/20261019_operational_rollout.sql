-- Optional one-time rollout for operational accounts. RUN ONLY WITH EXPLICIT
-- PRODUCT OWNER APPROVAL, after migration 20261019120000 and after both
-- operational accounts exist and are marked in Admin → فريق العمل.
-- Everything here can also be done in the Admin UI (room settings for the
-- name, ربط الغرف for assignments); the script is the deterministic version.
--
-- Effects, in one transaction:
--   * anbar is displayed as «عنبر 23» (ID and relationships unchanged)
--   * venue account  ← anbar, haram, saleh
--   * events account ← the single room named «أسرار الفاو»
-- It aborts without changes if an account or room is missing or ambiguous,
-- or if any of these rooms has a running or paused game.
begin;
do $rollout$
declare v_venue uuid; v_events uuid; v_faw text; v_count integer;
begin
  select user_id into v_venue from public.staff_accounts where operational_slot = 'venue';
  select user_id into v_events from public.staff_accounts where operational_slot = 'events';
  if v_venue is null or v_events is null then
    raise exception 'Mark both operational accounts in فريق العمل first'; end if;
  select count(*), min(id) into v_count, v_faw from public.rooms where name = 'أسرار الفاو';
  if v_count <> 1 then raise exception 'Expected exactly one room named أسرار الفاو, found %', v_count; end if;
  if (select count(*) from public.rooms where id in ('anbar','haram','saleh')) <> 3 then
    raise exception 'A permanent venue room is missing'; end if;
  if exists(select 1 from public.game_sessions where room_id in ('anbar','haram','saleh',v_faw)
      and status in ('running','paused') and expires_at > now()) then
    raise exception 'Finish running games before rollout'; end if;

  update public.rooms set name = 'عنبر 23' where id = 'anbar' and name <> 'عنبر 23';
  delete from public.staff_room_access a using public.staff_accounts s
    where s.user_id = a.user_id and s.operational_slot is not null
      and a.room_id in ('anbar','haram','saleh',v_faw);
  insert into public.staff_room_access(user_id, room_id) values
    (v_venue,'anbar'),(v_venue,'haram'),(v_venue,'saleh'),(v_events,v_faw);
  raise notice 'Rollout applied: venue=anbar,haram,saleh events=%', v_faw;
end;
$rollout$;
commit;
