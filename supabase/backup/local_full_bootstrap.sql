-- Disposable PostgreSQL 17 only. Models the Supabase-managed schemas needed
-- to apply Ahaji migrations. Never run against the hosted project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid(),auth.jwt() to authenticated;

create schema extensions;
create extension pgcrypto with schema extensions;
create schema storage;
create table storage.buckets(
  id text primary key,name text not null,public boolean not null default false,
  file_size_limit bigint,allowed_mime_types text[]
);
create table storage.objects(
  id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),
  name text not null,metadata jsonb,unique(bucket_id,name)
);
alter table storage.objects enable row level security;
create function storage.foldername(p_name text) returns text[] language sql immutable as $$
  select string_to_array(p_name,'/');
$$;
grant usage on schema storage to authenticated;
grant execute on function storage.foldername(text) to authenticated;

create publication supabase_realtime;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key);
