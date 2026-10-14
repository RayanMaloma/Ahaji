# CLAUDE.md

Ahaji is an Arabic-first escape-room operations app: an Admin workspace, a Game Master (GM) console, and a paired Cast display, backed by Supabase. The original v1 "local-only, no backend" brief is obsolete; do not follow it.

## Primary references

Read these before changing anything. They override this file where they are more specific.

1. `AGENTS.md` — engineering rules and approval gates.
2. `docs/AHAJI_REFINEMENT_STATUS.md` — current review status, open gaps, resume procedure.
3. `docs/AHAJI_OPERATIONS.md` — local run, LAN review, backup, restore, security.
4. `docs/AHAJI_ROOM_DRAFT.md` — shared room draft and media save behavior.
5. `docs/AHAJI_DELIVERY_STATUS.md` and `README.md`.

Treat code and verified documentation as the source of truth. Record what was tested with mocks versus live services.

## Approval gates

- The Product Owner's current milestone scope is authoritative. Do not start the next phase without explicit approval.
- Work on a feature branch. Never merge into `main`, force-push, or deploy the frontend without explicit Product Owner approval.
- Live Supabase changes (migrations, data writes, Storage changes, Edge Function deploys, Auth settings) require explicit Product Owner authorization for each change. Read-only metadata inspection is the default.
- Supabase operations are restricted to project `gbhleqizxcmxmutgcjon`.
- Use only free tools and infrastructure. No paid services or plan upgrades.

## Architecture

- Frontend: static HTML, CSS, and vanilla ES modules. No framework or bundler except `npm run build:auth`, which builds `js/vendor/supabase.bundle.mjs` with esbuild.
- Pages: `login.html`, `recover.html`, `unauthorized.html`, `admin.html`, `staff.html`, `index.html` (GM room selection), `gm.html`, `cast.html`, `cast-preview.html`.
- Admin (`js/admin/`): rooms are the default page. Each room has five tabs (settings, hints, images, videos, sounds) backed by a single `createRoomDraft` instance. Save All uploads staged files and then calls the `admin_save_room_draft` RPC, which compares `rooms.content_revision` and commits in one transaction. Also includes staff, history (Asia/Riyadh grouping, active-duration from events), and account/profile.
- Room data: `js/app.js` holds normalized room configuration and the shared `renderCastView` used by both Cast and the Admin preview. `js/data/` contains the Supabase room and Admin repositories.
- Sessions: `js/session-adapter.js` is the transport boundary. Session state and timer timestamps are server-owned. Gameplay writes go only through named `game_session_command` actions. GM receives Postgres Realtime notifications and refetches authoritative state. Cast polls a token-checked function about every two seconds using an expiring 48-character pairing token whose hash is stored server-side. Cast needs no staff account. Scope every session read, write, and message by room ID and session ID.
- GM/Cast behavior: timer, controls, and media presentation live in `js/gm.js` and `js/cast.js`. Preserve the three original room flows and the GM/Cast URL shape (`room`, `session`, `key`).
- Auth and RBAC (`js/auth/`): Supabase Auth with no public sign-up. Roles live only in `staff_accounts` and room assignments in `staff_room_access`, never in JWT or user metadata. Admin requires a verified email and a live session. The last active Admin cannot be removed. Operator GM usernames are handled by the `operator-login` and `operator-account` Edge Functions and can never be promoted to Admin. Email invitations go through `staff-invite`.
- Database: versioned schema, RLS, grants, and trusted functions live in `supabase/migrations/`; seed data in `supabase/seed.sql`; rolled-back SQL regression tests in `supabase/tests/`. Every public table has RLS and explicit grants.
- Storage: the public `room-assets` bucket serves Cast media, and only Admin may write to it. `profile-assets` holds owner-scoped avatars. Uploads are limited to 10 MiB and an allowlisted MIME list. Replaced objects are retained, not deleted automatically.

## Security

- Only the publishable Supabase key belongs in browser code. Keep service-role, SMTP, and database credentials out of Git, frontend code, logs, and backups.
- `backups/` is Git-ignored and contains sensitive snapshots. Preserve it and never commit it.
- Never restore into the live project. Restore testing happens only in a disposable PostgreSQL 17 database.
- Treat Cast links as temporary secrets.

## Design direction

- Arabic-first, RTL interfaces using the bundled Thmanyah Serif Display fonts in `css/fonts/`.
- The Cast screen is immersive, not a dashboard. The room image stays visible, and the timer and hint box should feel integrated with it on large displays.
- Dark, clean, professional, minimal clutter. Avoid gimmicks and excess animation. Respect `prefers-reduced-motion`.
- Keep three verified viewport sizes in mind: 1440, 820, and 390 pixels.

## Local checks

- Serve: `python -m http.server 8765 --bind 127.0.0.1 --protocol HTTP/1.1`, then open `http://127.0.0.1:8765/login.html`.
- `npm test` runs the Node unit tests.
- `python -m unittest discover -s tests -v` runs the mocked Playwright browser suite. One Cast navigation test is intermittently flaky; rerun before treating it as a real failure.
- Check GM and Cast together in the browser before presenting a milestone.
