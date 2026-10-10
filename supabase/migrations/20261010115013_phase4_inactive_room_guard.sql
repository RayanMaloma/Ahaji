-- Assigned Game Masters may read content only while the room is active.
create or replace function ahaji_private.can_access_room(p_room_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select ahaji_private.current_staff_role()) = 'admin'
    or ((select ahaji_private.current_staff_role()) = 'game_master'
      and exists (select 1 from public.staff_room_access a
        join public.rooms r on r.id = a.room_id
        where a.user_id = (select auth.uid())
          and a.room_id = p_room_id and r.is_active)), false);
$$;
