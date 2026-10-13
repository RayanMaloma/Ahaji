# Final review refinement tracker

Updated 2026-10-13, Asia/Riyadh, after room management UX corrections. Product Owner decision: **request changes; not approved**. Work is on `codex/final-review-refinements`. Do not merge or deploy the application.

## Room management final review (2026-10-13)

- [x] Room IDs are generated from the name and hidden in Create/Edit and room cards. Latin names use normalized slugs; Arabic and other scripts use a repeatable name-derived fallback. Concurrent collisions receive a numeric suffix. The existing primary key and format constraint enforce validity/uniqueness; migration `20261013192413_room_identity_image.sql` adds an immutable-ID trigger.
- [x] One **صورة الغرفة** control drives both room cards and Cast. The migration made the existing Cast background canonical for all five live rooms and enforces matching image references. Existing Storage objects and session/history relationships were retained. Changes use the shared Cast renderer and appear in the unsaved preview and after saving in a real Cast session.
- [x] Admin shell has one viewport scrolling pane, stable sidebar geometry, and a hidden Rooms scrollbar with wheel, touch, and keyboard scrolling intact. Settings use a consistent RTL grid and padded select arrows. 1440/820/390-pixel screenshots of Rooms, Staff, History, Account, Settings, Hints, and Audio were inspected.
- [x] Hint sorting supports pointer, touch, keyboard, long-list autoscroll, a six-dot handle, one save on drop, and a visible rollback on save failure. The live QA room's two hints were moved, confirmed in SQL and GM, then restored with the keyboard. A mocked 40-hint last-to-first drag passed.
- [x] Room sound entries and system sounds use a compact dark player with play/pause, progress, duration, supported seeking, volume/mute, and error states. A live Chrome test loaded the QA room audio from Storage, advanced to its two-second end, and sought to one second. Audible output was not independently captured.
- [x] Pre-migration ignored snapshot `backups/pre-room-ux-20261013.json` SHA-256 `013DF438FCFE5387F871EE4FFF34418D44B1E1FFFD4C4E54976345B813382225`: 5 rooms, 132 hints, 14 media, 6 sessions, 36 events, 3 staff, 9 Storage objects. Package, object hashes, disposable byte restore, disposable PostgreSQL 17 migration, and rolled-back `room_identity_image.sql` passed before the live migration.
- [x] Migration `20261013192413_room_identity_image.sql` applied once to approved project `gbhleqizxcmxmutgcjon`; all five live room references match, original Cast backgrounds are preserved, and room/session/media counts were unchanged immediately after migration.
- [x] Live integration: uploaded a 99 KB QA room image; the preview updated before saving, then Admin/GM cards and Cast in independent Chrome and in-app browser contexts displayed the saved image. GM created and ended a QA session; timer and win state synchronized. The prior image objects were retained.
- [x] Post-change ignored snapshot `backups/post-room-ux-20261013.json` SHA-256 `913D4ADEC4A362A6E9C443B5EC108D9C84E5F63613E2A334BE00B8A936739010`: 5 rooms, 132 hints, 14 media, 7 sessions, 39 events, 3 staff, 10 Storage objects and 17 migrations. Package, all Storage bytes, disposable byte restore, fresh PostgreSQL 17 restore with exact row digests, and rolled-back room identity/image SQL passed.
- [x] Latest regression: 9 Node tests and 19 mocked Playwright browser tests passed. The browser suite includes authentication, staff scope, room CRUD, duplicate Arabic names, identity preservation, live preview, hints, audio controls, network session behavior, and history. Live Supabase checks above are distinct from mocked tests.
- [x] Implementation committed as `6b28f66`. The post-change backup still verifies against the restored application rows; all ten previously restored Storage files match their source SHA-256 values. The QA room has no active sessions.
- [x] The existing `supabase/tests/refinement_rls.sql` also passed in a rolled-back transaction on the restored post-change PostgreSQL database, covering denied profile writes and operator escalation, room deactivation, and ongoing session access.

Known limits: audible sound output was not instrumented; browser media time/progress and seek were verified. The development server is bound to loopback for localhost review. A LAN review requires the documented trusted-network bind. The older operator credential reset live check remains outstanding and the temporary QA operator remains inactive. No frontend deployment or production merge occurred.

## Baseline and safety

- Supabase project: `gbhleqizxcmxmutgcjon` only. Before schema changes, inspected the eight current public application tables and protected functions.
- Pre-migration snapshot: ignored `backups/pre-review-refinement-20261012.json`, SHA-256 `3D4133A8D0ACF16A568A578D731D1C6E40A9D3D78BBC5A8401F385F5A4CE81EC`; packaged schema/data/Auth fixture and downloaded three actual Storage objects. Original data: 4 rooms (3 active), 130 hints, 11 media records, 4 sessions, 22 events, 2 staff records, 1 assignment, 15 audits.
- Resume audit confirmed baseline rows and all eight original public tables with RLS enabled. Live refinement migrations `20261012161900_room_presentation_profiles` and `20261012161918_operational_staff_accounts` are applied to the approved project, after a successful disposable restore and rolled-back RLS test. The Product Owner explicitly authorized deploying backend functions only. `operator-account` v1 (`verify_jwt=true`) and `operator-login` v1 (`verify_jwt=false`, password authentication inside the function) are active alongside `staff-invite`; the application remains localhost only.
- A post-refinement snapshot is ignored at `backups/post-refinement-20261012.json`, SHA-256 `3BA37EBE47DFB9B0BD76CDC2CA963DD2AB2DEF84D9827AAFF7D80521AC129A66`. It contains 5 rooms, 132 hints, 14 media records, 5 sessions, 33 events, 2 staff, 1 profile, 1 assignment, 31 audit rows and 8 Storage objects. The snapshot/package, all eight object bytes, and a fresh disposable PostgreSQL 17 restore passed exact table-digest verification. The Storage bytes were also copied to a disposable sibling directory and hash checked. Managed Auth credentials and live hosted restoration remain outside this application export.
- The earlier ignored snapshot `backups/final-refinement-20261013.json`, SHA-256 `69DD8BE0DAF4C4AC54F05D998EEAAA5ABEFAD105CA11E6337DAC3015B9462DC0`, contains the temporary QA operator in its final inactive state and the earlier room cover. Its package, Storage bytes, disposable restore and rolled-back RLS SQL passed. The newer room UX snapshot above supersedes it for application recovery.
- The three original rooms must keep their current Cast appearance. The existing shared `renderCastView` in `js/app.js` will render both real Cast and Admin preview.

## Requested work

1. Remove persistent Admin top bar; retain accessible mobile navigation and one content heading per page.
2. Replace room detail/edit with five tabs, a connected Cast preview, room status switch, and Arabic upload components.
3. Add database-backed Cast presentation settings with defaults reproducing existing rooms. Update actual GM/Cast rendering.
4. Implement operational username/password staff flow, limited to individually accountable Game Master identities. Keep verified-email Admin accounts, RLS and last-Admin protection. No email recovery claim for operator identities.
5. Redesign history with Asia/Riyadh date groups, date filters and active gameplay duration derived from start/pause/resume/end events; mark unknown durations honestly.
6. Add owned display name/avatar profiles, propagate identity, back up profile rows and Storage bytes.
7. Run mocked and live end-to-end checks, SQL denied-operation tests, responsive screenshot review, and disposable restore.

## Architectural findings

- `rooms` has no presentation settings column yet. `ahaji_private.room_presentation_config` builds the server Cast config, and live session reads refresh that config. `renderCastView` is already shared code; it needs style variables so Admin preview and Cast stay in sync.
- `can_access_room` currently requires an active room even for an owned live session. New-session creation already has an explicit active-room check. Refine access so deactivation blocks new sessions while an existing authorized session can recover and finish.
- The current History list rounds wall-clock time; pause/resume events exist. Use event intervals for active duration and preserve short/incomplete records.
- Supabase Auth password sign-in accepts email or phone, not a native username. Operational usernames require a trusted server mapping and distinct account type. The internal Auth transport address must never be presented as a deliverable mailbox or used for email recovery; only verified-email identities may become Admin.

## Progress

- [x] Clean branch, live schema inspection, pre-migration data and media backup.
- [x] Both migrations applied to live after disposable validation. `supabase/tests/refinement_rls.sql` passed in a rolled-back transaction on the post-refinement disposable restore, covering cross-profile writes, Storage ownership, operator Admin escalation, room deactivation, new-session denial and active-session continuity.
- [x] Admin room workspace live path: created `qa_refine_20261012`, used all five tabs, reordered hints, uploaded cover/image/video/audio/background, changed timer scale/position/color, observed unsaved Cast preview, saved configuration, deactivated/reactivated room and verified GM room selection changed.
- [x] Actual GM/Cast path: separate Chrome GM and in-app browser Cast contexts connected through server pairing. GM saw ordered hints and new media. Cast showed saved background and timer presentation, received timer, hint, image, video and win state. Audio signal was persisted with the room asset reference; audible playback was not independently measured.
- [x] Account profile: live Admin saved display name and avatar; sidebar and Staff directory reflected the display name immediately. Profile ownership and Storage policy tested in disposable SQL.
- [x] History: live 2-minute session classified short/test and hidden by default; toggle, Riyadh today/yesterday groups, single-day and range filters checked in browser. Seven Node tests pass for duration math and normalization.
- [x] Post-refinement backup package, Storage bytes and disposable restore verified. Source snapshot was taken after the current live test data; take a newer snapshot if subsequent provisioning or media changes are made.
- [x] Operator provisioning and access: Product Owner-approved `qaoperator@ahaji.com` was created once through the Admin UI as an operator Game Master assigned solely to `qa_refine_20261012`. A separate in-app browser context signed in with its generated password, opened the assigned GM room and completed a short session. Direct navigation to `anbar` and Admin Staff was denied. The account is now inactive. A live SQL impersonation using its then-present Auth session confirmed `current_staff_role()` is null and new-session creation is denied after deactivation. Its one Auth session was subsequently revoked with a scoped delete.
- [ ] Operator credential reset: the Admin reset action was reached, but browser control stopped at its JavaScript confirmation. No new password was issued. The source path has mocked browser coverage, including the close control after a one-time password appears; a live reset remains unverified. The original temporary password should be treated as spent and the account remains inactive.
- [x] Regression and responsive QA: 7 Node tests and 17 mocked Playwright browser tests passed at the latest full run. Desktop live screens and 1440/820/390-pixel screenshots were visually inspected; the mobile tab wrapping issue was fixed. Re-run the suite after final edits.
- [x] Latest backup package, nine Storage object hashes, disposable restore and rolled-back RLS test verified after QA provisioning, deactivation and cover upload.
- [x] Documentation and source committed as `c53d9cb`, `7fae24a`, and `5c1ae64`; the integration branch had a clean working tree and localhost port 8765 returned HTTP 200 at handoff. Live operator reset remains the one incomplete verification above.

## Resume

Read this file, `docs/AHAJI_DELIVERY_STATUS.md`, `docs/AHAJI_OPERATIONS.md`, inspect `git status`, and preserve ignored `backups/`. Never restore into live Supabase. Re-run tests after every integration change; record what is mocked versus live.
