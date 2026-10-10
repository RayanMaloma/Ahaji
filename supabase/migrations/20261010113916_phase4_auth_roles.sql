-- Phase 4: authenticated staff identity and database-enforced room access.
-- Browser gameplay remains local until server sessions are approved.

create schema if not exists ahaji_private;
revoke all on schema ahaji_private from public, anon, authenticated;

create table public.staff_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'game_master')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_room_access (
  user_id uuid not null references public.staff_accounts(user_id) on delete cascade,
  room_id text not null references public.rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

create index staff_room_access_room_id_idx on public.staff_room_access(room_id);
create trigger staff_accounts_touch_updated_at before update on public.staff_accounts
  for each row execute function public.touch_updated_at();

alter table public.staff_accounts enable row level security;
alter table public.staff_room_access enable row level security;

-- Read a fresh database role for every request. A JWT role claim or editable
-- user_metadata is never an authority. A revoked Auth session loses access
-- as soon as auth.sessions no longer contains its session_id.
create function ahaji_private.current_staff_role()
returns text language sql stable security definer set search_path = '' as $$
  select sa.role
  from public.staff_accounts sa
  join auth.users u on u.id = sa.user_id
  join auth.sessions s on s.user_id = u.id
  where sa.user_id = (select auth.uid())
    and sa.active
    and u.deleted_at is null
    and u.email_confirmed_at is not null
    and s.id = nullif((select auth.jwt() ->> 'session_id'), '')::uuid
  limit 1;
$$;

create function ahaji_private.can_access_room(p_room_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select ahaji_private.current_staff_role()) = 'admin'
    or ((select ahaji_private.current_staff_role()) = 'game_master'
      and exists (select 1 from public.staff_room_access a
        where a.user_id = (select auth.uid()) and a.room_id = p_room_id)), false);
$$;

revoke all on function ahaji_private.current_staff_role() from public, anon, authenticated;
revoke all on function ahaji_private.can_access_room(text) from public, anon, authenticated;
grant usage on schema ahaji_private to authenticated;
grant execute on function ahaji_private.current_staff_role() to authenticated;
grant execute on function ahaji_private.can_access_room(text) to authenticated;

-- Keep at least one active Admin once the first Admin has been provisioned.
create function ahaji_private.keep_last_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.active and
     (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    perform pg_catalog.pg_advisory_xact_lock(294801, 4);
    if (select count(*) from public.staff_accounts
        where role = 'admin' and active and user_id <> old.user_id) = 0 then
      raise exception 'At least one active Admin is required';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function ahaji_private.keep_last_admin() from public, anon, authenticated;
create trigger staff_keep_last_admin before update or delete on public.staff_accounts
  for each row execute function ahaji_private.keep_last_admin();

revoke all on public.staff_accounts, public.staff_room_access from public, anon, authenticated;
grant select, insert, update, delete on public.staff_accounts, public.staff_room_access to authenticated;
grant select, insert, update, delete on public.staff_accounts, public.staff_room_access to service_role;

create policy staff_select on public.staff_accounts for select to authenticated
  using (user_id = (select auth.uid()) and (select ahaji_private.current_staff_role()) is not null
    or (select ahaji_private.current_staff_role()) = 'admin');
create policy staff_admin_insert on public.staff_accounts for insert to authenticated
  with check ((select ahaji_private.current_staff_role()) = 'admin');
create policy staff_admin_update on public.staff_accounts for update to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin')
  with check ((select ahaji_private.current_staff_role()) = 'admin');
create policy staff_admin_delete on public.staff_accounts for delete to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin');

create policy staff_rooms_select on public.staff_room_access for select to authenticated
  using (user_id = (select auth.uid()) and (select ahaji_private.current_staff_role()) is not null
    or (select ahaji_private.current_staff_role()) = 'admin');
create policy staff_rooms_admin_insert on public.staff_room_access for insert to authenticated
  with check ((select ahaji_private.current_staff_role()) = 'admin');
create policy staff_rooms_admin_update on public.staff_room_access for update to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin')
  with check ((select ahaji_private.current_staff_role()) = 'admin');
create policy staff_rooms_admin_delete on public.staff_room_access for delete to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin');

grant select, insert, update, delete on public.rooms, public.room_hints,
  public.room_media to authenticated;
grant select on public.game_sessions to authenticated;

create policy rooms_staff_select on public.rooms for select to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin'
    or (is_active and (select ahaji_private.can_access_room(id))));
create policy rooms_admin_insert on public.rooms for insert to authenticated
  with check ((select ahaji_private.current_staff_role()) = 'admin');
create policy rooms_admin_update on public.rooms for update to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin')
  with check ((select ahaji_private.current_staff_role()) = 'admin');
create policy rooms_admin_delete on public.rooms for delete to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin');

create policy hints_staff_select on public.room_hints for select to authenticated
  using ((select ahaji_private.can_access_room(room_id)));
create policy hints_admin_insert on public.room_hints for insert to authenticated
  with check ((select ahaji_private.current_staff_role()) = 'admin');
create policy hints_admin_update on public.room_hints for update to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin')
  with check ((select ahaji_private.current_staff_role()) = 'admin');
create policy hints_admin_delete on public.room_hints for delete to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin');

create policy media_staff_select on public.room_media for select to authenticated
  using ((select ahaji_private.can_access_room(room_id)));
create policy media_admin_insert on public.room_media for insert to authenticated
  with check ((select ahaji_private.current_staff_role()) = 'admin');
create policy media_admin_update on public.room_media for update to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin')
  with check ((select ahaji_private.current_staff_role()) = 'admin');
create policy media_admin_delete on public.room_media for delete to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin');

create policy sessions_admin_read on public.game_sessions for select to authenticated
  using ((select ahaji_private.current_staff_role()) = 'admin');
