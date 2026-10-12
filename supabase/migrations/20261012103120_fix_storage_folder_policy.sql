-- Qualify the outer Storage object name. An unqualified `name` resolves to
-- public.rooms.name inside the EXISTS subquery and rejects every upload.
drop policy if exists room_assets_admin_insert on storage.objects;
create policy room_assets_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'room-assets'
  and (select ahaji_private.current_staff_role()) = 'admin'
  and exists (select 1 from public.rooms r
    where r.id = (storage.foldername(storage.objects.name))[1]));
