# Ahaji engineering rules

- Treat the Product Owner's current milestone scope and approval gate as authoritative. Do not start the next phase without explicit approval.
- Preserve the three existing room flows and the GM/Cast URL shape when changing internals.
- Keep room configuration in `js/app.js`, session transport in `js/session-adapter.js`, and timer/UI behavior in the page scripts.
- Scope every session read, write, and message by both room ID and session ID. Never overwrite a saved session belonging to another room.
- Keep credentials out of Git. Use only free tools and infrastructure; database and auth work belong to their approved phases.
- Run browser checks for GM and Cast together before presenting a milestone. Keep existing uncommitted work intact and use a feature branch for changes.
