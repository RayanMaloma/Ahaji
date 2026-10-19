# Super Admin, reserved operational accounts, and account deletion

**Live since 2026-10-19 (Product Owner approved backup, migration, and function deployment only):**

- **Backup:** `backups/pre-super-admin-20261019.json` (git-ignored). It holds verbatim staff accounts, profiles, room access, the staff Auth identity map (no credentials), migration versions, and the replaced function definitions and grants. Its MD5 matches the server. The file also holds digests of untouched tables; these are integrity fingerprints, not a backup.
- **Recovery:** `supabase/manual/rollback_20261019143157_super_admin.sql` is generated from that backup. Migrate→rollback on disposable PostgreSQL 17 restored the exact pre-migration schema, function body, and grants.
- **Migration:** `20261019143157_super_admin_and_account_deletion` is applied; there are 20 migrations live.
- **Super Admin:** exactly one, «مدير أحاجي» (`a4a591a2…`, the only active verified email Admin). `venue`, `events`, and the inactive accounts are not Super Admin.
- **Changes to existing data:** only that row's flag and `updated_at`, plus one audit row. Staff, profiles, access rows, Auth identities, rooms, hints, media, sessions, events, and earlier audit rows are digest-identical to the backup.
- **Live protections**, checked in a transaction that always rolls back:
  - self-deletion denied;
  - `venue` and `events` deletion denied;
  - API grant of the flag denied;
  - API slot assignment denied;
  - Game Master deletion denied.
- **Edge Function:** `staff-account-delete` v1 is ACTIVE with `verify_jwt=true`, and its deployed source matches the repository. Unauthenticated and invalid-JWT calls return 401. No deletion has been executed.
- **Security advisor:** one new INFO, «RLS enabled, no policy» on `deleted_staff_accounts`. It is intentional: the table is readable only through the Admin RPC `admin_deleted_staff`.

## Super Admin

- Before this change there was no Super Admin concept; every active `admin` had equal rights.
- **The flag:** `staff_accounts.is_super_admin` is allowed only on a verified email Admin, by constraint. No RPC sets it. A trigger rejects any change made with an API identity, including from definer functions, so it is granted or removed only by the database owner (migration or SQL editor).
- **Designation:** the migration marks the Super Admin only when exactly one active, verified email Admin exists. On live today that is «مدير أحاجي». Otherwise it leaves the flag unset and prints a notice.
- `ahaji_private.is_super_admin()` requires an active Admin session with the flag.
- `admin_manage_staff` now refuses changes to a Super Admin account unless a Super Admin makes them, so an ordinary Admin cannot deactivate or demote them.
- The UI shows «المدير الرئيسي» in the staff table and shows «حذف الحساب» only to a Super Admin. The server enforces this regardless of the UI.

## Account deletion

1. **«حذف الحساب»** sits at the bottom of the account dialog. It is hidden for the signed-in Admin, for Super Admin accounts, and for reserved operational accounts.
2. **Confirmation dialog:** it names the account, states that deletion is permanent and that history is kept, and points to deactivation as the reversible alternative. The final button stays disabled until «أفهم أن حذف … نهائي» is checked.
3. **Edge Function `staff-account-delete`** (JWT-verified, testable `handler.ts`):
   1. Calls `admin_prepare_staff_deletion(user_id)` **as the caller**. That function enforces all of the following:
      - the caller is the Super Admin;
      - the target is not the caller's own account;
      - the target is not a Super Admin;
      - the target is not a reserved operational account;
      - the target is not the last active Admin.

      In one transaction it then records a tombstone in `deleted_staff_accounts` (label and the session IDs the account ran), deletes room access, deactivates the account, deletes its Auth sessions, and writes an `admin_audit` row `delete_account` that contains no credentials.
   2. With the server secret, it removes the account's avatar files from `profile-assets/<user_id>/`. Room media is untouched.
   3. It then deletes the Auth identity through `auth.admin.deleteUser`.
4. **Partial failure:** if the Auth deletion fails, the account is already inactive, with no access and no sessions. The UI reports this, and a retry is idempotent: preparation recognizes the tombstone.

**History is preserved.** The foreign keys from `game_sessions.gm_user_id`, `session_events.actor_user_id`, and `admin_audit.actor_user_id` to `auth.users` are `ON DELETE SET NULL`, so rows stay and referential integrity holds. `staff_accounts`, `staff_room_access`, and `staff_profiles` are removed with the identity. Session history shows the tombstone label as «<name> · حساب محذوف» via `admin_deleted_staff()`.

Deactivation («الحساب نشط») remains separate and reversible, available to every Admin.

## Reserved operational accounts

- `venue@ahaji.com` (حساب محل أحاجي, slot `venue`) and `events@ahaji.com` (حساب الفعاليات, slot `events`) are fixed configuration.
- **The «الحساب التشغيلي» selector is removed** from Add Member and from the account dialog.
- **Database rules:**
  - Constraint `staff_reserved_login_names`: the login names `venue` and `events` may exist only bound to the slot of the same name, so ordinary creation cannot claim them, even after a deletion.
  - The unique login and slot indexes still prevent duplicates.
  - `admin_set_operational_slot` is no longer executable by `authenticated`; slots change only through the database owner.
  - Reserved accounts cannot be deleted.
- **In the UI:** their dialog shows a reserved-account note and allows only activation and deactivation. Role and rooms are hidden, and rooms are managed in «ربط الغرف». Password rotation stays in the staff table. Add Member rejects `venue` and `events` before calling the backend, and the database rejects them regardless.
- **Unchanged:** existing credentials, IDs, roles, slots, and sign-in (`operator-login`).

## Live verification before the migration (read-only, 2026-10-19)

- 5 staff accounts:
  - one active email Admin, «مدير أحاجي», who becomes the Super Admin;
  - `venue` and `events`, active, with their slots, and no rooms assigned yet;
  - two inactive legacy accounts.
- Applied to a disposable restore with live-like `venue`/`events` rows, the migration designated «مدير أحاجي» and accepted the existing reserved rows.

## Deployment (each step needs Product Owner approval)

1. Targeted snapshot (as done for the previous migration).
2. Apply `supabase/migrations/20261019143157_super_admin_and_account_deletion.sql`, then confirm that `is_super_admin` is set for «مدير أحاجي» only.
3. Deploy `supabase/functions/staff-account-delete` (`index.ts` and `handler.ts`, `verify_jwt = true`).
4. Optional: one controlled deletion of an obsolete inactive test account (for example `qaoperator`), only if you approve it.

**Compatibility:** until step 2, the current frontend shows no delete option, the directory has no `is_super_admin`, and the deleted-label read falls back to empty.

## Tests

| Suite | Kind | Result |
|---|---|---|
| `supabase/tests/staff_account_deletion.sql` | Disposable PostgreSQL 17, rolled back | pass. Covers: ordinary Admin, Game Master, and anon denied; self, Super Admin, reserved account, and last Admin denied; flag protection; reserved-name and duplicate rejection; deactivation and reactivation; sessions revoked; Auth delete keeps sessions, events, and audit with tombstone attribution; idempotent retry |
| All `supabase/tests/*.sql` on the restored 2026-10-14 snapshot plus both migrations and live-like accounts | Disposable | 10 pass. The 3 known pre-existing phase failures (they assume 3 rooms) are unchanged. |
| `tests/staff-account-delete.test.mjs` | Node, fake clients | 5 pass |
| `tests/test_staff_deletion_browser.py` | Chromium, mocked Supabase | 7 pass |
| Full regression | Node, plus Chromium with mocked Supabase | 16 and 61 pass |
