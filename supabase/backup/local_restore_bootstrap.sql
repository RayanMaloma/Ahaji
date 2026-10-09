-- Disposable PostgreSQL fixture for proving the Phase 3 backup restores.
-- These minimal objects stand in for Supabase-managed schemas and roles.
-- Never apply this file to the hosted Supabase project.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create schema auth;
create table auth.users (id uuid primary key);

create schema storage;
create table storage.buckets (id text primary key);
create table storage.objects (id uuid primary key);

create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key);
insert into supabase_migrations.schema_migrations (version)
values ('20261009232032');
