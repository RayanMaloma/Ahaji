-- One optimistic revision for room settings and all room content. Existing
-- IDs, files, and historical sessions remain untouched by this migration.
alter table public.rooms
  add column content_revision bigint not null default 0
    check (content_revision >= 0);

create function ahaji_private.bump_room_revision()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp as $$
begin
  new.content_revision := old.content_revision + 1;
  return new;
end;
$$;
revoke all on function ahaji_private.bump_room_revision()
  from public, anon, authenticated;
create trigger rooms_bump_revision before update on public.rooms
  for each row execute function ahaji_private.bump_room_revision();

-- Statement triggers also notice edits made by older Admin tabs or trusted
-- operators using the existing row APIs. Each statement bumps a room once.
create function ahaji_private.bump_room_from_hints()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update public.rooms r set updated_at = pg_catalog.clock_timestamp()
    where r.id in (select distinct room_id from new_rows);
  elsif tg_op = 'DELETE' then
    update public.rooms r set updated_at = pg_catalog.clock_timestamp()
    where r.id in (select distinct room_id from old_rows);
  else
    update public.rooms r set updated_at = pg_catalog.clock_timestamp()
    where r.id in (select room_id from new_rows union select room_id from old_rows);
  end if;
  return null;
end;
$$;
revoke all on function ahaji_private.bump_room_from_hints()
  from public, anon, authenticated;
create trigger hints_revision_insert after insert on public.room_hints
  referencing new table as new_rows for each statement
  execute function ahaji_private.bump_room_from_hints();
create trigger hints_revision_update after update on public.room_hints
  referencing old table as old_rows new table as new_rows for each statement
  execute function ahaji_private.bump_room_from_hints();
create trigger hints_revision_delete after delete on public.room_hints
  referencing old table as old_rows for each statement
  execute function ahaji_private.bump_room_from_hints();

create function ahaji_private.bump_room_from_media()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update public.rooms r set updated_at = pg_catalog.clock_timestamp()
    where r.id in (select distinct room_id from new_rows);
  elsif tg_op = 'DELETE' then
    update public.rooms r set updated_at = pg_catalog.clock_timestamp()
    where r.id in (select distinct room_id from old_rows);
  else
    update public.rooms r set updated_at = pg_catalog.clock_timestamp()
    where r.id in (select room_id from new_rows union select room_id from old_rows);
  end if;
  return null;
end;
$$;
revoke all on function ahaji_private.bump_room_from_media()
  from public, anon, authenticated;
create trigger media_revision_insert after insert on public.room_media
  referencing new table as new_rows for each statement
  execute function ahaji_private.bump_room_from_media();
create trigger media_revision_update after update on public.room_media
  referencing old table as old_rows new table as new_rows for each statement
  execute function ahaji_private.bump_room_from_media();
create trigger media_revision_delete after delete on public.room_media
  referencing old table as old_rows for each statement
  execute function ahaji_private.bump_room_from_media();

-- The Data API executes an RPC in one PostgreSQL transaction. File uploads
-- happen beforehand; this function commits all relational changes together.
create function public.admin_save_room_draft(
  p_room_id text, p_expected_revision bigint, p_room jsonb,
  p_hints jsonb default null, p_media jsonb default null)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog, pg_temp as $$
declare
  v_room public.rooms%rowtype;
  v_image text;
  v_hint_ids uuid[] := '{}'::uuid[];
  v_media_ids uuid[] := '{}'::uuid[];
  v_offset integer;
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found' using errcode = 'P0002'; end if;
  if v_room.content_revision <> p_expected_revision then
    raise exception 'Room changed since editing began'
      using errcode = '40001';
  end if;
  if pg_catalog.jsonb_typeof(p_room) <> 'object' then
    raise exception 'Invalid room draft' using errcode = '22023';
  end if;
  v_image := p_room->>'imageRef';
  if v_image is null or (v_image <> v_room.background_ref
    and v_image <> 'images/ahajilogo.svg'
    and v_image !~ ('^storage://room-assets/' || p_room_id || '/[A-Za-z0-9._-]+$')) then
    raise exception 'Invalid room image reference' using errcode = '22023';
  end if;
  update public.rooms set
    name = pg_catalog.btrim(p_room->>'name'),
    description = coalesce(p_room->>'description',''),
    default_duration_seconds = (p_room->>'durationSeconds')::integer,
    is_active = (p_room->>'active')::boolean,
    thumbnail_ref = v_image,
    background_ref = v_image,
    presentation_settings = p_room->'presentation'
  where id = p_room_id;

  if p_hints is not null then
    if pg_catalog.jsonb_typeof(p_hints) <> 'array'
      or pg_catalog.jsonb_array_length(p_hints) > 500
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_hints) e
        where pg_catalog.jsonb_typeof(e) <> 'object'
          or pg_catalog.length(pg_catalog.btrim(e->>'text')) not between 1 and 2000) then
      raise exception 'Invalid hint draft' using errcode = '22023';
    end if;
    select coalesce(pg_catalog.array_agg((e->>'id')::uuid),'{}'::uuid[])
      into v_hint_ids from pg_catalog.jsonb_array_elements(p_hints) e
      where e->>'id' is not null;
    if (select count(*) from pg_catalog.unnest(v_hint_ids) x)
      <> (select count(distinct x) from pg_catalog.unnest(v_hint_ids) x)
      or exists (select 1 from pg_catalog.unnest(v_hint_ids) x
        where not exists (select 1 from public.room_hints h
          where h.id=x and h.room_id=p_room_id)) then
      raise exception 'Hint identity does not belong to room'
        using errcode = '22023';
    end if;
    delete from public.room_hints h where h.room_id=p_room_id
      and h.id <> all(v_hint_ids);
    select coalesce(max(display_order),0)
      + pg_catalog.jsonb_array_length(p_hints) + 1 into v_offset
      from public.room_hints where room_id=p_room_id;
    update public.room_hints h set display_order=h.display_order+v_offset
      where h.room_id=p_room_id and h.id=any(v_hint_ids);
    with desired as (
      select (e.value->>'id')::uuid id,e.value->>'text' body,
        (e.ordinality-1)::integer pos
      from pg_catalog.jsonb_array_elements(p_hints) with ordinality e
      where e.value->>'id' is not null
    )
    update public.room_hints h set body=d.body,display_order=d.pos
      from desired d where h.id=d.id and h.room_id=p_room_id;
    insert into public.room_hints(room_id,body,display_order)
      select p_room_id,e.value->>'text',(e.ordinality-1)::integer
      from pg_catalog.jsonb_array_elements(p_hints) with ordinality e
      where e.value->>'id' is null;
  end if;

  if p_media is not null then
    if pg_catalog.jsonb_typeof(p_media) <> 'array'
      or pg_catalog.jsonb_array_length(p_media) > 200
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_media) e
        where pg_catalog.jsonb_typeof(e) <> 'object'
          or e->>'kind' not in
            ('gm_image','gm_video','gm_sound','hint_sound','lose_sound','lose_video')
          or pg_catalog.length(pg_catalog.btrim(e->>'assetRef')) < 1
          or (e->>'kind' like 'gm_%'
            and pg_catalog.length(pg_catalog.btrim(e->>'label')) < 1)) then
      raise exception 'Invalid media draft' using errcode = '22023';
    end if;
    select coalesce(pg_catalog.array_agg((e->>'id')::uuid),'{}'::uuid[])
      into v_media_ids from pg_catalog.jsonb_array_elements(p_media) e
      where e->>'id' is not null;
    if (select count(*) from pg_catalog.unnest(v_media_ids) x)
      <> (select count(distinct x) from pg_catalog.unnest(v_media_ids) x)
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_media) e
        where e->>'id' is not null and not exists
          (select 1 from public.room_media m where m.id=(e->>'id')::uuid
           and m.room_id=p_room_id and m.kind=e->>'kind'))
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_media) e
        left join public.room_media m on m.id=(e->>'id')::uuid
          and m.room_id=p_room_id
        where (e->>'id' is null or m.asset_ref is distinct from e->>'assetRef')
          and e->>'assetRef' !~
            ('^storage://room-assets/' || p_room_id || '/[A-Za-z0-9._-]+$')) then
      raise exception 'Media identity or file reference is invalid'
        using errcode = '22023';
    end if;
    delete from public.room_media m where m.room_id=p_room_id
      and m.id <> all(v_media_ids);
    select coalesce(max(display_order),0)
      + pg_catalog.jsonb_array_length(p_media) + 1 into v_offset
      from public.room_media where room_id=p_room_id;
    update public.room_media m set display_order=m.display_order+v_offset
      where m.room_id=p_room_id and m.id=any(v_media_ids);
    with desired as (
      select (e.value->>'id')::uuid id,e.value->>'kind' kind,
        e.value->>'label' label,e.value->>'assetRef' asset_ref,
        (e.ordinality-1)::integer pos
      from pg_catalog.jsonb_array_elements(p_media) with ordinality e
      where e.value->>'id' is not null
    )
    update public.room_media m set label=d.label,asset_ref=d.asset_ref,
      display_order=d.pos from desired d
      where m.id=d.id and m.room_id=p_room_id and m.kind=d.kind;
    insert into public.room_media(room_id,kind,label,asset_ref,display_order)
      select p_room_id,e.value->>'kind',e.value->>'label',
        e.value->>'assetRef',(e.ordinality-1)::integer
      from pg_catalog.jsonb_array_elements(p_media) with ordinality e
      where e.value->>'id' is null;
  end if;
  return pg_catalog.jsonb_build_object('revision',
    (select content_revision from public.rooms where id=p_room_id));
end;
$$;
revoke all on function public.admin_save_room_draft(
  text,bigint,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.admin_save_room_draft(
  text,bigint,jsonb,jsonb,jsonb) to authenticated;

