# Ahaji

Ahaji is an escape room Game Master and Cast display application. Current gameplay runs on localhost with vanilla HTML/CSS/JavaScript. Room configuration is shared in `js/app.js`; the Phase 2 session adapter keeps game state in localStorage and synchronizes tabs with BroadcastChannel. GM and Cast must share a browser storage context.

## Local preview

From the repository root, run `python -m http.server 8765 --bind 127.0.0.1` and open `http://127.0.0.1:8765/login.html`. Sign in with a verified staff account, select a permitted room, then use **Open Cast Screen** on the GM page. Cast audio needs a user interaction to unlock playback.

## Database foundation

Phase 3 added a protected Supabase PostgreSQL schema for rooms, hints, media references, and future session snapshots. The Admin Dashboard now reads the catalog from Supabase; game controls and local synchronization are unchanged. The migration, seed, security model, backup procedure, and recovery steps are in [the Phase 3 architecture note](docs/AHAJI_PHASE_3_BACKEND_DATABASE.md). No credentials belong in this repository; `.env.example` lists configuration names only.

Phase 4 added Supabase email/password staff authentication, Admin/Game Master roles, room assignments, RLS, protected GM entry, and password recovery. Gameplay synchronization remains local. See [the Phase 4 architecture and recovery note](docs/AHAJI_PHASE_4_AUTH_RBAC.md). Run `npm ci` and `npm run build:auth` after updating the pinned Supabase client bundle.

Phase 5 added a read-only Admin Dashboard backed by real Supabase catalog and staff data. Admins can review overview metrics, rooms and their content, staff access, and their own account at `http://127.0.0.1:8765/admin.html?view=overview`. See [the Phase 5 architecture, security, and recovery note](docs/AHAJI_PHASE_5_ADMIN_DASHBOARD.md). Room editing and staff provisioning are not part of this milestone.

## Checks

- `python -m unittest discover -s tests -p 'test_phase2_browser.py' -v` — Playwright GM/Cast browser flows.
- `node --test tests/test_room_repository.mjs` — future catalog data-access boundary.
- `supabase/tests/phase3_assertions.sql` — database integrity and privilege checks after migration and seed.
- `python -m unittest discover -s tests -v` — all Playwright browser journeys, including Auth and Admin Dashboard flows.
- `npm test` — repository data boundary tests.
- `supabase/tests/phase4_rls.sql` — run against a disposable PostgreSQL 17 database after the Phase 3 and 4 migrations.
- `supabase/tests/phase5_directory_rls.sql` — run against a disposable PostgreSQL 17 database after the Phase 5 migration.

The Product Owner approves each roadmap milestone before the next phase begins.
