# Staff invitations and account activation

Implemented 2026-10-14 on `codex/final-review-refinements`. **None of this is live yet.** The migration, Edge Function v4, email template, and Auth settings all wait for Product Owner approval (see "Activation checklist"). Live staff onboarding keeps working the old way until then.

## Flow

1. **Admin → Staff → إضافة عضو → دعوة عبر بريد موثّق.** The Admin enters a name, email, role, and (for a Game Master) rooms.
2. **`staff-invite` Edge Function (`action: invite`)** checks that the caller is an active, verified, email-type Admin, then validates the input and the activation URL (`http(s)://<host>/activate.html` only).
3. **`admin_prepare_staff_invitation`** (SQL, Admin-checked) refuses existing members, operator identities, identities that already have a password, and a live pending invitation for the same email. Otherwise it returns `new`, `reinvite` (Auth identity unconfirmed), or `recreate` (confirmed but never activated, with no password).
4. **`auth.admin.inviteUserByEmail`** creates or reuses the Auth identity and sends the branded **invite** email. The template receives display-only metadata (`ahaji_display_name`, `ahaji_role_label`); authorization never reads metadata.
5. **`admin_record_staff_invitation`** writes an **inactive** `staff_accounts` row, the room assignments, the profile name, and a `staff_invitations` row with `status='pending'` and `expires_at = now() + 24 h`. If this step fails, a newly created identity is deleted, so no mailed link exists without a pending invitation.
6. **The recipient clicks «تفعيل حسابي».** It opens `activate.html?token_hash=…&type=invite`. The page removes the token from the address bar and verifies it only after the recipient presses «متابعة التفعيل», so link-scanning mail filters cannot consume it. `verifyOtp` confirms the email and creates a session.
7. **`my_staff_invitation()`** returns the user's own status. Expired, revoked, and missing invitations get a clear page and are signed out.
8. **The recipient chooses a password** (12+ characters, a letter, a digit, at least 5 distinct characters, must not contain the email name, entered twice). It goes **only** to Supabase Auth through `updateUser`.
9. **`accept_staff_invitation()`** requires a live session, a confirmed email that matches the invitation, a password hash present in Auth, and an unexpired, unrevoked invitation. Only then does it set `staff_accounts.active = true` and mark the invitation `accepted`. Admins are routed to `admin.html`, Game Masters to `index.html`.

**First login is mandatory.** Until activation, `current_staff_role()` is null, so RLS grants nothing. `login.html`, the Admin app, and every guarded page send a signed-in invitee to `activate.html`. Admins cannot switch a pending account on: `admin_manage_staff` raises `Invitation not activated`, and the editor hides the active toggle.

**Resend** (`action: resend`) has a 60-second cooldown and a 20-send cap. It extends expiry by 24 hours. An unconfirmed identity is re-invited. A confirmed identity without a password is replaced, with its rooms and name carried over. An identity that already has a password, an accepted invitation, or a revoked invitation cannot be resent.

**Revoke** (`action: revoke`) marks the invitation revoked, keeps the account inactive, and deletes the identity's Auth sessions, so an opened link cannot continue. A revoked person can be invited again («دعوة مجدداً») if they never set a password.

Existing Admin email logins, operator Game Master usernames (`operator-login`, `operator-account`), and last-Admin protection are unchanged. Accounts created by the previous invite flow have no invitation row and keep working. For those still unconfirmed, the Staff page offers a standard password-setup (recovery) link.

## Security properties

- No password is generated, emailed, stored in application tables, logged, or audited. `ahaji_private.has_password` returns only a boolean.
- `staff_invitations` has RLS enabled and no grants. It is reachable only through the security-definer functions above. `anon` can execute none of them.
- Every invitation change is written to `admin_audit` by the existing trigger.
- Enumeration: only verified Admins can call the endpoint. The activation page shows the same messages to everyone and reveals nothing about other accounts.
- Duplicates: one pending invitation per email (partial unique index), and existing members or operators are refused before any email is sent.
- Link expiry: the application enforces 24 hours. Auth's own OTP expiry must be at least that (see the checklist).

## Email

- Template: `supabase/templates/staff-invite.html`, with a plain-text equivalent in `staff-invite.txt`. It is Arabic RTL, dark with a yellow accent, table-based, 600 px wide, includes an Outlook VML button and a fallback link, has no scripts or SVG, and does not use the animated loader.
- Preview: `docs/email-preview/index.html` (desktop, 375 px mobile, no-name variant, and the plain text). Locally: <http://127.0.0.1:8765/docs/email-preview/>. Regenerate with `node scripts/render-email.mjs`.
- Logo: `images/email/ahaji-logo.png` (380×160, rendered from `images/ahajilogo.svg`). The template expects it at `room-assets/branding/ahaji-email-logo.png` in public Storage. Until it is uploaded, clients show the alt text «أحاجي».
- Supabase Auth sends the HTML body only. The `.txt` file serves a future SMTP provider and documentation.

### Delivery: current state and what is missing

The project uses **Supabase's built-in email sender**. It only delivers to addresses of the project's team members, is heavily rate-limited, and is not meant for production. An earlier controlled test to the Product Owner's own address succeeded; arbitrary staff addresses will be refused (the endpoint reports 424 and does not fake success).

Reliable delivery needs **custom SMTP**, configured by an authorized operator in **Dashboard → Authentication → Emails → SMTP**:

- a provider account with a free tier (for example Brevo, Resend, or a Gmail/Workspace app password);
- a verified sender address or domain;
- host, port, username, password or API key entered only in the Dashboard (never in the repository);
- sender name «أحاجي».

No provider has been connected, no credentials were created, and no live invitation has been sent in this work.

## Activation checklist (needs explicit Product Owner approval)

1. Fresh recovery snapshot (`docs/AHAJI_OPERATIONS.md` → Back up).
2. Apply `supabase/migrations/20261014203000_staff_invitations.sql` to `gbhleqizxcmxmutgcjon`. It has already been verified on a disposable PostgreSQL 17 restore of `post-media-draft-final-20261014` (see Tests).
3. Deploy `staff-invite` v4 (`index.ts` and `handler.ts`, `verify_jwt = true`).
4. Auth settings:
   - Email OTP expiry 86400.
   - Minimum password length 12.
   - Add `http://<review-host>:8765/activate.html` (and any LAN host) to the redirect URLs.
   - Set the invite template subject «دعوة للانضمام إلى فريق أحاجي» and paste `staff-invite.html` as its body.
5. Upload `images/email/ahaji-logo.png` to `room-assets/branding/ahaji-email-logo.png`.
6. Connect custom SMTP (above), or accept the built-in sender's team-only limit.
7. A controlled live test with a Product Owner-approved address: invite, receive, activate, confirm role and room scope, then resend, revoke, and test the expired state.

**Rollback:** deploying the previous `staff-invite` v3 restores the old behavior. The migration only adds objects and redefines three functions. To undo it, restore the previous `admin_manage_staff` and `admin_staff_directory` definitions from `20261012161918_operational_staff_accounts.sql` and drop `staff_invitations` together with its functions.

## Tests

| Suite | Kind | Result |
|---|---|---|
| `supabase/tests/staff_invitations.sql` | Disposable PostgreSQL 17 with self-contained fixtures, rolled back | pass |
| All `supabase/tests/*.sql` on a restore of `post-media-draft-final-20261014` with the migration applied | Disposable, rolled back | 9 pass, including `staff_invitations`. `phase3_assertions`, `phase4_rls`, and `phase5_directory_rls` fail identically **without** the migration (they assume 3 rooms and predate the single-image constraint). |
| `tests/staff-invite-handler.test.mjs` | Node, fake clients | 9 pass |
| `tests/staff-invite-email.test.mjs` | Node: template rendering, escaping, and password policy | 5 pass |
| `tests/test_invitation_browser.py` | Chromium, mocked Supabase | 9 pass |
| `tests/test_staff_management_browser.py` | Chromium, mocked; updated for pending activation | 2 pass |

No live Supabase call, deployment, or email was made.
