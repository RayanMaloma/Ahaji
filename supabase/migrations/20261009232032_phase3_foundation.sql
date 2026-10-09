-- Phase 3 foundation. Gameplay continues to use the Phase 2 browser adapter.
-- No client-facing policies are added until authentication and roles exist.

-- Make exposure of later public objects opt-in on this new application schema.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

create table public.rooms (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  name text not null check (length(btrim(name)) > 0),
  thumbnail_ref text not null check (length(btrim(thumbnail_ref)) > 0),
  background_ref text not null check (length(btrim(background_ref)) > 0),
  default_duration_seconds integer not null default 3600
    check (default_duration_seconds between 1 and 5999),
  display_order integer not null default 0 check (display_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.room_hints (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  display_order integer not null check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, display_order)
);

create table public.room_media (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  kind text not null check (kind in (
    'hint_sound', 'lose_sound', 'lose_video', 'gm_image', 'gm_sound'
  )),
  label text,
  asset_ref text not null check (length(btrim(asset_ref)) > 0),
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind not in ('gm_image', 'gm_sound') or
    (label is not null and length(btrim(label)) > 0)),
  unique (room_id, kind, display_order)
);

create unique index room_media_one_hint_sound_per_room
  on public.room_media(room_id) where kind = 'hint_sound';
create unique index room_media_one_lose_sound_per_room
  on public.room_media(room_id) where kind = 'lose_sound';
create unique index room_media_one_lose_video_per_room
  on public.room_media(room_id) where kind = 'lose_video';

-- A protected persistence record for Phase 8. No live browser session is
-- migrated or written here in Phase 3. Phase 10 can add an event history.
create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete restrict,
  gm_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'idle'
    check (status in ('idle', 'running', 'paused', 'ended')),
  result text not null default 'normal'
    check (result in ('normal', 'win', 'lose')),
  state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rooms_active_order_idx
  on public.rooms(display_order, id) where is_active;
create index game_sessions_room_created_idx
  on public.game_sessions(room_id, created_at desc);
create index game_sessions_gm_created_idx
  on public.game_sessions(gm_user_id, created_at desc)
  where gm_user_id is not null;

create function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger rooms_touch_updated_at before update on public.rooms
  for each row execute function public.touch_updated_at();
create trigger room_hints_touch_updated_at before update on public.room_hints
  for each row execute function public.touch_updated_at();
create trigger room_media_touch_updated_at before update on public.room_media
  for each row execute function public.touch_updated_at();
create trigger game_sessions_touch_updated_at before update on public.game_sessions
  for each row execute function public.touch_updated_at();

alter table public.rooms enable row level security;
alter table public.room_hints enable row level security;
alter table public.room_media enable row level security;
alter table public.game_sessions enable row level security;

revoke all on public.rooms, public.room_hints, public.room_media,
  public.game_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.rooms, public.room_hints,
  public.room_media, public.game_sessions to service_role;
revoke all on function public.touch_updated_at() from public, anon, authenticated;

comment on column public.rooms.thumbnail_ref is
  'Repository path today; later may hold a portable storage object reference.';
comment on column public.room_media.asset_ref is
  'Repository path today; later may hold a portable storage object reference.';
