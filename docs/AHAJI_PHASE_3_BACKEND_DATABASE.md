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

Supabase CLI local configuration is in `supabase/config.toml`; it uses PostgreSQL 17 and seed.sql. The migration and seed remain the reproducible initial build. They are not substitutes for a backup of subsequent edits.

### Executed Phase 3 backup and recovery test

On 2026-10-09 23:35:31 UTC, an authorized, read-only SQL query against **only** Supabase project `gbhleqizxcmxmutgcjon` exported all four application tables using [`supabase/backup/export_phase3.sql`](../supabase/backup/export_phase3.sql). The captured migration version was `20261009232032`. The same snapshot counted zero Auth users, Storage buckets, and Storage objects. The exporter deliberately refuses to package a snapshot if any of those counts becomes nonzero, because it would then omit data. The database connection password was unavailable, so this was an MCP SQL export, not a direct remote `pg_dump`.

The live JSON snapshot is kept in the Git-ignored `backups/` directory. [`scripts/phase3-backup.mjs`](../scripts/phase3-backup.mjs) packaged it with the versioned schema migration, generated restore SQL for every row, and wrote SHA-256 hashes and counts to a manifest. In an isolated Docker PostgreSQL **17.11** container with no published host port, the schema and live rows restored into `ahaji_stage`. [`supabase/tests/phase3_assertions.sql`](../supabase/tests/phase3_assertions.sql) passed. A native custom-format `pg_dump` of that restored database was then restored into a second, empty disposable database, `ahaji_verify`, where the same assertions passed. Exported rows from `ahaji_verify` matched the live snapshot by per-table SHA-256 and count:

| Table | Live rows | Restored rows |
| --- | ---: | ---: |
| `rooms` | 3 | 3 |
| `room_hints` | 129 | 129 |
| `room_media` | 10 | 10 |
| `game_sessions` | 0 | 0 |

The native dump is 24,375 bytes. This proves the captured Phase 3 schema and data can be recovered in plain PostgreSQL. It does not test recovery of Supabase-managed Auth or Storage configuration, nor a direct remote `pg_dump`. Neither contains application data in this project yet. Future Auth or Storage work must expand the backup before this verification is considered complete for those phases.

### Repeat and recover

1. Confirm the target project reference, then execute [`supabase/backup/export_phase3.sql`](../supabase/backup/export_phase3.sql) through authorized read-only SQL access. Save its single `snapshot` JSON value to a timestamped `backups/<name>.json` file. Do not save MCP result wrappers, secrets, or SQL output outside `backups/`.
2. Run `node scripts/phase3-backup.mjs package backups/<name>.json`. This creates `-schema.sql`, `-restore-data.sql`, and `-manifest.json` beside the snapshot. The command rejects an unexpected project, migration version, table shape, or nonempty Auth/Storage inventory.
3. In an **empty disposable PostgreSQL 17 database**, apply [`supabase/backup/local_restore_bootstrap.sql`](../supabase/backup/local_restore_bootstrap.sql) only for a plain local PostgreSQL test, then apply `-schema.sql` and `-restore-data.sql` with `psql -v ON_ERROR_STOP=1`. Run the SQL assertions. For a replacement Supabase project, its managed Auth/Storage schemas already exist: apply the ordered migration and restored data to that replacement only, omitting the local bootstrap and seed.
4. Run `pg_dump --schema=public --format=custom --no-owner` on the first restored database and `pg_restore --no-owner --exit-on-error` into a **second empty disposable database**. Re-run assertions and export its four tables with the same SQL query. Run `node scripts/phase3-backup.mjs verify backups/<name>.json backups/<restored>.json backups/<native>.dump`. It checks file hashes and row hashes. Never point these recovery commands at the live project.

The older [`scripts/backup-database.ps1`](../scripts/backup-database.ps1) offers a direct `pg_dump` data export once private database connection details and PostgreSQL client tools are available; that route has **not** been executed or verified. [Supabase recommends regular exports for Free projects](https://supabase.com/docs/guides/platform/backups). Store a separately protected copy of the backup outside this machine for disaster recovery; the local verification alone does not provide off-device recovery.

`backups/` is Git-ignored and its local Windows ACL grants access only to the current user, SYSTEM, and Administrators. No Supabase database password was used or written to disk. Keep credentials outside the repository, protect any off-device copy, and never commit backup JSON, SQL, or dump files. Media bytes currently live in the Git repository; there are no remote Storage objects. The schema uses ordinary PostgreSQL objects apart from the optional foreign key to Supabase `auth.users`, which another provider would need to map.

## Free plan and roadmap boundary

No new project, paid branch, subscription, billable service, synthetic traffic, or Storage bucket was created. Free projects do not have the same managed daily backup availability as paid projects, so the manual logical export is required. Phase 4 adds authentication, staff roles, and actual authorized policies. Phase 7 will make room content database driven; Phase 8 will use server-backed session snapshots; Phase 9 adds network realtime; Phase 10 defines history/audit retention and production operations.
