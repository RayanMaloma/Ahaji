-- Trusted staff mutations and an Admin-only operational audit trail.
create table public.admin_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_record jsonb,
  after_record jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_created_idx on public.admin_audit(created_at desc);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from public, anon, authenticated;
grant select on public.admin_audit to authenticated;
create policy admin_audit_read on public.admin_audit for select to authenticated
using ((select ahaji_private.current_staff_role())='admin');

create function ahaji_private.audit_staff_and_content()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old jsonb;v_new jsonb;v_id text;
begin
  if tg_op <> 'INSERT' then v_old:=to_jsonb(old);end if;
  if tg_op <> 'DELETE' then v_new:=to_jsonb(new);end if;
  v_id:=coalesce(v_new->>'id',v_old->>'id',v_new->>'user_id',v_old->>'user_id');
  insert into public.admin_audit(actor_user_id,action,entity_type,entity_id,before_record,after_record)
    values(auth.uid(),lower(tg_op),tg_table_name,coalesce(v_id,''),v_old,v_new);
  if tg_op='DELETE' then return old;end if;
  return new;
end;
$$;
revoke all on function ahaji_private.audit_staff_and_content() from public, anon, authenticated;
create trigger audit_rooms after insert or update or delete on public.rooms
  for each row execute function ahaji_private.audit_staff_and_content();
create trigger audit_hints after insert or update or delete on public.room_hints
  for each row execute function ahaji_private.audit_staff_and_content();
create trigger audit_media after insert or update or delete on public.room_media
  for each row execute function ahaji_private.audit_staff_and_content();
create trigger audit_staff after insert or update or delete on public.staff_accounts
  for each row execute function ahaji_private.audit_staff_and_content();
create trigger audit_assignments after insert or delete on public.staff_room_access
  for each row execute function ahaji_private.audit_staff_and_content();

-- Remove broad table writes; the Edge Function can provision via its server
-- secret, while browser Admins use this validated atomic function.
revoke insert, update, delete on public.staff_accounts,public.staff_room_access from authenticated;
create function public.admin_manage_staff(p_user_id uuid,p_role text,p_active boolean,p_room_ids text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if (select ahaji_private.current_staff_role()) <> 'admin' then
    raise exception 'Admin access required'; end if;
  if p_role not in ('admin','game_master') or p_active is null then
    raise exception 'Invalid staff role or status'; end if;
  perform 1 from public.staff_accounts where user_id=p_user_id for update;
  if not found then raise exception 'Staff account not found';end if;
  select count(distinct x) into v_count from unnest(coalesce(p_room_ids,'{}'::text[])) x;
  if v_count <> coalesce(cardinality(p_room_ids),0) then
    raise exception 'Duplicate room assignment';end if;
  if p_role='game_master' and exists (
    select 1 from unnest(coalesce(p_room_ids,'{}'::text[])) x
    where not exists(select 1 from public.rooms r where r.id=x and r.is_active)
  ) then raise exception 'An assigned room is unavailable';end if;
  update public.staff_accounts set role=p_role,active=p_active where user_id=p_user_id;
  delete from public.staff_room_access where user_id=p_user_id;
  if p_role='game_master' then
    insert into public.staff_room_access(user_id,room_id)
      select p_user_id,x from unnest(coalesce(p_room_ids,'{}'::text[])) x;
  end if;
end;
$$;
revoke all on function public.admin_manage_staff(uuid,text,boolean,text[]) from public, anon, authenticated;
grant execute on function public.admin_manage_staff(uuid,text,boolean,text[]) to authenticated;
