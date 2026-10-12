# Final review refinement tracker

Updated 2026-10-13, Asia/Riyadh, after final live account and disposable recovery checks. Product Owner decision: **request changes; not approved**. Work is on `codex/final-review-refinements` from commit `79ac0e4`. Do not merge or deploy the application.

## Baseline and safety

- Supabase project: `gbhleqizxcmxmutgcjon` only. Before schema changes, inspected the eight current public application tables and protected functions.
- Pre-migration snapshot: ignored `backups/pre-review-refinement-20261012.json`, SHA-256 `3D4133A8D0ACF16A568A578D731D1C6E40A9D3D78BBC5A8401F385F5A4CE81EC`; packaged schema/data/Auth fixture and downloaded three actual Storage objects. Original data: 4 rooms (3 active), 130 hints, 11 media records, 4 sessions, 22 events, 2 staff records, 1 assignment, 15 audits.
- Resume audit confirmed baseline rows and all eight original public tables with RLS enabled. Live refinement migrations `20261012161900_room_presentation_profiles` and `20261012161918_operational_staff_accounts` are applied to the approved project, after a successful disposable restore and rolled-back RLS test. The Product Owner explicitly authorized deploying backend functions only. `operator-account` v1 (`verify_jwt=true`) and `operator-login` v1 (`verify_jwt=false`, password authentication inside the function) are active alongside `staff-invite`; the application remains localhost only.
- A post-refinement snapshot is ignored at `backups/post-refinement-20261012.json`, SHA-256 `3BA37EBE47DFB9B0BD76CDC2CA963DD2AB2DEF84D9827AAFF7D80521AC129A66`. It contains 5 rooms, 132 hints, 14 media records, 5 sessions, 33 events, 2 staff, 1 profile, 1 assignment, 31 audit rows and 8 Storage objects. The snapshot/package, all eight object bytes, and a fresh disposable PostgreSQL 17 restore passed exact table-digest verification. The Storage bytes were also copied to a disposable sibling directory and hash checked. Managed Auth credentials and live hosted restoration remain outside this application export.
- The latest ignored snapshot is `backups/final-refinement-20261013.json`, SHA-256 `69DD8BE0DAF4C4AC54F05D998EEAAA5ABEFAD105CA11E6337DAC3015B9462DC0`: 5 rooms, 132 hints, 14 media, 6 sessions, 36 events, 3 staff, 2 assignments, 1 profile, 36 audits and 9 Storage objects. Package, all Storage bytes and disposable byte-copy verification passed. It was restored into fresh disposable PostgreSQL 17 database `ahaji_refinement_final_20261013`; exact table digests matched and rolled-back RLS SQL passed. This snapshot includes the temporary QA operator in its final inactive state and the uploaded room cover.
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
- [x] Operator provisioning and access: Product Owner-approved `qaoperator@ahaji.com` was created once through the Admin UI as an operator Game Master assigned solely to `qa_refine_20261012`. A separate in-app browser context signed in with its generated password, opened the assigned GM room and completed a short session. Direct navigation to `anbar` and Admin Staff was denied. The account is now inactive. A live SQL impersonation using its still-present Auth session confirmed `current_staff_role()` is null and new-session creation is denied after deactivation.
- [ ] Operator credential reset: the Admin reset action was reached, but browser control stopped at its JavaScript confirmation. No new password was issued. The source path has mocked browser coverage, including the close control after a one-time password appears; a live reset remains unverified. The original temporary password should be treated as spent and the account remains inactive.
- [x] Regression and responsive QA: 7 Node tests and 17 mocked Playwright browser tests passed at the latest full run. Desktop live screens and 1440/820/390-pixel screenshots were visually inspected; the mobile tab wrapping issue was fixed. Re-run the suite after final edits.
- [x] Latest backup package, nine Storage object hashes, disposable restore and rolled-back RLS test verified after QA provisioning, deactivation and cover upload.
- [x] Documentation and source committed as `c53d9cb`, `7fae24a`, and `5c1ae64`; the integration branch had a clean working tree and localhost port 8765 returned HTTP 200 at handoff. Live operator reset remains the one incomplete verification above.

## Resume

Read this file, `docs/AHAJI_DELIVERY_STATUS.md`, `docs/AHAJI_OPERATIONS.md`, inspect `git status`, and preserve ignored `backups/`. Never restore into live Supabase. Re-run tests after every integration change; record what is mocked versus live.
