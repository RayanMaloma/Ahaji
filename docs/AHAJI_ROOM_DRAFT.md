# Room workspace draft and media behavior

The Admin editor uses one `createRoomDraft` instance per room. General settings, Cast presentation, hints and their order, room image, GM media libraries, and automatic event media are all staged in that instance. Switching tabs rerenders the workspace from the same draft. File objects and preview URLs remain in memory until save or discard. Refresh does not restore them; `beforeunload` requests the browser's native warning.

The compact save bar is present on every tab. In-app navigation away from a dirty workspace opens an accessible three-choice dialog: save and leave, discard, or stay. Browser Back is intercepted before leaving the workspace. Save and discard are disabled while a save is running. A second submission cannot start until the first completes.

For an existing room, Save All uses this order:

1. Validate the room and selected files in the browser. The repository independently enforces the 10 MiB MIME/size allowlist.
2. Upload staged files to unique paths under `room-assets/<room-id>/`. Keep the existing media rows and Storage objects throughout this step.
3. Call `admin_save_room_draft` with the room's original `content_revision`, room settings, and only the hint/media collections that changed. The function checks the current active Admin role, locks the room, rejects a stale revision, validates room-scoped IDs and file references, and commits all relational changes in one PostgreSQL transaction.
4. Reload the authoritative room and reset the draft. If the RPC failed, keep the draft and try to remove only the newly uploaded objects. Report cleanup failure; do not display global success.

New-room creation inserts an inactive room first so uploads can use its stable folder, then updates its settings. On a failed creation, the application attempts to delete that newly created room and staged objects. Existing room IDs are immutable. Storage writes are separate from PostgreSQL, so the entire save is not an atomic distributed transaction.

All room, hint, and media mutations increment `rooms.content_revision`, including changes made through older row APIs. The current editor rejects stale revisions with SQLSTATE `40001`. A conflict keeps the local draft intact; Discard reloads the latest server room. It deliberately does not merge concurrent edits automatically.

The Videos and Sounds tabs distinguish manual GM libraries from automatic event assignments. Manual assets appear in GM controls. The hint sound plays when a hint signal reaches Cast; the loss sound or loss video plays on loss. Cast uses the room's database-driven configuration and the same rendering path as the Admin preview. Audio requires a user gesture in the Cast browser before playback. Removed/replaced Storage objects are retained for session history and backup review rather than deleted automatically.

See `supabase/migrations/20261014113852_room_draft_commit.sql`, `supabase/tests/room_draft_commit.sql`, `docs/AHAJI_OPERATIONS.md`, and `docs/AHAJI_REFINEMENT_STATUS.md` for the migration, denied-operation tests, recovery steps, and validation evidence.
