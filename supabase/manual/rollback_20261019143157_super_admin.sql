-- Rollback for 20261019143157_super_admin_and_account_deletion.
-- Generated from backups/pre-super-admin-20261019.json (captured 2026-10-19T14:27:13.94512+00:00).
-- Run only with Product Owner approval, in one transaction. It restores the
-- previous function definitions and grants and removes the added objects.
-- Accounts already deleted through staff-account-delete cannot be restored
-- here: their Auth identities are gone (the tombstone table is dropped too).
begin;
CREATE OR REPLACE FUNCTION public.admin_manage_staff(p_user_id uuid, p_role text, p_active boolean, p_room_ids text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count integer; v_type text;
begin
  if (select ahaji_private.current_staff_role()) is distinct from 'admin' then
    raise exception 'Admin access required'; end if;
  if p_role not in ('admin','game_master') or p_active is null then
    raise exception 'Invalid staff role or status'; end if;
  select account_type into v_type from public.staff_accounts
    where user_id=p_user_id for update;
  if not found then raise exception 'Staff account not found'; end if;
  if v_type='operator' and p_role <> 'game_master' then
    raise exception 'Operator accounts cannot become Admin'; end if;
  select count(distinct x) into v_count
    from unnest(coalesce(p_room_ids,'{}'::text[])) x;
  if v_count <> coalesce(cardinality(p_room_ids),0) then
    raise exception 'Duplicate room assignment'; end if;
  if p_role='game_master' and exists (
    select 1 from unnest(coalesce(p_room_ids,'{}'::text[])) x
    where not exists(select 1 from public.rooms r where r.id=x and r.is_active)
  ) then raise exception 'An assigned room is unavailable'; end if;
  update public.staff_accounts set role=p_role,active=p_active where user_id=p_user_id;
  delete from public.staff_room_access where user_id=p_user_id;
  if p_role='game_master' then
    insert into public.staff_room_access(user_id,room_id)
      select p_user_id,x from unnest(coalesce(p_room_ids,'{}'::text[])) x;
  end if;
end;
$function$;
drop function if exists public.admin_prepare_staff_deletion(uuid);
drop function if exists public.admin_deleted_staff();
drop table if exists public.deleted_staff_accounts;
drop function public.admin_staff_directory();
CREATE OR REPLACE FUNCTION public.admin_staff_directory()
 RETURNS TABLE(user_id uuid, email text, email_confirmed boolean, role text, active boolean, created_at timestamp with time zone, room_ids text[], display_name text, avatar_ref text, account_type text, login_name text, operational_slot text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select sa.user_id,
    case when sa.account_type='email' then u.email::text else null end,
    (sa.account_type='email' and u.email_confirmed_at is not null),
    sa.role,sa.active,sa.created_at,
    coalesce(array_agg(a.room_id order by a.room_id)
      filter(where a.room_id is not null),'{}'::text[]),
    coalesce(p.display_name,''),p.avatar_ref,sa.account_type,sa.login_name,sa.operational_slot
  from public.staff_accounts sa join auth.users u on u.id=sa.user_id
  left join public.staff_room_access a on a.user_id=sa.user_id
  left join public.staff_profiles p on p.user_id=sa.user_id
  where (select ahaji_private.current_staff_role())='admin'
  group by sa.user_id,u.email,u.email_confirmed_at,sa.role,sa.active,
    sa.created_at,p.display_name,p.avatar_ref,sa.account_type,sa.login_name,sa.operational_slot;
$function$;
drop trigger if exists staff_accounts_protect_super_admin on public.staff_accounts;
drop function if exists ahaji_private.protect_super_admin_flag();
drop function if exists ahaji_private.is_super_admin();
alter table public.staff_accounts drop constraint if exists staff_reserved_login_names;
alter table public.staff_accounts drop constraint if exists staff_super_admin_valid;
alter table public.staff_accounts drop column if exists is_super_admin;
revoke all on function public.admin_manage_staff(uuid,text,boolean,text[]) from public, anon, authenticated;
revoke all on function public.admin_staff_directory() from public, anon, authenticated;
grant execute on function public.admin_manage_staff(uuid,text,boolean,text[]) to authenticated;
grant execute on function public.admin_staff_directory() to authenticated;
grant execute on function public.admin_set_operational_slot(uuid,text) to authenticated;
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema = 'supabase_migrations'
      and table_name = 'schema_migrations' and column_name = 'name') then
    execute $q$delete from supabase_migrations.schema_migrations where name = 'super_admin_and_account_deletion'$q$;
  end if;
end $$;
commit;
