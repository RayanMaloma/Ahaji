# Ahaji

Ahaji is an escape room Game Master and Cast display application. Current gameplay runs on localhost with vanilla HTML/CSS/JavaScript. Room configuration is shared in `js/app.js`; the Phase 2 session adapter keeps game state in localStorage and synchronizes tabs with BroadcastChannel. GM and Cast must share a browser storage context.

## Local preview

From the repository root, run `python -m http.server 8765 --bind 127.0.0.1` and open `http://127.0.0.1:8765/index.html`. Select a room, then use **Open Cast Screen** on the GM page. Cast audio needs a user interaction to unlock playback.

## Database foundation

Phase 3 added a protected Supabase PostgreSQL schema for rooms, hints, media references, and future session snapshots. The browser does not query it yet; game controls and local synchronization are unchanged. The migration, seed, security model, backup procedure, and recovery steps are in [the Phase 3 architecture note](docs/AHAJI_PHASE_3_BACKEND_DATABASE.md). No credentials belong in this repository; `.env.example` lists configuration names only.

## Checks

- `python -m unittest discover -s tests -p 'test_phase2_browser.py' -v` — Playwright GM/Cast browser flows.
- `node --test tests/test_room_repository.mjs` — future catalog data-access boundary.
- `supabase/tests/phase3_assertions.sql` — database integrity and privilege checks after migration and seed.

The Product Owner approves each roadmap milestone before the next phase begins.
