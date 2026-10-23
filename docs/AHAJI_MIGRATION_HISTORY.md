# Migration history reconciliation

## Finding (2026-10-23, read-only)

Migration `20261019100000_theme_and_audio_trim.sql` was run on the live project through the SQL Editor, so its effect exists but `supabase_migrations.schema_migrations` has no row for it. The live history and `supabase/migrations/` otherwise agree: every live version exists locally, and the only local versions missing live are this one and the two unapproved migrations of 2026-10-23 (`20261023100000`, `20261023100100`).

The migration has no data statements and no grants. It adds two `room_media` columns, four constraints (including the replaced `room_media_kind_check` and `session_events_event_type_check`), and one unique index, and it replaces four functions. Later migrations do not redefine any of these objects.

[`supabase/manual/verify_20261019100000_theme_and_audio_trim.sql`](../supabase/manual/verify_20261019100000_theme_and_audio_trim.sql) is a read-only fingerprint of all of them. Each function fingerprint covers its body, `security definer`, `search_path`, result type, volatility, and grants. Live and a disposable PostgreSQL 17 database built from the repository migrations returned identical fingerprints for all 15 rows:

| Object | Fingerprint |
|---|---|
| column trim_end_ms | `668a12f32222bc8dd0a0c94bb982e710` |
| column trim_start_ms | `8dfefade64dbd1deead61faf8393632b` |
| constraint room_media.room_media_asset_ref_check | `dc8a0a01c2c8cf96fa44bd0ee8b1fa2f` |
| constraint room_media.room_media_check | `64ae2596e50e29b84314cb692dc21f26` |
| constraint room_media.room_media_kind_check | `3e1c3c93481d579734e86fee1d350880` |
| constraint room_media.room_media_trim_end_ms_check | `bb86103fbc349687c9696b3bdebddd3c` |
| constraint room_media.room_media_trim_order | `5257c00c47fb30f40e3f4f34269a54ca` |
| constraint room_media.room_media_trim_sound_only | `e620787e0acff4dba01e430a28c2944d` |
| constraint room_media.room_media_trim_start_ms_check | `8020406110f73b5c9220db1b4ca7c2a4` |
| constraint session_events.session_events_event_type_check | `000dc1a378e0a9ae13687ce9f88f5359` |
| function ahaji_private.room_presentation_config(text) | `9490576a82626cb225b6ac88ebf806f2` |
| function public.admin_save_room_draft(text,bigint,jsonb,jsonb,jsonb) | `4becaa705b85617c41df95e215b19c23` |
| function public.create_game_session(text) | `909c56e4019f1bc091d2e4af6169e71b` |
| function public.game_session_command(text,uuid,text,jsonb) | `2c91b3330b8b302991bfca6fe0bcb7dc` |
| index room_media_one_theme_sound_per_room | `860701596f20d62c076975f23b0f053d` |

Conclusion: the migration's whole intended effect is present live. Only its history row is missing.

## Why not `supabase db push` now

`db push` would run `20261019100000` again. It would fail on `add column trim_start_ms` (column already exists), and it would also apply the two unapproved 2026-10-23 migrations. Do not run it until the history is repaired and those migrations are approved.

## Status

Resolved 2026-10-23 with Product Owner approval. All 15 fingerprints were re-verified, and the version was recorded once as `theme_and_audio_trim` without re-running its SQL. `20261023100000` and `20261023100100` were then applied, each with its history row in the same transaction. Live history now matches `supabase/migrations/` through `20261023100100`.

## Reconciliation procedure (requires separate Product Owner authorization)

1. Re-run the verify script live, read-only. Continue only if all 15 rows still equal the table above. Any difference means the live schema changed; stop and investigate instead.
2. Record the version without running it, using either:
   - `supabase migration repair 20261019100000 --status applied --linked` (Supabase CLI, linked to project `gbhleqizxcmxmutgcjon`), or
   - in the SQL Editor, in one statement:
     `insert into supabase_migrations.schema_migrations(version, name) values ('20261019100000', 'theme_and_audio_trim') on conflict (version) do nothing;`
3. Confirm with `supabase migration list --linked`, or a read of `schema_migrations`. Local and remote must agree through `20261019143157`, with only the unapproved 2026-10-23 versions pending.
4. Only then apply the 2026-10-23 migrations, each with its own approval and a fresh snapshot.

Rollback of step 2, if ever needed: `supabase migration repair 20261019100000 --status reverted --linked`. This changes history only, never the schema.
