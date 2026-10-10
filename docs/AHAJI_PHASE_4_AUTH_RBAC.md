# Phase 4: authentication and staff authorization

Date: 2026-10-10. Target Supabase project: `gbhleqizxcmxmutgcjon` only. Approved Phase 3 baseline: `4363517`. Work is on `codex/phase-4-auth-rbac`; Phase 5 has not started.

## Architecture and decisions

- Supabase Auth owns email/password identity, confirmation, password reset, refresh tokens, and sessions. The browser contains only the project's publishable key. No service key or password is committed.
- `public.staff_accounts` stores an `admin` or `game_master` role for an Auth user ID. `public.staff_room_access` assigns rooms to Game Masters. A confirmed, active Auth identity and a live `auth.sessions` row are required by `ahaji_private.current_staff_role()`. Editable Auth user metadata and browser state confer no permissions.
- RLS grants Admin read/write access to room configuration, hints, media, staff roles, and room assignments. Game Masters can read active assigned rooms and their content, but cannot write configuration or grant roles. Only Admin can read future `game_sessions`; server gameplay writes belong to Phase 8. There are no policies for `anon`, and public signup is disabled in Supabase Auth.
- A database trigger prevents deactivation, demotion, or deletion of the last active Admin. Admin email changes keep the same Auth user ID and role, and Supabase requires email verification for a new address.
- The static app uses Auth guards for sign-in and navigation. Game Master content remains local during this phase, so the guard is not a network authorization boundary for gameplay messages. RLS is the authority for database data. Cast remains account free and shares the local browser storage context with its GM until server sessions and scoped display credentials are implemented in Phases 8–9.
- The staff home is a simple role entry point, not the Phase 5 Admin Dashboard. Admin and GM provisioning beyond the initial Admin is a trusted Supabase Auth/DB operation until an Admin UI exists. Never grant a role from client-supplied metadata. A staff invitation must be accepted and the email verified before assigning a role.

Source: [`20261010113916_phase4_auth_roles.sql`](../supabase/migrations/20261010113916_phase4_auth_roles.sql) and [`20261010115013_phase4_inactive_room_guard.sql`](../supabase/migrations/20261010115013_phase4_inactive_room_guard.sql). The latter blocks GM access to hints/media after an assigned room is made inactive.

## Initial Admin provisioning

The Product Owner provided a real inbox and completed the Supabase email setup link personally. Only after Supabase reported email confirmation and a password set was the corresponding Auth user ID given an active Admin row using a guarded SQL insert. No password was seen, generated, or stored by the engineer. The placeholder `gamemaster@ahaji.com` was never provisioned live; it is a local test identity only. Public signup was disabled after the initial Admin was confirmed. The Supabase Auth Site URL is `http://127.0.0.1:8765` for this localhost review. Change it and add approved redirect URLs before deployment.

For future staff, a trusted administrator invites a real inbox through Supabase Auth. The recipient confirms and sets their own password. The administrator then assigns `game_master` in `staff_accounts`, and room IDs in `staff_room_access`, or `admin` only when explicitly authorized. Phase 5 can add an Admin workflow for this; do not expose a service key in the browser. Never use fake addresses for live staff accounts.

## Backup and recovery

Before the migration, the Phase 3 tables were exported to the restricted, Git-ignored `backups/` directory. After both Phase 4 migrations and verified Admin provisioning, [`export_phase4.sql`](../supabase/backup/export_phase4.sql) captured all six application tables plus a minimal Auth identity map (ID, email, confirmation/deletion flags) and counts of Auth users and Storage. It deliberately omits passwords, tokens, sessions, and provider settings. [`phase4-backup.mjs`](../scripts/phase4-backup.mjs) rejects wrong project/migration versions, incomplete table shapes, nonempty Storage, missing Auth identities, and game session rows that cannot yet be remapped.

Final local snapshot: `backups/phase4-final-20261010.json`, with schema, restore SQL, local Auth fixture, and SHA-256 manifest beside it. It contains 3 rooms, 129 hints, 10 media references, 0 gameplay sessions, 1 Admin role, and 0 room assignments. It was restored into an isolated PostgreSQL 17 disposable database named `ahaji_phase4_final_restore`, with no host port. A new export from that database matched the live snapshot by per-table SHA-256 and row counts. The Admin role row was restored after recreating a confirmed local Auth identity; a disposable authenticated session then read that role and all three rooms through RLS. This verifies the application tables and role relationship in a separate database. It **does not** verify restoration of Supabase-managed Auth passwords, MFA factors, refresh sessions, email provider configuration, or SMTP. In a real replacement, re-invite staff and confirm their new Auth identities, then restore roles by verified email; never replay the test Auth fixture into Supabase.

Repeat the backup after any staff/room change:

1. Execute `supabase/backup/export_phase4.sql` through authorized, read-only SQL access to project `gbhleqizxcmxmutgcjon`; save the single `snapshot` JSON value to a new restricted `backups/<timestamp>.json`. Never put MCP wrappers or credentials in the file.
2. Run `node scripts/phase4-backup.mjs package backups/<timestamp>.json`. Keep its generated files together and off Git. Save an encrypted, access-controlled copy off this machine for disaster recovery.
3. In an **empty disposable PostgreSQL 17 database**, apply `supabase/tests/phase4_local_bootstrap.sql` (local test only), then the packaged `-schema.sql`, `-local-auth-fixture.sql`, and `-restore-data.sql`, in that order, using `psql -v ON_ERROR_STOP=1`. Export with `export_phase4.sql` and run `node scripts/phase4-backup.mjs verify backups/<timestamp>.json backups/<restored>.json`.
4. For a real replacement Supabase project, apply the versioned migrations to its managed Auth schema; recreate and verify Auth identities through the supported Auth flow; apply `-restore-data.sql` only after each staff email is uniquely verified. Map any future gameplay sessions separately. Never run recovery against the existing live project.

`backups/` is Git-ignored and has a restricted Windows ACL. Protect copies of the identity map as personal data. The publishable key is not secret; service-role keys and database passwords must stay outside source control. The Phase 3 direct `pg_dump` helper remains an unverified alternative because no private database password was used.

## Validation and current limits

- Local PostgreSQL RLS assertions pass for Admin, assigned GM, unassigned user, forged metadata, expired/revoked session, role escalation attempts, room writes, last-Admin protection, inactive-room content, and role revocation.
- Python Playwright browser tests pass for login error/success (mock Auth), logout, refresh restoration, recovery request/expired link, role routing, GM/Cast gameplay, session isolation, timer, hints, media, win/loss, and reconnect. The test identities are network-scoped fixtures and do not exist in the live project.
- The live project confirms the initial Admin email, password setup, and role assignment. An actual password login by the Product Owner remains a review step because the engineer never receives the password. The live Auth endpoint rejects an incorrect password. Anonymous REST read/write attempts are blocked.
- Supabase's default email service has limited quota and recipient restrictions; password recovery depends on that service. A production mail domain/SMTP service is a later operational decision, subject to the zero-cost constraint. Supabase's security advisor currently warns that authenticated table names appear in GraphQL (RLS still restricts rows) and that leaked-password protection is disabled. Neither warning grants data access; revisit as part of production hardening.
- Local static gameplay messages are not cryptographically protected or networked. A person with local browser storage access can inspect local game state. A secure session-scoped Cast credential and server-enforced gameplay controls require Phases 8–9.

## Local review

Open `http://127.0.0.1:8765/login.html`, sign in with the verified Admin inbox and the password set privately via email. Open Staff home to see the Admin role, three permitted rooms, and the email change request. Enter a room; open its Cast screen and run timer, hint, media, and outcome actions. Refresh both pages, then log out. Test Forgot password only if you intend to consume one free-tier email; Supabase will send a reset link to the real inbox. Directly opening a GM route while signed out must return to login. Do not share your password with the engineer.
