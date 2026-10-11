# Ahaji full product delivery tracker

Updated: 2026-10-11. Integration branch: `codex/full-product-delivery` (from `a9901d8`). Target Supabase project: `gbhleqizxcmxmutgcjon` only.

## Baseline and completed work

- Phases 1–4 are committed and verified in their phase notes. The three existing rooms, 129 hints, and 10 media references remain in the live database.
- Phase 5 review corrections are committed at `a9901d8`: Account card placement, larger titles, Thmanyah typography, selective Kashida, and a logout icon. Fresh browser validation remains pending.
- The working tree was clean before this branch was created. Existing Git history was not rewritten.
- A fresh pre-delivery application-data snapshot was saved in ignored `backups/pre-full-delivery-20261011.json` before schema changes. It contains the existing six application tables and a minimal Auth identity map. It does **not** contain Auth credentials or Storage object bytes.

## Current architecture

- Static HTML, CSS, and JavaScript frontend; publishable Supabase key only.
- Admin catalog and staff directory read Supabase under RLS. GM and Cast still use the local Phase 2 session adapter and a hardcoded gameplay catalog.
- Auth roles live in `staff_accounts` and room assignments in `staff_room_access`; verified email and live session checks are server enforced.
- Room, hint, media, and session tables exist. No server gameplay session has been created yet.

## Remaining work

1. Phase 6: Admin room create/edit/archive; hint and media CRUD and uploads.
2. Phase 7: Make the database catalog authoritative for GM and Cast; preserve all existing content.
3. Phase 8: Server-owned gameplay sessions, timer and event history, recovery.
4. Phase 9: Secure session-scoped Cast access and cross-device synchronization.
5. Phase 10: History, audit, hardening, responsive QA, backups and recovery.
6. Staff Management: secure invitation and account lifecycle.
7. Execute automated and browser journeys A–E, fix defects, and start localhost.

## Applied migrations

Live project currently reports the Phase 3 foundation, Phase 4 auth roles and inactive-room guard, and Phase 5 directory migrations. Do not list new migrations as applied until the project confirms them.

## Resume and safety

Run `git status --short --branch`, read this file and the phase notes, then inspect the live migration list and row counts. Preserve ignored `backups/` and never commit its contents. Do not restore into the live Supabase project. A disposable PostgreSQL 17 database is required for destructive recovery verification. Use the existing Phase 4 backup procedure until the expanded backup tooling is verified.

## Known blockers and limitations

- No full Auth identity backup is possible through application-table exports. Users must be re-invited and roles remapped after a managed Auth loss.
- Supabase Free has service, email, storage, and Realtime quotas and may pause; it is not guaranteed always-on hosting.
- No new-phase acceptance journey has yet been validated. Do not report the product as complete until all five journeys pass.
