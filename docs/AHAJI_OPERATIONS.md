# Ahaji operations and recovery

Scope: integration branch `codex/full-product-delivery`, Supabase project `gbhleqizxcmxmutgcjon`. This guide records the current implementation; it is not a production deployment approval.

## Start and review

Run `python -m http.server 8765 --bind 127.0.0.1 --protocol HTTP/1.1` from the repository. Open `http://127.0.0.1:8765/login.html`. Verified staff use Supabase Auth; there is no public sign-up. Admins land on Rooms. Game Masters select only their assigned rooms at `index.html`. Cast uses the GM session link and needs no staff login. The Cast screen requires a user click to unlock sound.

For a LAN review, stop the loopback server and run `python -m http.server 8765 --bind 0.0.0.0 --protocol HTTP/1.1`. Find the host's private IPv4 address with `Get-NetIPAddress -AddressFamily IPv4`. Both devices must be on a trusted local network and able to reach port 8765. Open `http://<host-ip>:8765/login.html` on the GM device, then use **Open Cast Screen** and copy that exact link to the second device. Opening GM through `127.0.0.1` makes a link that points back to the second device itself and will fail there. Do not publish this development server to the public internet.

### Two-device acceptance procedure

1. Sign in as an authorized GM on device A; select a room and open a new session.
2. Copy its complete Cast link, including `room`, `session`, and `key`, to device B. Treat the link as a temporary secret. The display should connect without staff credentials. Click once to enable audio.
3. Start, pause, resume, and adjust the timer. Send a hint and select an image/video or sound where configured. Verify each change on B. Refresh B and A separately; verify the current state returns.
4. Temporarily disconnect B, change a hint on A, reconnect B, and verify it recovers the latest state. Alter or remove the pairing key and verify access is denied. End the session; verify the outcome on B.
5. Sign in as Admin and open Session History. Check the actual room, GM, start/end times, outcome, duration, and event list. A second room/session must not display the first one's data.

GM receives Postgres Realtime notifications and fetches authoritative session state. Cast polls a token-checked server function every two seconds, so changes may arrive within a few seconds. This uses Supabase network requests across devices; local BroadcastChannel is only used by the legacy automated fixture. Active sessions expire after 12 hours. Expired and elapsed sessions are settled when a GM reads them, Cast polls, or Admin opens history. There is no guaranteed background cleanup job on the Free plan.

## Routine Admin operation

- Rooms: use either **إضافة غرفة** entry point. Room IDs are stable and lowercase; edit room details, duration, images, hints and media in Admin. Archive a room when retiring it. An active session blocks archival. Historical rows are retained.
- Hints: add, edit, delete and reorder from room details. Existing 129 hints were retained in the database and are read by GM.
- Media: supported JPEG, PNG, WebP, GIF, MP3, OGG, WAV, M4A, MP4, WebM, up to 10 MiB per file. The Storage bucket is public for account-free Cast playback; only Admin may upload, replace, or delete. Previews and storage failures are surfaced in the UI. Watch Free storage usage and remove obsolete content intentionally.
- Staff: the Edge Function requires a valid Admin JWT and uses a server-only secret. Staff roles and room permissions are stored in `staff_accounts` and `staff_room_access`. Direct browser writes are revoked. A verified email and live Auth session are required. The last active Admin cannot be removed. Deactivation stops access on the next server request.
- History: Admin sees recorded sessions and events. Counts are based on actual records; there is no fabricated revenue or visitor analytics.

## Staff email limitation

[Supabase's default SMTP sender](https://supabase.com/docs/guides/auth/auth-smtp) has project-team recipient restrictions and no production delivery guarantee. A real invitation to the Product Owner's controlled test address was delivered and redeemed, but arbitrary future staff addresses may still fail until custom SMTP is configured. The endpoint reports an email authorization failure instead of creating a fake success. Do not enable public signup or create confirmed users manually to work around this. A free SMTP tier may be usable but needs account/domain ownership and configuration by an authorized operator; quotas and availability must be checked before production use.

## Security and secrets

The browser contains only a publishable Supabase key. RLS and explicit grants enforce room, role, and session access. Gameplay writes use named `game_session_command` actions; clients cannot write arbitrary snapshots. Cast holds a 48-character pairing token whose hash is stored in the database, scoped to a room and session, with expiry. Do not put Cast links in public messages or logs. `cast.html` sends no Referer header. Service-role and SMTP credentials belong only in Supabase secret configuration or a short-lived operator environment, never in the frontend, repository, or backup artifact.

## Back up

1. Run `supabase/backup/export_full.sql` against project `gbhleqizxcmxmutgcjon` and save its single JSON value under ignored `backups/<name>.json` with restricted file access. Confirm the project reference and table counts. This includes application rows, migration versions, a minimal Auth identity map, and Storage object metadata. It does **not** include Auth credentials, Auth sessions, MFA, or Storage bytes.
2. Run `node scripts/backup-room-assets.mjs backup backups/<name>.json` and then `node scripts/backup-room-assets.mjs verify backups/<name>.json`. This downloads each public `room-assets` object, records SHA-256 and size, and fails if one is missing. On Windows, the downloader uses `scripts/download-room-asset.ps1` so the operating system's trusted certificates and configured proxy are respected.
3. Run `node scripts/full-backup.mjs package backups/<name>.json`. It packages exact versioned migration SQL, table restore SQL for a disposable clone, a local Auth fixture, and a checksum manifest. Store the snapshot, generated SQL, asset directory, and manifest together in protected offline storage. `backups/` is Git-ignored.
4. Re-run after significant content, staff or session changes. Preserve at least one independent copy; Supabase Free is not an always-on or disaster-recovery guarantee.

## Restore verification and disaster procedure

Never test destructive restoration against the live project. In a disposable PostgreSQL 17 database, apply `supabase/backup/local_full_bootstrap.sql`, then the package's `-schema.sql`, `-local-auth-fixture.sql`, and `-restore-data.sql` in that order. Export the restored tables with `supabase/backup/export_full.sql` and compare using `node scripts/full-backup.mjs verify <source.json> <restored.json>`. Run the rolled-back SQL tests in `supabase/tests/`; add a synthetic Auth session in the disposable clone for the Admin test identity first. Run `node scripts/backup-room-assets.mjs restore-disposable <source.json>` to copy all saved Storage bytes to a fresh sibling directory and compare their SHA-256 digests. The local Auth fixture is only for recovery testing and must never be applied to hosted Supabase.

For a hosted disaster, first provision or recover a project under the approved cost and ownership constraints. Apply migrations, restore Storage bytes through Supabase Storage with an operator-held privileged credential, and re-invite users through Auth. Managed Auth identities cannot be recreated from this application export. Preserve the old-to-new identity mapping and remap staff and session foreign keys before importing application rows. The generated `-restore-data.sql` assumes identical Auth IDs and is explicitly **disposable-only**; do not run it on hosted Supabase. Active Cast pairing links should be replaced with new sessions after a disaster. Do not call this a fully automated hosted restore.

The post-archive `final-20261012` snapshot was restored into a disposable PostgreSQL 17 container and verified with exact table counts and canonical-row digests across eight application tables. All three actual Storage objects were downloaded, verified, and copied into a disposable restore directory with matching SHA-256 hashes. Hosted Auth identity and Storage API restoration have not been exercised; email delivery to arbitrary staff addresses remains unguaranteed.

## Security and performance advisories

The [GraphQL discoverability advisory](https://supabase.com/docs/guides/database/database-linter?lint=0027_pg_graphql_authenticated_table_exposed) lists eight tables because `authenticated` has `SELECT`. Their row policies still govern the returned data; the application needs these grants for its current REST reads. The [anonymous](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) Cast function is deliberately callable with a valid, expiring room/session token. The [authenticated function advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) lists eight RPCs; each checks the live identity, role, assignment or Cast token as appropriate. SQL and live denied-operation checks were run. Do not revoke the intended grants without redesigning the affected workflows.

[Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains disabled under the $0 plan constraint; require strong unique staff passwords and review this setting if the plan changes. The [unindexed foreign-key](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [unused-index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), and [multiple SELECT-policy](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies) performance notices are low-volume today. Recheck with real traffic before changing indexes or policy structure.
