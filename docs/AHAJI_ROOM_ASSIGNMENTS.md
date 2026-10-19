# Operational accounts and room assignment (ربط الغرف)

Implemented 2026-10-19 on `codex/final-review-refinements`. **Local only.** The migration, the account creation, and the initial assignments all need explicit Product Owner approval before they touch project `gbhleqizxcmxmutgcjon` (see "Rollout").

## Model

| Account | Role | Slot | Rooms |
|---|---|---|---|
| Main Admin (existing, verified email) | `admin` | none | all, through role |
| حساب محل أحاجي | `game_master` (operator username) | `venue` | عنبر 23, الهرم, العم صالح |
| حساب الفعاليات | `game_master` (operator username) | `events` | أسرار الفاو |

- There is **no new role.** An operational account is an ordinary Game Master staff account with `staff_accounts.operational_slot` set to `venue` or `events`. A unique index allows one account per slot. A check constraint allows a slot only on a `game_master`, so a slot account can never become Admin, and operator accounts were already barred from Admin.
- **Access is still decided only by `staff_room_access`.** That table feeds `can_access_room()`, which every room, hint, media, and session RLS policy and every session RPC already uses. No frontend list grants anything.
- **One operational owner per room.** A trigger on `staff_room_access` (and on slot changes) rejects a room held by two slot accounts, whatever writes it. Individual employee accounts without a slot can still be given rooms alongside the operational account, which keeps future per-employee accounts possible.
- **Unassigned** means no slot account holds the room. Only the Admin sees it. New rooms start unassigned because room creation never writes access rows.

## Database (migration `20261019120000_operational_room_assignments.sql`)

- `staff_accounts.operational_slot`, together with its check constraint, unique index, and owner trigger.
- `admin_set_operational_slot(user_id, slot)` marks or clears an account. It is Admin-only and works on Game Masters only. An empty display name is filled with the account label.
- `admin_set_room_assignment(room_id, slot, expected_slot)` assigns, moves, or unassigns (`slot = null`) in one transaction:
  - It locks the room row, so concurrent Admin edits serialize.
  - It rejects a stale view: if the owner the Admin saw differs from the actual one, it raises `40001` and the page reloads.
  - It refuses to change hands while the current owner has a running or paused game (`55006`), so no Game Master loses control mid-game. Idle and ended sessions stay as history.
  - It deletes the old access row and inserts the new one in the same transaction, so there is no moment when both accounts (or neither, during a move) hold access.
  - It never touches rooms, hints, media, Storage, or sessions.
- `admin_room_assignments()` returns accounts and rooms with their owner in one Admin-only read.
- `admin_staff_directory()` gains `operational_slot`. `anon` can execute none of these functions.
- Every assignment change is audited by the existing `audit_assignments` and `audit_staff` triggers.

After a move or removal, the previous account loses the room at once: its RLS reads, its old session URLs, and any `game_session_command` on that room are denied. That includes rows it already saw on screen. Cast displays are token-scoped and unaffected, but a room cannot move during a running game.

## Admin interface

- **Sidebar:** «ربط الغرف» sits directly below «الغرف».
- **Desktop page:** two equal columns.
  - Right: «حساب الفعاليات». Left: «حساب محل أحاجي».
  - Generous spacing, with a subtle 1 px divider between the columns.
  - Headings are centred over each column's cards. There are no counts.
- **Cards:** image-backed. Each card shows the room cover (cropped with `object-fit: cover`), a dark gradient, the Arabic name, and a three-dot icon, nothing else.
  - The whole card is a button that opens a dialog.
  - Hover lifts the card and turns the border yellow. Keyboard focus shows a yellow outline.
  - Focus returns to the card when the dialog closes.
- **Dialog for an assigned room:** «نقل إلى …» (primary) and «إزالة الغرفة» (danger), plus «إلغاء» and ✕.
  - Removal asks for confirmation inside the dialog, stating that the room, hints, media, and history are kept.
  - An unassigned room offers «ربط بـ حساب محل أحاجي» and «ربط بـ حساب الفعاليات».
- **Unassigned rooms:** «الغرف غير المرتبطة» sits below both columns.
- **Mobile:** sections stack (events first) with a top divider and no horizontal scroll.
- **Refresh behaviour:** results are re-read from the server after every change and announced in a live region. Revisiting the page shows cached data and refreshes it in the background. Saving a room clears the cache.
- **Staff page:** a Game Master's editor has a «الحساب التشغيلي» field (حساب فردي / حساب محل أحاجي / حساب الفعاليات), also available when creating an operator account.
  - For a slot account, the room checklist is replaced by a note pointing to ربط الغرف.
  - The table shows the account label under the username.
  - Passwords stay in Supabase Auth: the existing one-time generated password plus Admin reset via `operator-account`.

## Shared credentials: accountability limits

The two operational accounts are shared by design (a business requirement). Consequences:

- History records the account, not the person. «حساب محل أحاجي» cannot tell which employee ran a game.
- Anyone who knows the password can sign in until it is reset. Reset it when staff change, using the existing Admin reset, which also revokes current sessions.
- Deactivating the account stops every employee using it at once.
- For person-level accountability later, add individual Game Master accounts (no slot) and give them the same rooms. The schema already supports this.

## Display name «عنبر 23»

Room `anbar` keeps its ID and every relationship. Only `rooms.name` changes. In this commit, `supabase/seed.sql` and the test fixtures use «عنبر 23». The live rename is part of the approval-gated rollout below, or the Admin can rename it in the room settings.

## Rollout (each step needs Product Owner approval)

1. Fresh recovery snapshot (`docs/AHAJI_OPERATIONS.md`).
2. Apply `supabase/migrations/20261019120000_operational_room_assignments.sql`.
3. Admin → فريق العمل → إضافة عضو → حساب تشغيلي: create the two username accounts (for example `ahaji_venue` and `ahaji_events`), choosing «حساب محل أحاجي» / «حساب الفعاليات» in «الحساب التشغيلي». Hand over each one-time password securely.
4. Either use ربط الغرف to assign the rooms and rename `anbar` in its room settings, **or** run `supabase/manual/20261019_operational_rollout.sql` once in the SQL editor. The script is idempotent. It aborts without changes if an account is missing, if there is not exactly one room named «أسرار الفاو», or if any of these rooms has a running game.
5. Sign in as each account and confirm that only its rooms appear.

**Rollback:** remove the slots (`admin_set_operational_slot(id, null)`). Access rows remain ordinary assignments. Dropping the migration's functions, triggers, and column restores the previous schema; restore the previous `admin_staff_directory` from `20261012161918_operational_staff_accounts.sql`.

**Live data not verified:** this connector cannot run SQL on the live project. The latest recovery snapshot (2026-10-14) has no room named «أسرار الفاو», and `anbar` is still «السجن». The rollout script checks both before changing anything.

## Tests

| Suite | Kind | Result |
|---|---|---|
| `supabase/tests/operational_room_assignments.sql` | Disposable PostgreSQL 17, self-contained, rolled back | pass |
| All `supabase/tests/*.sql` on a restore of `post-media-draft-final-20261014` plus the migration | Disposable | 9 pass. `phase3_assertions`, `phase4_rls`, and `phase5_directory_rls` fail identically **without** the migration (they assume 3 rooms and predate the single-image constraint). |
| Rollout script on that restore | Disposable | Aborts without accounts and without «أسرار الفاو», then applies the expected distribution |
| `tests/test_room_assignment_browser.py` | Chromium, mocked Supabase | 11 pass |
| Full Node and browser regression | Node, plus Chromium with mocked Supabase | 11 and 48 pass |

No live Supabase change, account, or deployment was made.
