-- Room management and media storage. Existing room IDs and content are retained.
alter table public.rooms add column description text not null default ''
  check (length(description) <= 2000);

-- Do not archive a room while a live game is using it.
create function ahaji_private.prevent_active_room_archive()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.is_active and not new.is_active and exists (
    select 1 from public.game_sessions s where s.room_id = old.id
      and s.status in ('idle','running','paused')
  ) then
    raise exception 'A room with an active session cannot be archived';
  end if;
  return new;
end;
$$;
revoke all on function ahaji_private.prevent_active_room_archive() from public, anon, authenticated;
create trigger rooms_prevent_active_archive before update of is_active on public.rooms
  for each row execute function ahaji_private.prevent_active_room_archive();

-- Atomic ordering avoids unique(room_id, display_order) collisions.
create function public.admin_reorder_hints(p_room_id text, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_id uuid; v_position integer := 0;
begin
  if (select ahaji_private.current_staff_role()) <> 'admin' then
    raise exception 'Admin access required';
  end if;
  perform 1 from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  select count(*) into v_count from public.room_hints where room_id = p_room_id;
  if cardinality(p_ids) <> v_count or
     (select count(distinct x) from unnest(p_ids) x) <> v_count or
     (select count(*) from public.room_hints where room_id = p_room_id and id = any(p_ids)) <> v_count then
    raise exception 'Hint order must contain every hint exactly once';
  end if;
  update public.room_hints set display_order = display_order + 1000000
    where room_id = p_room_id;
  foreach v_id in array p_ids loop
    update public.room_hints set display_order = v_position where id = v_id;
    v_position := v_position + 1;
  end loop;
end;
$$;
revoke all on function public.admin_reorder_hints(text, uuid[]) from public, anon, authenticated;
grant execute on function public.admin_reorder_hints(text, uuid[]) to authenticated;

-- Cast does not require a staff account to fetch presentation assets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('room-assets', 'room-assets', true, 10485760,
  array['image/jpeg','image/png','image/webp','image/gif',
        'audio/mpeg','audio/ogg','audio/wav','audio/mp4',
        'video/mp4','video/webm'])
on conflict (id) do nothing;

create policy room_assets_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'room-assets'
  and (select ahaji_private.current_staff_role()) = 'admin'
  and exists (select 1 from public.rooms r
    where r.id = (storage.foldername(name))[1]));
create policy room_assets_admin_select on storage.objects for select to authenticated
using (bucket_id = 'room-assets' and (select ahaji_private.current_staff_role()) = 'admin');
create policy room_assets_admin_update on storage.objects for update to authenticated
using (bucket_id = 'room-assets' and (select ahaji_private.current_staff_role()) = 'admin')
with check (bucket_id = 'room-assets' and (select ahaji_private.current_staff_role()) = 'admin');
create policy room_assets_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'room-assets' and (select ahaji_private.current_staff_role()) = 'admin');

-- Storage itself serves public object bytes for the public bucket. Database
-- catalog visibility remains governed by existing staff RLS.
