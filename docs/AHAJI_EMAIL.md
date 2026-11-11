# Ahaji staff email (temporary Brevo setup)

Updated 2026-11-11 (Asia/Riyadh). Supabase project `gbhleqizxcmxmutgcjon`. Status: **live and tested for password recovery**. This is a temporary, Product Owner-approved setup that does not authenticate `ahaji.sa`. It is not a guaranteed-delivery production mail system.

## How it works

Supabase Auth sends its own emails (password recovery and staff invitations from `staff-invite`) through custom SMTP. The SMTP relay is Brevo's free plan. The application code does not send email and holds no email credentials.

```
recover.html / staff-invite  ->  Supabase Auth  ->  smtp-relay.brevo.com:587  ->  recipient
```

## Live configuration (no secrets)

Supabase Dashboard -> Authentication -> Emails -> SMTP Settings:

| Field | Value |
|---|---|
| Enable custom SMTP | On |
| Sender email | The Product Owner's verified Brevo sender (a Gmail address) |
| Sender name | `Ahaji` |
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | The Brevo SMTP login shown in Brevo -> SMTP & API -> SMTP |
| Password | A Brevo **SMTP key** (not an API key and not the MCP key) |

The SMTP key exists only in the Supabase dashboard. It must never be committed, pasted into chat, logged, or stored in a backup. To rotate it, generate a new SMTP key in Brevo, paste it into Supabase, save, send one recovery test, then delete the old key in Brevo.

After custom SMTP was enabled, Supabase's email rate limit is 30 messages per hour (Authentication -> Rate Limits).

Brevo account settings that this setup depends on:

- **Authorized IPs -> SMTP keys: Deactivated.** Supabase sends from changing IP addresses. With blocking active, Brevo rejects every message with `525 5.7.1 Unauthorized IP address`. Keep **API keys** blocking activated to protect the Brevo MCP key.
- **Plan: Free**, 300 emails per day.
- **Sender:** the verified Gmail sender. Brevo rewrites free-mail senders, so recipients see `<local-part>@12503251.brevosend.com` with the display name `Ahaji`. Changing the visible local part requires a different, real, verified mailbox.

## Email templates

The repository is the source of truth:

| Supabase template | Subject | File |
|---|---|---|
| Reset password | `أحاجي · استعادة كلمة المرور` | `supabase/templates/recovery.html` |
| Invite user | `أحاجي · دعوة للانضمام إلى فريق العمل` | `supabase/templates/invite.html` |

Both are wired in `supabase/config.toml` for a local Supabase stack. The hosted project does **not** read these files: after editing a template, paste its full content into Authentication -> Emails -> Templates and save. Then reload the page and confirm the saved body matches the file exactly.

Design: Arabic RTL, dark (`#0d0d0d` page, `#141414` card, `#f5c800` button), one button, inline styles only, no external fonts. The logo is built from an HTML table of colored cells instead of an image. Gmail blocks all images in the spam folder, so an image logo appeared broken there. The table version shows everywhere. Do not replace it with an `<img>` unless the sender domain is authenticated and mail reliably reaches the inbox.

## Verification record

- 2026-11-11: password recovery sent through Supabase -> Brevo, delivered to Gmail (`delivered` in Brevo logs). The link opened `recover.html` on the "choose a new password" form. The HTML logo rendered in the spam folder.
- Invite template is saved live but has **not** been tested with a real invitation.
- Outlook/Hotmail delivery has **not** been tested. Brevo warns that unauthenticated mail to Microsoft recipients may be rejected or filtered.

## Known limits

- **Spam folder.** Messages currently land in Gmail spam because the sender is a rewritten free-mail address. Tell each new staff member to check spam the first time and mark the message "Not spam". This is a limit, not a bug.
- **Personal sender name.** The visible sender address contains the Product Owner's Gmail local part.
- **Operator usernames** (`name@ahaji.com`) are login aliases, not mailboxes; they receive no email and have no email recovery.

## Permanent fix (requires approval)

Authenticate `ahaji.sa` in Brevo (Brevo code, DKIM and DMARC records added in Azure DNS), create and verify the sender `noreply@ahaji.sa`, then change only **Sender email** in Supabase. The SMTP host, port, login, key and templates stay the same. Azure DNS changes need explicit Product Owner approval.

## Troubleshooting

Supabase Auth logs (Log Explorer, source `auth_logs`) show the SMTP error for each failed `/recover` or invite:

| Symptom | Cause | Fix |
|---|---|---|
| `/recover` takes ~10 s, `504`, `context deadline exceeded` | Supabase cannot reach the SMTP server (for example, a wrong port) | Check Host and Port (`587`) |
| `500`, `525 5.7.1 Unauthorized IP address` | Brevo IP blocking is active for SMTP keys | Deactivate blocking for SMTP keys in Brevo -> Security -> Authorized IPs |
| `500`, authentication error | Wrong username or SMTP key | Regenerate the SMTP key and paste it into Supabase |
| `200` but no email | Check Brevo -> Transactional -> Logs, then the recipient's spam folder | |

Do not resend repeatedly: each request counts against the hourly and daily limits.

## Incident note: 2026-11-09 project outage

The whole project (Database, PostgREST, Auth, Realtime, Storage) was Unhealthy from at least 06:08 UTC. A dashboard restart did not recover it within ten minutes. No `postgres_logs` or `auth_logs` existed for the prior 24 hours, so the outage likely predated that day's SMTP port change. A Supabase support ticket was filed. Service was healthy again by 12:55 UTC; the exact recovery time is unknown.

## Roll back

Turn off **Enable custom SMTP** in Supabase to return to the default sender, which only delivers to project team addresses. **Reset template** on each template page restores Supabase's English defaults.
