# Phase 2: Session Adapter

## Observed baseline

The Phase 1 worktree provides three room configurations in `js/app.js`. Room selection, backgrounds, hints, image lists, sounds, and duration use that registry. Session state was owned by `js/gm.js`; it wrote `localStorage["ahaji-state-" + sessionId]` and posted state and one-shot media events to `BroadcastChannel("ahaji-session-" + sessionId)`. Cast loaded the same key, listened to the channel and storage event, then rendered locally. The timer uses a wall-clock `endsAt`; Cast derives its display time without receiving a message every tick. Saved hint presets use a separate room-scoped key and are not session state.

## Contract

`createSessionAdapter({ roomId, sessionId })` returns:

| Method | Role |
| --- | --- |
| `loadSessionState()` | Read the current snapshot, returning `{ status, state }`. Status is `ok`, `missing`, `invalid`, or `room-mismatch`. |
| `saveSessionState(state)` | GM writes a complete snapshot, stamps a monotonic revision, and publishes it. Rejects mismatched identity and an occupied ID from another room. |
| `subscribe(listener)` | Receive validated `state` changes and session events; returns an unsubscribe function. |
| `publishSessionEvent(type, payload)` | Publish a one-shot `alert`, `hint-sound`, `lose-media`, or `sync-request`. |
| `requestSync()` | Ask an active GM for its latest snapshot. |
| `publishSnapshot(state)` | GM responds to reconnection without modifying persistence or replaying one-shot effects. |
| `close()` | Release channel and storage listeners. |

The adapter is the only code that accesses session storage or `BroadcastChannel`. It preserves the legacy key and channel names and the existing state shape. Every message carries room and session IDs. Incoming state must match both IDs and basic state fields. Revisions discard duplicate and stale state received through both channel and storage paths. GM still owns state transitions; Cast only observes and renders. A Cast opened before its GM stays in a visible unavailable state and recovers when a matching GM starts. Malformed or cross-room saved sessions make GM create a new ID, preserving the original data; Cast refuses the mismatch.

## Later migration

Phase 3 can introduce a backend schema separately. Server-backed sessions should implement the same operations with asynchronous reads/writes, server-assigned revisions, authorization, and a realtime subscription. Phase 8 can switch the adapter factory and await writes while keeping the page state transitions and renderer. A network transport must authenticate GM writes and define Cast read access. Current URL IDs and client checks provide isolation within a browser profile, not security against a user who can edit localStorage or operate a GM URL. Database portability should use versioned SQL migrations and data export in the backend phase.

## Scope notes

No database, authentication, or network service is added here. Room-scoped saved hint presets remain under their existing key because they are room content, outside session state. Browser channel and storage synchronization still requires the same origin and browser storage partition; separate browser contexts or devices do not synchronize in Phase 2.
