# Ahaji Phase 1 Room Configuration Foundation

Date: 2026-09-07

## Summary

Phase 1 consolidated room configuration into one authoritative source in `js/app.js` while preserving the existing static HTML/CSS/JavaScript architecture.

No `/admin`, authentication, database, APIs, framework, dependencies, URL changes, session changes, realtime changes, UI redesign, or Game Master/Cast behavior changes were added.

## Old Room Configuration Locations

Before Phase 1, room configuration was fragmented across:

- `js/app.js`
  - `ROOMS` registry
  - room IDs
  - room names
  - Cast/background images
  - hint sounds
  - lose sound/video
  - GM images
  - GM sounds
- `index.html`
  - room IDs
  - room names
  - room thumbnail images
  - static selector card markup
- `js/gm.js`
  - `HINTS_FILE` mapping from room ID to static hint text file
- `hints/*.txt`
  - static newline-separated room hint libraries

## New Authoritative Room Structure

Room metadata now lives in one normalized source: `ROOM_CONFIGS` in `js/app.js`.

Each room supports this shape:

```js
{
  id: string,
  name: string,
  thumbnail: string,
  backgroundImage: string,
  image: string,
  defaultDuration: number,
  media: {
    hintSound: string | null,
    loseSound: string | null,
    loseVideo: string | null,
    gmImages: Array<{ label: string, src: string }>,
    gmSounds: Array<{ label: string, src: string }>
  },
  hints: {
    source: string | null
  }
}
```

`image` is retained as a compatibility alias for `backgroundImage`. The persisted `GameSessionState` still uses `image`, exactly as before.

## Repository API

`js/app.js` now exposes:

```js
getRooms()
getRoom(roomId)
getRoomMedia(roomId)
```

Behavior:

- `getRooms()` returns the normalized room list in display order.
- `getRoom(roomId)` returns the normalized room for a known ID or `null`.
- `getRoomMedia(roomId)` returns normalized media for a known room or defensive empty media defaults.

Defensive media defaults:

```js
{
  hintSound: null,
  loseSound: null,
  loseVideo: null,
  gmImages: [],
  gmSounds: []
}
```

This keeps rooms without optional media from crashing the runtime.

## Files Changed

- `index.html`
  - Removed static duplicated room cards.
  - Added dynamic selector rendering from `getRooms()`.
  - Preserved the same generated card classes, labels, thumbnails, `data-room` values, and navigation behavior.

- `js/app.js`
  - Replaced the old hand-authored `ROOMS` source with normalized `ROOM_CONFIGS`.
  - Added `normalizeRoom()`, `getRooms()`, `getRoom()`, and `getRoomMedia()`.
  - Kept a generated `ROOMS` lookup internally for compatibility with the current plain-script architecture.
  - Updated `createInitialState()` to use `backgroundImage` and `defaultDuration`.
  - Preserved the existing `GameSessionState` shape.

- `js/gm.js`
  - Replaced direct `ROOMS[roomId]` validation with `getRoom(roomId)`.
  - Removed the duplicated `HINTS_FILE` mapping.
  - Loads room hint libraries from `room.hints.source`.
  - Reads room media through `getRoomMedia(roomId)`.
  - Preserved URL, session, timer, hint, media, localStorage, and BroadcastChannel behavior.

- `js/cast.js`
  - Reads room config through `getRoom(roomId)`.
  - Reads notification and lose media from the same normalized room source.
  - Preserved Cast URL, state application, render loop, audio unlock, localStorage recovery, and BroadcastChannel behavior.

- `docs/AHAJI_PHASE_1_ROOM_FOUNDATION.md`
  - Documents this phase.

## Compatibility Guarantees

Preserved exactly:

- Room IDs:
  - `anbar`
  - `haram`
  - `saleh`
- Existing routes:
  - `index.html`
  - `gm.html?room={roomId}`
  - `gm.html?room={roomId}&session={sessionId}`
  - `cast.html?room={roomId}&session={sessionId}`
- Current session creation behavior.
- Existing `GameSessionState` fields.
- `localStorage` session key format: `ahaji-state-{sessionId}`.
- `localStorage` saved hint key format: `ahaji-saved-hints-{roomId}`.
- `BroadcastChannel` name format: `ahaji-session-{sessionId}`.
- Shared `renderCastView()` renderer.
- All existing room assets and paths.
- Static hint text files and loading behavior.
- GM preview behavior.
- Cast display behavior.
- Timer wall-clock behavior.
- Win and timeout/lose behavior.

## Preserved Room Data

### `anbar`

- Name: `Prison`
- Thumbnail: `images/prison.jpg`
- Background: `source/prison/background.jpg`
- Default duration: `3600`
- Hint sound: `source/prison/hint-sound.mp3`
- Lose sound: `source/prison/loose-sound.mp3`
- GM image: `source/prison/images/مكان فك الزنزانة.png`
- GM sound: `source/prison/sounds/صوت باب العنبر.mp3`
- Hint source: `hints/prison.txt`

### `haram`

- Name: `Pyramid`
- Thumbnail: `images/pyramid.png`
- Background: `source/pyramid/background.jpg`
- Default duration: `3600`
- Hint sound: `source/pyramid/hint-sound.mp3`
- Lose sound: none
- Lose video: none
- GM images:
  - `source/pyramid/imghint1.png`
  - `source/pyramid/imghint2.png`
- GM sounds: none
- Hint source: `hints/pyramid.txt`

### `saleh`

- Name: `Uncle Saleh`
- Thumbnail: `images/unclesaleh.png`
- Background: `source/unclesaleh/background.jpg`
- Default duration: `3600`
- Hint sound: `source/unclesaleh/hint-sound.mp3`
- Lose sound: none
- Lose video: `source/unclesaleh/loose-video.mp4`
- GM image: `source/unclesaleh/imghint1.png`
- GM sounds: none
- Hint source: `hints/uncle-saleh.txt`

## Verification Performed

Verification used the local static server:

```txt
python -m http.server 4173
```

Syntax checks:

```txt
node --check js/app.js
node --check js/gm.js
node --check js/cast.js
```

All syntax checks passed.

Generated room selector verification:

- Card count: 3
- Room IDs: `anbar`, `haram`, `saleh`
- Room names: `Prison`, `Pyramid`, `Uncle Saleh`
- Thumbnails:
  - `images/prison.jpg`
  - `images/pyramid.png`
  - `images/unclesaleh.png`

### `anbar` Verification

Passed:

- Room selector renders `Prison`.
- GM opens at `gm.html?room=anbar&session={sessionId}`.
- Session is generated automatically.
- Cast opens at `cast.html?room=anbar&session={sessionId}`.
- Cast background is `source/prison/background.jpg`.
- Timer starts and Cast content becomes visible.
- Pause changes GM button to `RESUME` and Cast timer to paused state.
- Resume returns GM timer to running state.
- Time adjustment from `60:00` to `61:00` syncs to Cast.
- Hint sends from GM and appears on Cast.
- Alert/hint sound action executed with no browser console errors.
- GM image list shows one item and displays it on Cast.
- GM sound list shows one playable sound item.
- Win state shows Cast result `Winners!`.
- Timeout shows Cast lose state `Game Over`.
- Reload preserves same session URL and ended/lose display.
- No GM or Cast console errors observed.

### `haram` Verification

Passed:

- Room selector renders `Pyramid`.
- GM opens at `gm.html?room=haram&session={sessionId}`.
- Session is generated automatically.
- Cast opens at `cast.html?room=haram&session={sessionId}`.
- Cast background is `source/pyramid/background.jpg`.
- Timer starts and Cast content becomes visible.
- Pause/resume works.
- Time adjustment from `60:00` to `61:00` syncs to Cast.
- Hint sends from GM and appears on Cast.
- Alert/hint sound action executed with no browser console errors.
- GM image list shows two items and displays the selected image on Cast.
- GM sound list correctly shows no items.
- Win state shows Cast result `Winners!`.
- Timeout shows Cast lose state `Game Over`.
- Reload preserves same session URL and ended/lose display.
- No GM or Cast console errors observed.

### `saleh` Verification

Passed:

- Room selector renders `Uncle Saleh`.
- GM opens at `gm.html?room=saleh&session={sessionId}`.
- Session is generated automatically.
- Cast opens at `cast.html?room=saleh&session={sessionId}`.
- Cast background is `source/unclesaleh/background.jpg`.
- Timer starts and Cast content becomes visible.
- Pause/resume works.
- Time adjustment from `60:00` to `61:00` syncs to Cast.
- Hint sends from GM and appears on Cast.
- Alert/hint sound action executed with no browser console errors.
- GM image list shows one item and displays it on Cast.
- GM sound list correctly shows no items.
- Win state shows Cast result `Winners!`.
- Timeout shows Cast lose state `Playing video`.
- Lose video displays with `source/unclesaleh/loose-video.mp4`.
- Reload preserves same session URL and ended/lose display.
- No GM or Cast console errors observed.

## Remaining Room-Specific Hardcoding

Intentional remaining room-specific data:

- The actual seed room records still live in `ROOM_CONFIGS` in `js/app.js`.
- Static hint libraries remain in `hints/*.txt`.
- Static media files remain in `images/` and `source/`.

Remaining compatibility hardcoding:

- `ROOMS` still exists as a generated lookup object inside `js/app.js`; it is derived from `ROOM_CONFIGS`, not separately maintained room metadata.
- URL file names remain static: `gm.html` and `cast.html`.
- Storage prefixes remain hardcoded for compatibility:
  - `ahaji-state-`
  - `ahaji-saved-hints-`
  - `ahaji-session-`
- Result copy for win/lose remains hardcoded in `renderCastView()`.
- Timer maximum remains `MAX_SECONDS = 5999` in `js/gm.js`.

## Intentionally Left for Future Phases

Not included in Phase 1:

- `/admin`
- authentication
- database schema
- APIs
- server-backed sessions
- server-backed realtime
- media uploads
- room archive/edit/create UI
- data migrations
- route redesign
- framework migration
- Vercel configuration changes

## Review Notes Before Phase 2

- The next safest step is to introduce a persistence/realtime adapter seam for sessions while keeping the same state object and renderer.
- Decide whether future database-backed sessions should snapshot room name/media at launch or always read the latest room record.
- Decide whether static hint files become structured room hints in the database or remain asset-backed during an interim phase.
- Decide how Cast access should work once admin authentication exists; Cast should likely remain accessible by session token/link without an admin login.
