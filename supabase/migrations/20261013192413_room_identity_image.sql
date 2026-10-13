-- One room image drives both the Admin card and Cast. Keep both existing
-- columns for old readers, session history, and a reversible data export.
-- The Cast background is canonical to preserve each existing room's display.
update public.rooms
set thumbnail_ref = background_ref
where thumbnail_ref is distinct from background_ref;

alter table public.rooms
  add constraint rooms_single_image check (thumbnail_ref = background_ref);

create function ahaji_private.prevent_room_id_change()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Room identifiers are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger rooms_prevent_id_change
before update of id on public.rooms
for each row execute function ahaji_private.prevent_room_id_change();

comment on constraint rooms_single_image on public.rooms is
  'The same preserved image reference is used for the Admin cover and Cast background.';
