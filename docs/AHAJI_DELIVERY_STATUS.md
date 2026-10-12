# Ahaji full product delivery tracker

**Historical baseline:** This file records the previous full-product delivery. The current Product Owner refinement, live QA room/operator status, applied migrations, test results, and latest recovery snapshot are tracked in [AHAJI_REFINEMENT_STATUS.md](AHAJI_REFINEMENT_STATUS.md) and [AHAJI_OPERATIONS.md](AHAJI_OPERATIONS.md). Its counts and "three original rooms are the only active rooms" statement describe the earlier checkpoint, not the current live project.

Updated: 2026-10-12 (Asia/Riyadh). Branch: `codex/full-product-delivery`, based on reviewed Phase 5 commit `a9901d8`. Only Supabase project `gbhleqizxcmxmutgcjon` was changed. No production-branch merge or site deployment was performed.

## Milestones

| Scope | Delivered | Verified |
| --- | --- | --- |
| Phase 5 | Account card layout, larger Thmanyah Serif headings and sidebar, selective Kashida, logout icon | Live Chrome visual and functional review; responsive browser regression |
| Phase 6 | Two room-creation entries, edit/archive, hints CRUD/order, image/video/audio catalog and Storage upload/replace/remove | Live Admin created a QA room, uploaded image/cover/background; automated browser and SQL tests |
| Phase 7 | Database-authoritative rooms/content in GM; three original rooms, 129 hints and 10 media references migrated | QA room, timer, hint and uploaded image appeared in live GM/Cast; three original rooms remain active |
| Phase 8 | Server-owned session RPCs, lifecycle, timer, events, recovery and expiry | Four live sessions captured; browser and SQL tests |
| Phase 9 | Expiring room/session Cast token, GM Realtime refetch, Cast network polling/recovery | Independent Chrome and anonymous in-app browser contexts synchronized timer, hint, uploaded image and outcome; physical two-device review still pending |
| Phase 10 | History/detail, audit, loading/error states, security and responsive QA, full backup tooling and operations guide | Live history and event list; eight application tables restored with exact digests; three Storage objects restored with SHA-256 checks |
| Staff | Verified-email invite Edge Function, role/room assignments, deactivation, last-Admin protection | Real invitation redeemed; test GM could operate only `anbar`, was denied `haram`, then lost access after deactivation |

The real staff invitation went to an address controlled by the Product Owner. The test identity remains inactive in `staff_accounts`; its Auth identity was retained for audit and safe reactivation. The temporary `qa_delivery_20261012` room was archived after two ended sessions; its historical rows and uploaded objects remain. The three original rooms are the only active rooms. Admin archive was covered by browser/SQL regression; the final QA archive was applied with a guarded SQL update after the Chrome extension stalled on a confirmation dialog.

## Architecture and applied migrations

- Static Arabic-first Admin and existing GM/Cast pages use a publishable key. Supabase Auth, RLS, explicit grants, named server functions and an Edge Function enforce privilege. Roles live only in `staff_accounts`; assignments live in `staff_room_access`.
- `js/app.js` loads operational room content from the database. `js/session-adapter.js` remains the transport boundary. Session state and timer timestamps are server-owned. Cast reads exactly one room/session with an expiring hashed pairing token and has no staff account.
- The public `room-assets` bucket serves Cast media; Admin-only Storage policies control mutations. Client uploads have a 10 MiB limit. `staff-invite` Edge Function version 3 is deployed with JWT verification and server-only credentials; a new identity starts inactive until assignment succeeds.
- Applied after the Phase 1–5 baseline: `20261011174931_room_management.sql`, `20261011175720_gm_video.sql`, `20261011180218_server_sessions.sql`, `20261011180604_session_realtime.sql`, `20261011180939_staff_and_audit.sql`, `20261011181406_fix_null_auth_guards.sql`, `20261011183322_session_expiry_recovery.sql`, `20261011184621_validate_session_commands.sql`, `20261012102507_localize_room_names.sql`, `20261012103120_fix_storage_folder_policy.sql`. Files are versioned in `supabase/migrations/`; legacy seed names are Arabic.

## Validation

- `npm test`: 4 passed. `python -m unittest discover -s tests -v`: 20 passed, including desktop/tablet/mobile, RTL, protected routes, CRUD, staff and GM/Cast browser checks. A prior isolated Cast hint timeout did not recur in focused or subsequent complete runs.
- Five SQL RLS suites passed against the restored PostgreSQL 17 clone: room management, sessions, expiry, staff and Storage. The Storage suite verifies an Admin insert and an unassigned-user denial. Anonymous Edge Function access returned 401; invalid Cast pairing was denied; live test GM cross-room access and post-deactivation access were denied.
- Live Journey A: Admin created a room, configured five-minute timer and hint, uploaded cover/background/media, and operated it through GM/Cast. Journey B: real invite, verified sign-in, limited room access and deactivation. Journey C: GM session, independent network browser Cast, hint/media/timer/outcome and recovery. Journey D: accurate live history and events. Journey E: disposable database restore and Storage byte restore with matching hashes.
- A physical second device has not been available to this agent. Follow `docs/AHAJI_OPERATIONS.md` for the two-device acceptance procedure before production use.

## Backup and recovery

- Protected, Git-ignored pre-work snapshot: `backups/pre-full-delivery-20261011.json`. Final post-archive snapshot: `backups/final-20261012.json`, SHA-256 `BAE315C9ECE19FE9AAC598288FC30C0DE52B06797443349B6364A7ACFF5D31D3`.
- Final snapshot: 4 room rows (3 active), 130 hints, 11 media records, 4 sessions, 22 events, 2 staff accounts, 1 room assignment, 15 audit rows and 3 Storage objects. `full-backup.mjs package` and `verify` passed exact table-count and canonical-row digests in `ahaji-full-restore-20261012`, an unexposed disposable PostgreSQL 17 container.
- `backup-room-assets.mjs backup`, `verify` and `restore-disposable` passed for all three actual objects. The bytes and checksum manifest are in ignored `backups/final-20261012-assets/`; the disposable restoration is in the sibling `-restored/` folder. On Windows the downloader uses the OS proxy and certificate store through `download-room-asset.ps1`.
- Application exports do not contain Supabase-managed Auth passwords, sessions or MFA. Hosted disaster recovery needs re-invitation, identity mapping and operator-held Storage credentials. The SQL restore package is disposable-only. See `docs/AHAJI_OPERATIONS.md`.

## Known limits and resume

- Supabase Free can pause and has SMTP, Storage, Realtime and execution quotas. Default Auth SMTP delivered the controlled test invite, but arbitrary staff recipients may be restricted; no production delivery guarantee exists at $0. No guaranteed background expiry job is available; expiry settles on subsequent reads.
- Supabase Security Advisor reports signed-in GraphQL table discoverability, intentional `SECURITY DEFINER` RPC exposure and disabled leaked-password protection. RLS and function checks remain enforced; leaked-password protection requires a plan capability outside the $0 constraint. Performance Advisor reports three unindexed low-volume foreign keys, four unused indexes and two session SELECT policies; review with production traffic before changing them. Details and remediation links are in the operations guide.
- Keep `backups/` private and ignored. To resume: inspect `git status`, this tracker, the operations guide, the applied migration list and the ignored backup manifest. Do not restore into the live project or delete historical rows. Disposable Docker containers `ahaji-final-restore-20261011`, `ahaji-disposable-restore-20261011` and `ahaji-full-restore-20261012` can be removed after review. Start the local app with `python -m http.server 8765 --bind 127.0.0.1 --protocol HTTP/1.1`.
