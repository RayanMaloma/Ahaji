# Phase 5: Admin Dashboard

Date: 2026-10-10. Target project: `gbhleqizxcmxmutgcjon`. The approved Phase 4 baseline is `eabf28f`; this milestone is on `codex/phase-5-admin-dashboard`. Phase 6 room editing is outside this scope.

## Design and data flow

`admin.html` is the Admin entry point. `js/admin/app.mjs` handles the route, navigation, rendering, and account actions; `js/data/admin-repository.mjs` loads the catalog and staff directory. The dashboard uses a light content area for long room lists and a compact Ahaji dark navigation rail with the existing yellow accent. Desktop, tablet, and mobile layouts use the same routes (`?view=overview`, `rooms`, `room&id=<id>`, `staff`, `account`), so refresh, direct links, and browser history work. Room management, staff provisioning, and gameplay session metrics are not represented as live controls until their approved phases.

Overview totals, room cards, hints, and media come from the existing Supabase rooms, `room_hints`, and `room_media` records through the authenticated catalog repository. The staff page and staff total use the narrow `admin_staff_directory()` RPC. Counts are computed from fetched rows; no metric is stored or fabricated. Detail pages show the existing content and locally resolvable media links. Missing images, empty records, loading, and network errors have explicit states. User-supplied database strings are rendered as text; media links are limited to local `images/` and `source/` references.

The Phase 4 Auth guard still determines the user's current role before showing the dashboard. The data boundary remains Supabase: the browser has only the publishable key and authenticated user token. Game Masters and anonymous visitors cannot read the Admin staff directory through the RPC, even by calling the endpoint directly. Gameplay continues to use local state and BroadcastChannel; this milestone does not create or migrate server sessions.

## Database change

[`20261010120931_phase5_admin_staff_directory.sql`](../supabase/migrations/20261010120931_phase5_admin_staff_directory.sql) adds one read-only SQL function. It returns staff email, verification state, role, active state, and assigned room IDs by joining `staff_accounts`, `staff_room_access`, and `auth.users`. A fixed empty search path and fully qualified names protect the `security definer` function. It returns rows only when `ahaji_private.current_staff_role()` recognizes a currently confirmed, active Admin with a live Auth session. `anon` and `public` have no EXECUTE grant; `authenticated` has the grant but gets no rows without the Admin role. Existing table RLS and writes were not changed. No new table, seed record, or Supabase paid service was introduced.

## Backup and recovery

A fresh restricted, Git-ignored snapshot was taken **before** the migration: `backups/phase5-pre-migration-20261010.json` (SHA-256 `A957E5466FB8FEAF802D2EDB9AC21D32F47EC7DC4F5819EFC7C47740896F4646`). It contains 3 rooms, 129 hints, 10 media references, 0 gameplay sessions, 1 staff role, 0 room assignments, and a minimal mapping for 1 Auth identity. After the migration, `backups/phase5-final-20261010.json` was captured and packaged (SHA-256 `81B3385961853214E59BEB5B4DAFA2FFB60BC9AF4358908EBF0EE46893D76481`). The backup script accepts the known Phase 4 or Phase 5 migration sequence and includes the corresponding versioned schema.

The final snapshot was restored into a **separate disposable local PostgreSQL 17 database** named `ahaji_phase5_restore`, without a published network port. A new export from that database matched the live snapshot by row count and per-table SHA-256 for all six application tables. After recreating only the confirmed Auth identity as a local test fixture, a disposable authenticated session read the Admin directory through the restored authorization rules. The live Supabase project was not used as a restore target.

To repeat: run [`export_phase4.sql`](../supabase/backup/export_phase4.sql) through authorized read-only SQL access to this project, save its single `snapshot` JSON value in restricted `backups/`, then run `node scripts/phase4-backup.mjs package backups/<name>.json`. In an empty disposable PostgreSQL 17 database, apply `supabase/tests/phase4_local_bootstrap.sql`, then the packaged `-schema.sql`, `-local-auth-fixture.sql`, and `-restore-data.sql` with `psql -v ON_ERROR_STOP=1`. Export the restored database with the same exporter and run `node scripts/phase4-backup.mjs verify backups/<name>.json backups/<restored>.json`. The local Auth fixture must **never** be applied to hosted Supabase. For a replacement hosted project, follow the Phase 4 verified-email re-invitation and role remapping process before restoring application data.

The snapshot includes personal email addresses and must remain access controlled and outside Git. It does **not** back up managed Auth passwords, tokens, sessions, MFA, or email provider settings. A full disaster recovery plan needs those Supabase-managed capabilities recreated through supported Auth flows. See the [Phase 4 recovery note](AHAJI_PHASE_4_AUTH_RBAC.md) for the identity relationship and limitations.

## Validation and limits

- Live authenticated Admin browser: overview showed 3 rooms, 129 hints, 10 media records, 1 active staff account. Room, Prison detail (50 hints, 4 media), Staff, and Account pages loaded real data; refresh restored the account route and session. The Product Owner completed the private password sign-in without sharing credentials.
- Python Playwright suite: 11 tests passed across Phase 2 gameplay, Phase 4 Auth, and Phase 5 dashboard journeys. Phase 5 checks data-derived metrics, room search/filter/detail/history, staff/account/logout, loading/error/retry, mobile layout, and anonymous/Game Master denial.
- Node repository tests: 2 passed. Local PostgreSQL `phase5_directory_rls.sql` passed Admin, Game Master, forged metadata, expired session, and anonymous EXECUTE checks. A live anonymous RPC request returned HTTP 401; the live function grants and definition were inspected.
- Existing GM/Cast communication remains local to a browser storage context. Password recovery depends on Supabase Free email delivery limits. The read-only staff page does not invite or edit staff, and no gameplay session analytics exist yet.

## Local review

Open `http://127.0.0.1:8765/admin.html?view=overview` while signed in with the verified Admin account. Visit **Rooms**, open each detail and its media; visit **Staff** for role and assignment information; visit **Account** for verified email, email-change entry, and password recovery. Use browser back and refresh on a detail route. The Game Master entry remains available in the sidebar. If signed out, the protected Admin route redirects to login. Only submit an email change if you intend to verify a new inbox.
