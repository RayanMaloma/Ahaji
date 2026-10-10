-- Read-only staff directory. Auth email remains in the managed Auth schema.
-- This function returns rows only for a currently authorized Admin session.
create function public.admin_staff_directory()
returns table (
  user_id uuid,
  email text,
  email_confirmed boolean,
  role text,
  active boolean,
  created_at timestamptz,
  room_ids text[]
)
language sql stable security definer set search_path = '' as $$
  select sa.user_id, u.email::text, u.email_confirmed_at is not null,
    sa.role, sa.active, sa.created_at,
    coalesce(array_agg(a.room_id order by a.room_id)
      filter (where a.room_id is not null), '{}'::text[])
  from public.staff_accounts sa
  join auth.users u on u.id = sa.user_id
  left join public.staff_room_access a on a.user_id = sa.user_id
  where (select ahaji_private.current_staff_role()) = 'admin'
  group by sa.user_id, u.email, u.email_confirmed_at, sa.role,
    sa.active, sa.created_at;
$$;
revoke all on function public.admin_staff_directory() from public, anon, authenticated;
grant execute on function public.admin_staff_directory() to authenticated;
