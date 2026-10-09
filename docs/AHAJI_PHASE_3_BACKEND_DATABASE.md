# Phase 3: Backend and database foundation

Date: 2026-10-10. Target Supabase project: `gbhleqizxcmxmutgcjon` only.

## Approved baseline and scope

Phase 2 commit `364808d` was verified on `codex/phase-2-session-adapter` with a clean worktree. Phase 3 lives on `codex/phase-3-backend-database`. Before migration, the target project had no `public` application objects, migrations, Auth users, Storage buckets, or Storage objects. The browser still gets rooms from `js/app.js` and gameplay sessions from the Phase 2 localStorage/BroadcastChannel adapter. No browser credential or network gameplay change was made.

## Schema

The source of truth is [`supabase/migrations/20261009232032_phase3_foundation.sql`](../supabase/migrations/20261009232032_phase3_foundation.sql), matching the recorded remote migration version.

| Table | Purpose | Key relationships and constraints |
| --- | --- | --- |
| `rooms` | Room names, image references, default duration, order, active status. | Text room ID matches existing URLs; duration 1–5999 seconds. |
| `room_hints` | Editable ordered hint text. | Room FK, nonempty text, unique position within a room. |
| `room_media` | Ordered image/audio/video references and GM labels. | Room FK, allowed media kinds, unique position per kind; one hint sound and each loss medium per room. |
| `game_sessions` | Protected future server snapshot and history anchor. | UUID ID, room FK, optional Auth GM ID, status/result checks, JSON object state, nonnegative revision. No live gameplay writes yet. |

Media references point to existing repository assets now. No Storage bucket was created before an upload workflow exists. Room deletion is restricted while history references the room. A timestamp trigger updates all four tables. Phase 10 can add a separate immutable event log once audit requirements are defined; Phase 4 will define staff roles and policies.

## Data access and security

[`js/data/room-repository.mjs`](../js/data/room-repository.mjs) is a credential-free catalog boundary. A trusted future caller injects a Supabase-compatible client; it returns normalized rooms, hints, and media. It is deliberately not imported by the current public pages. Future admin and room migration phases can add authenticated writes and switch readers without spreading table queries through UI components.

All four public tables have RLS enabled, **zero policies**, and explicit revocation of `anon` and `authenticated` table access. Only `service_role` has explicit table grants, and that key must stay in a trusted process. Default privileges for later `public` objects are revoked so new tables require deliberate grants. The anonymous REST request returned HTTP 401 / PostgreSQL `42501` for `rooms`. The Supabase security advisor's four informational [“RLS enabled, no policy” findings](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) describe this intended closed state; access policies belong with Phase 4 authentication. No browser receives a service key.

## Seed and verification

[`scripts/generate-phase3-seed.mjs`](../scripts/generate-phase3-seed.mjs) derives [`supabase/seed.sql`](../supabase/seed.sql) from the approved static room configurations and text hint files. The target project currently holds 3 rooms, 129 hints, and 10 media references; no `game_sessions` rows. Seed inserts use conflict handling so repeating the seed does not overwrite edited rows. Once room content is database owned in Phase 7, replace this temporary static-to-seed bridge with a real data migration.

Run [`supabase/tests/phase3_assertions.sql`](../supabase/tests/phase3_assertions.sql) after migration and seed. It verifies seeded counts, RLS/grants, required labels, unique positions/media, foreign keys, duration bounds, JSON state shape, and a valid session insert. Its trial writes run inside a rolled-back transaction. `node --test tests/test_room_repository.mjs` verifies repository normalization and error handling; `python -m unittest discover -s tests -v` covers the existing GM/Cast browser flows.

## Rebuild and backup

Supabase CLI local configuration is in `supabase/config.toml`; it uses PostgreSQL 17 and seed.sql. On a local Docker-capable machine, `npx supabase@2.120.0 start` followed by `npx supabase@2.120.0 db reset` rebuilds migration plus seed. The local Docker daemon was unavailable during this milestone, so the reproducibility proof here is the matching recorded remote migration, remote seed, SQL assertions, and source-controlled files, rather than a local reset.

For a free logical **data** backup, install PostgreSQL 17 (or newer) client tools, configure `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE=require`, and a private password prompt or `PGPASSFILE` outside Git. Run `scripts/backup-database.ps1`; it writes a timestamped custom-format dump of application rows under ignored `backups/` and prints its SHA-256. Keep a copy off this machine. Migrations and seed reconstruct schema and initial content; they are **not** a backup of later edits. [Supabase advises Free projects to export data regularly](https://supabase.com/docs/guides/platform/backups).

To recover into an **empty replacement Supabase project**, create its default Auth schema, run the ordered migration files with `psql --single-transaction --set ON_ERROR_STOP=1 --file <migration.sql>` using private libpq connection settings, then restore the latest data dump with `pg_restore --data-only --single-transaction --no-owner --no-acl --dbname=postgres <backup.dump>`. Do **not** run seed.sql before a data restore, because the backup already contains room rows. Compare restored counts with the backup manifest and verify RLS/grants. The initial-seed SQL assertions expect exactly 3/129/10 rows, so adapt those count checks after real content changes. Point the future app configuration at the new project. This procedure must only target a replacement database; restoring over the active project could replace data and requires Product Owner approval.

Database exports do not contain Storage object bytes. Today all media bytes are in the Git repository, and the remote project has no Storage objects. When upload management is added, export object bytes and their manifest separately before claiming complete recovery. Auth users and provider settings do not exist yet; Phase 4 must expand the backup scope when those are introduced. The schema uses ordinary PostgreSQL objects apart from an optional FK to Supabase `auth.users`; moving to another provider requires mapping that identity relationship.

## Free plan and roadmap boundary

No new project, paid branch, subscription, billable service, synthetic traffic, or Storage bucket was created. Free projects do not have the same managed daily backup availability as paid projects, so the manual logical export is required. Phase 4 adds authentication, staff roles, and actual authorized policies. Phase 7 will make room content database driven; Phase 8 will use server-backed session snapshots; Phase 9 adds network realtime; Phase 10 defines history/audit retention and production operations.
