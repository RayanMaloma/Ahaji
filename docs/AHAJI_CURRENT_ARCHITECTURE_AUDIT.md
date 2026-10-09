# Ahaji Current Architecture Audit

Date: 2026-09-05

## Current Architecture

Ahaji is currently a static, front-end-only escape-room Game Master application built with plain HTML, CSS, and vanilla JavaScript. There is no package manifest, framework runtime, build step, server application, database client, authentication layer, or API directory in the repository.

Primary files:

- `index.html` - room selection page.
- `gm.html` - Game Master control page.
- `cast.html` - Cast/player display page.
- `css/style.css` - all application styling.
- `js/app.js` - shared room constants, state helpers, timer helpers, and shared Cast renderer.
- `js/gm.js` - Game Master page runtime.
- `js/cast.js` - Cast page runtime.
- `images/` - room cards and shared UI imagery.
- `source/` - room background, hint, sound, image, and video assets.
- `hints/` - room-specific saved hint text files loaded by the GM page.

The original product docs confirm this shape: the app was designed as a local-only browser MVP with no backend, database, framework, authentication, APIs, Firebase, Supabase, or WebSocket service.

## Folder Structure

```txt
/
  index.html
  gm.html
  cast.html
  README.md
  PROJECT_SPEC.md
  CLAUDE.md
  css/
    style.css
  js/
    app.js
    gm.js
    cast.js
  images/
    ahajilogo.svg
    prison.jpg
    pyramid.png
    unclesaleh.png
    confetti-svgrepo-com.svg
    celebration-party-winter-svgrepo-com.svg
  source/
    Almudid.ttf
    prison/
      background.jpg
      hint-sound.mp3
      loose-sound.mp3
      images/
        مكان فك الزنزانة.png
      sounds/
        صوت باب العنبر.mp3
    pyramid/
      background.jpg
      hint-sound.mp3
      imghint1.png
      imghint2.png
    unclesaleh/
      background.jpg
      hint-sound.mp3
      loose-video.mp4
      imghint1.png
  hints/
    prison.txt
    pyramid.txt
    uncle-saleh.txt
  UI Samples/
    1.png
    2.png
    3.png
  docs/
    AHAJI_CURRENT_ARCHITECTURE_AUDIT.md
```

## Route Map

The current app has three static pages. Route state is passed by query string rather than a router.

| Route | Purpose | Important code |
| --- | --- | --- |
| `/index.html` or `/` | Room selection. Displays three hardcoded room cards. | `index.html` room cards use `data-room="anbar"`, `data-room="haram"`, and `data-room="saleh"`. |
| `/gm.html?room={roomId}` | Game Master page for the selected room. If no session is present, it generates one and rewrites the URL to include it. | `js/gm.js` reads `room` and `session` with `URLSearchParams`. |
| `/gm.html?room={roomId}&session={sessionId}` | Existing/reloaded Game Master session. | `js/gm.js` validates `ROOMS[roomId]`, loads persisted session state, and owns the session. |
| `/cast.html?room={roomId}&session={sessionId}` | Cast/player display attached to the same Game Master session. | `js/gm.js` opens this URL; `js/cast.js` refuses to run without `session`. |

There is no `/admin`, no nested routing, no client-side router, and no dynamic server route handling.

## Current Room Selection Flow

Room selection is hardcoded in `index.html`.

- Each card has a fixed `data-room` value.
- The card image and label are also hardcoded in the HTML.
- Clicking a card navigates directly to `gm.html?room={roomId}`.
- `index.html` intentionally does not create or persist a session. The GM page owns session creation.

Current room IDs:

- `anbar` - Prison
- `haram` - Pyramid
- `saleh` - Uncle Saleh

## Game Master Flow

`gm.html` defines the Game Master control surface and loads `js/app.js` followed by `js/gm.js`.

Key controls:

- Start timer: `#btn-start`
- Pause/resume timer: `#btn-pause`
- Reset timer: `#btn-reset`
- Win state: `#btn-win`
- Alert sound: `#btn-alert`
- Alert volume: `#alert-volume`
- Add/subtract adjustment value: `#btn-add-time`, `#btn-sub-time`, `#time-adj-value`
- Apply time adjustment: `#btn-update-time`
- Hint input/send/clear: `#hint-input`, `#btn-send-hint`, `#btn-clear-hint`
- Media buttons: videos, hints, images, sounds
- Image overlay size: `#image-size-slider`
- Open Cast screen: `#btn-open-cast`

The GM page also contains an embedded Cast preview that uses the same shared rendering selectors as the real Cast page through `data-cast-*` attributes.

## Cast Flow

`cast.html` defines the player-facing screen and loads `js/app.js` followed by `js/cast.js`.

Important Cast elements:

- Room background image: `#cast-bg`
- Overlay: `#cast-overlay`
- Idle room name: `#cast-idle-name`
- Timer: `#cast-timer`
- Hint box/text: `#cast-hint-box`, `#cast-hint-text`
- Win/lose result screen: `#cast-result-screen`
- Lose video: `#cast-lose-video`
- Image overlay: `#cast-image-overlay`
- Audio unlock overlay: `#cast-audio-unlock`
- Fullscreen button: `#cast-fullscreen-btn`

The Cast page requires `session` in the URL. If missing, it renders an invalid-session overlay and does not attach to any channel or state.

## Room Configuration Locations

Room configuration is currently split across multiple files and asset folders.

### `js/app.js`

The main room registry is the `ROOMS` object in `js/app.js`.

It defines:

- Room ID
- Display name
- Cast/background image
- Hint notification sound
- Lose sound or lose video
- GM-selectable images
- GM-selectable sounds

Current definitions:

```js
anbar: {
  id: 'anbar',
  name: 'Prison',
  image: 'source/prison/background.jpg',
  media: {
    hintSound: 'source/prison/hint-sound.mp3',
    loseSound: 'source/prison/loose-sound.mp3',
    gmImages: [{ label: 'مكان فك الزنزانة', src: 'source/prison/images/مكان فك الزنزانة.png' }],
    gmSounds: [{ label: 'صوت باب العنبر', src: 'source/prison/sounds/صوت باب العنبر.mp3' }]
  }
}
```

```js
haram: {
  id: 'haram',
  name: 'Pyramid',
  image: 'source/pyramid/background.jpg',
  media: {
    hintSound: 'source/pyramid/hint-sound.mp3',
    gmImages: [
      { label: 'تلميح لغز العصا', src: 'source/pyramid/imghint1.png' },
      { label: 'تلميح لغز الدرج', src: 'source/pyramid/imghint2.png' }
    ]
  }
}
```

```js
saleh: {
  id: 'saleh',
  name: 'Uncle Saleh',
  image: 'source/unclesaleh/background.jpg',
  media: {
    hintSound: 'source/unclesaleh/hint-sound.mp3',
    loseVideo: 'source/unclesaleh/loose-video.mp4',
    gmImages: [{ label: 'تلميح لغز التركيبة', src: 'source/unclesaleh/imghint1.png' }]
  }
}
```

### `index.html`

Room cards are hardcoded independently from `ROOMS`.

- `data-room="anbar"` uses `images/prison.jpg` and label `Prison`.
- `data-room="haram"` uses `images/pyramid.png` and label `Pyramid`.
- `data-room="saleh"` uses `images/unclesaleh.png` and label `Uncle Saleh`.

This means the room-selection display data can drift from `js/app.js`.

### `js/gm.js`

Hint text file mapping is hardcoded separately in `HINTS_FILE`.

```js
const HINTS_FILE = {
  anbar: 'hints/prison.txt',
  haram: 'hints/pyramid.txt',
  saleh: 'hints/uncle-saleh.txt',
};
```

Saved custom hints are keyed only by room ID:

```js
const HINTS_KEY = 'ahaji-saved-hints-' + roomId;
```

### `hints/`

Room hint libraries are stored as newline-separated static text files:

- `hints/prison.txt`
- `hints/pyramid.txt`
- `hints/uncle-saleh.txt`

The GM page loads these with `fetch()`, splits on newline, trims blank lines, and renders each hint as a selectable saved hint.

### `source/` and `images/`

Asset paths are referenced directly by hardcoded strings in HTML and JavaScript. There is no asset manifest, upload abstraction, or storage provider.

## Hardcoded Dependencies

The following dependencies are hardcoded into runtime behavior:

- Room IDs/slugs: `anbar`, `haram`, `saleh`.
- Room selection cards and thumbnail images in `index.html`.
- Main room registry in `js/app.js`.
- Hint file path map in `js/gm.js`.
- Local custom hint storage key prefix `ahaji-saved-hints-`.
- Session state storage key prefix `ahaji-state-`.
- Broadcast channel prefix `ahaji-session-`.
- Default game duration: `3600` seconds.
- Maximum timer value: `5999` seconds in `js/gm.js`.
- Cast URL pattern: `cast.html?room={roomId}&session={sessionId}`.
- GM URL pattern: `gm.html?room={roomId}`.
- Room-specific media behavior:
  - Prison has lose sound.
  - Uncle Saleh has lose video.
  - Pyramid has no lose media configured.
- Result copy for win/lose is hardcoded in `renderCastView()`.

## Data Flow

### Room Selection to GM

```txt
index.html room card click
  -> reads card.dataset.room
  -> navigates to gm.html?room={roomId}
```

### GM Session Creation

```txt
gm.js loads
  -> reads room from URL
  -> validates ROOMS[roomId]
  -> reads session from URL
  -> if missing, generateSessionId()
  -> replace current URL with room + session query params
  -> create BroadcastChannel("ahaji-session-" + sessionId)
  -> load localStorage["ahaji-state-" + sessionId]
  -> if missing or mismatched, createInitialState(roomId, sessionId)
  -> save and broadcast state
```

### GM to Cast

```txt
GM Open Cast Screen
  -> window.open("cast.html?room={roomId}&session={sessionId}")

cast.js loads
  -> reads room and session from URL
  -> refuses to attach if session is missing
  -> creates BroadcastChannel("ahaji-session-" + sessionId)
  -> loads localStorage["ahaji-state-" + sessionId]
  -> renders current state if found
  -> listens for BroadcastChannel messages
  -> listens for localStorage storage events for same state key
```

## Game State Flow

The authoritative state object is created by `createInitialState(roomId, sessionId)` in `js/app.js`.

Current state shape:

```js
{
  sessionId,
  roomId,
  roomName,
  image,
  viewMode: 'normal',
  status: 'idle',
  remainingSeconds: 3600,
  endsAt: null,
  hintText: '',
  activeImageSrc: null,
  activeImageScale: 100,
  lastUpdatedAt: Date.now()
}
```

Additional fields can be introduced by runtime actions:

- `resultState`
- `isWin`
- `isLose`
- `loseMode`

Status values currently used:

- `idle` - selected room, game not started.
- `running` - countdown active.
- `paused` - countdown frozen or win state reached.
- `ended` - timer reached zero.

Result/view values currently used:

- `normal`
- `win`
- `lose`

There are no formal TypeScript types, interfaces, classes, schemas, or model files. All models are implicit JavaScript object shapes.

## Timer Architecture

The timer is wall-clock based, not interval-count based.

Shared helpers in `js/app.js`:

- `getRemainingMs(state)` - if running, computes `state.endsAt - Date.now()`; otherwise uses `remainingSeconds`.
- `getDisplaySeconds(state)` - returns `Math.ceil(getRemainingMs(state) / 1000)`.
- `formatTime(seconds)` - formats as `MM:SS`.
- `freezeRunningTimer(state)` - converts a running timer from `endsAt` into persisted `remainingSeconds`.

GM behavior:

- Initial duration is `3600` seconds.
- Starting from `idle` or `ended` sets:
  - `status = 'running'`
  - `endsAt = Date.now() + remainingSeconds * 1000`
- GM starts a UI-only `setInterval(tick, 250)`.
- `tick()` checks `getRemainingMs(state)`.
- When remaining time reaches zero, `handleTimeout()` sets:
  - `remainingSeconds = 0`
  - `endsAt = null`
  - `status = 'ended'`
  - lose result state unless already won
- `timeoutHandled` prevents duplicate timeout handling.

Cast behavior:

- Cast receives state from BroadcastChannel/localStorage.
- Cast keeps `currentState` in memory.
- If state is running and has `endsAt`, Cast starts its own `setInterval(..., 250)` to re-render from wall-clock time between broadcasts.
- Cast does not own or persist timer transitions to ended; it only renders received state.

This design avoids drift from throttled browser tabs because elapsed time is derived from `Date.now()` and `endsAt`.

## Pause, Resume, and Time Adjustment

Pause/resume is handled by `doTogglePause()` in `js/gm.js`.

- If `status === 'running'`:
  - `freezeRunningTimer(state)` computes remaining seconds.
  - `endsAt` is cleared.
  - `status` becomes `paused`.
  - GM render loop stops.
- If `status === 'paused'`:
  - `endsAt = Date.now() + remainingSeconds * 1000`
  - `status` becomes `running`.
  - `timeoutHandled = false`
  - GM render loop starts.

Time adjustment is handled by `doUpdateTimer()`.

- The UI input value is parsed as minutes.
- Delta is `minutes * 60 * 1000`.
- If running:
  - Remaining milliseconds are computed from `endsAt - Date.now()`.
  - The new remaining time is clamped between `0` and `MAX_SECONDS`.
  - If the result is zero, `endsAt` is set to now and timeout handling runs.
  - Otherwise, `endsAt` is moved forward/backward.
- If not running:
  - `remainingSeconds` is adjusted by minutes.
  - The value is clamped between `0` and `MAX_SECONDS`.
  - If the state was `ended` and new time is greater than zero, the game returns to `paused` and result flags are cleared.

Current important constraint: `btnUpdateTime.disabled = isEnded`, so the ended-state recovery branch in `doUpdateTimer()` is mostly unreachable through the current UI.

## Hints Architecture

There are three hint concepts:

1. Static room hint library
2. Per-room saved custom hints
3. Currently displayed live hint

### Static Room Hints

`js/gm.js` defines `HINTS_FILE`, fetches the matching file, splits it by newline, and stores the result in the page-local `roomHints` array. These hints are selectable from the Hints dropdown but are not stored in session state unless sent.

### Saved Custom Hints

The GM page has functions to load and persist custom saved hints under `localStorage["ahaji-saved-hints-" + roomId]`.

Observed issue: the current UI code supports rendering and deleting custom saved hints, but this codebase does not expose an obvious "save current hint" control. As-is, saved custom hints may be legacy/incomplete functionality unless another workflow previously wrote that localStorage key.

### Live Hint

Sending a hint:

```txt
GM hint input
  -> doSendHint()
  -> state.hintText = trimmed input
  -> render GM + preview
  -> save state to localStorage
  -> BroadcastChannel message { type: "state", state }
  -> if non-empty, BroadcastChannel message { type: "hint-sound" }
  -> Cast applies state and plays room hint sound after audio unlock
```

Clearing a hint sets `state.hintText = ''`, renders, saves, and broadcasts.

## Image and Media Flow

GM-selectable room images are defined in `ROOMS[roomId].media.gmImages`.

When a GM selects an image:

- `state.activeImageSrc` is set to that asset path.
- State is rendered, saved, and broadcast.
- A `hint-sound` message is sent when an image is activated.
- GM preview and Cast display a full-screen black image overlay.

Image scale:

- Stored in `state.activeImageScale`.
- Controlled by `#image-size-slider`.
- Broadcast in the same state object.

GM-selectable room sounds are defined in `ROOMS[roomId].media.gmSounds`, but clicking their play button plays audio locally on the GM page only. It does not broadcast to Cast.

Alert:

- GM broadcasts `{ type: 'alert', volume }`.
- Cast plays the room `hintSound` at the requested volume or a generated beep fallback.

Lose media:

- GM timeout broadcasts normal state plus a separate `{ type: 'lose-media' }` message when lose sound/video is configured.
- Cast chooses `loseVideo` first, then `loseSound`, from its local `ROOMS[roomId].media`.

## Realtime Architecture

Realtime sync is browser-local only.

Primary mechanism:

- `BroadcastChannel(getChannelName(sessionId))`
- Channel name format: `ahaji-session-{sessionId}`
- GM posts:
  - `{ type: 'state', state }`
  - `{ type: 'hint-sound' }`
  - `{ type: 'alert', volume }`
  - `{ type: 'lose-media' }`

Recovery/fallback mechanism:

- `localStorage["ahaji-state-" + sessionId]`
- GM writes full state with `saveState(state)`.
- Cast loads this state on startup.
- Cast listens for the `storage` event for that exact state key.

Important limitation:

- `BroadcastChannel` and `localStorage` only synchronize tabs/windows in the same browser storage context on the same device/profile. This is not a network realtime architecture and does not synchronize across separate devices.

## Current Persistence Architecture

There is no durable backend persistence.

Current persistence:

- Session state is persisted in browser `localStorage` per session ID.
- Saved custom hints are persisted in browser `localStorage` per room ID.
- Static hints are stored as text files in `hints/`.
- Room config is source-code data in `js/app.js` and `index.html`.
- Media assets are static files in `images/` and `source/`.

Storage keys:

- Session state: `ahaji-state-{sessionId}`
- Saved hints: `ahaji-saved-hints-{roomId}`

The runtime also uses in-memory state:

- GM keeps `state`, `renderIntervalId`, `timeoutHandled`, `roomHints`, and dropdown state in memory.
- Cast keeps `currentState`, `renderIntervalId`, audio unlock state, pending sound, and shared audio context in memory.

No `sessionStorage` usage was found.

## Database, Auth, APIs, and Services

Current status:

| Capability | Present? | Notes |
| --- | --- | --- |
| Database | No | No DB client, schemas, migrations, or backend persistence. |
| Authentication | No | No login UI, auth client, sessions, roles, or protected routes. |
| Server APIs | No | No `/api`, server functions, or fetch calls to dynamic endpoints. The only `fetch()` loads static hint text files. |
| WebSockets/realtime service | No | Uses browser `BroadcastChannel`, not a network socket or hosted realtime service. |
| `localStorage` | Yes | Session state and saved hints. |
| `sessionStorage` | No | No usage found. |
| In-memory state | Yes | GM and Cast each keep page-local runtime state. |
| Build framework | No | Static HTML/CSS/JS only. |
| Package dependencies | No | No `package.json` found. |

## Models, Types, and Interfaces

There are no formal models/types/interfaces. The app uses implicit object shapes.

### Room Shape

Defined by entries in `ROOMS`:

```js
{
  id: string,
  name: string,
  image: string,
  media: {
    hintSound?: string,
    loseSound?: string,
    loseVideo?: string,
    gmImages?: Array<{ label: string, src: string }>,
    gmSounds?: Array<{ label: string, src: string }>
  }
}
```

### Game Session State Shape

Created by `createInitialState()` and later extended by GM actions:

```js
{
  sessionId: string,
  roomId: string,
  roomName: string,
  image: string,
  viewMode: 'normal' | 'win' | 'lose',
  resultState?: 'normal' | 'win' | 'lose',
  status: 'idle' | 'running' | 'paused' | 'ended',
  remainingSeconds: number,
  endsAt: number | null,
  hintText: string,
  activeImageSrc: string | null,
  activeImageScale: number,
  lastUpdatedAt: number,
  isWin?: boolean,
  isLose?: boolean,
  loseMode?: 'video'
}
```

### Broadcast Message Shapes

```js
{ type: 'state', state: GameSessionState }
{ type: 'hint-sound' }
{ type: 'alert', volume: number }
{ type: 'lose-media' }
```

## Deployment and Vercel Configuration

No Vercel-specific configuration exists in this repository:

- No `vercel.json`.
- No `.vercel/` directory.
- No `.openai/hosting.json`.
- No `package.json`.
- No framework adapter.
- No environment files found.
- No serverless functions.

Given the current files, the deployed Vercel app is most likely served as a static site using Vercel's default static file behavior or project-level settings outside this repo. The repository itself does not document or encode deployment configuration.

Because the app is static, all room data and assets are shipped to the browser. There are no runtime environment variables currently required.

## Migration Risks

### 1. Room data is duplicated

Room metadata exists in both `index.html` and `js/app.js`, while hint file mapping exists in `js/gm.js`. Migrating only one location to a database would create inconsistent behavior between room selection, GM, and Cast.

### 2. Cast and GM both depend on the same hardcoded `ROOMS`

Lose media, hint sounds, active image availability, and background images are resolved locally on each page from `ROOMS`. A database-backed room model must be available to both GM and Cast before session state is rendered or media events are handled.

### 3. Session state denormalizes room display fields

The session state stores `roomName` and `image` copied from `ROOMS`. If rooms become editable, existing sessions may preserve old names/images while the room record changes. That can be desirable for historical session snapshots, but it must be a deliberate decision.

### 4. Realtime is same-device only

The current sync layer cannot support GM and Cast on separate devices or browsers without shared local storage context. A deployed management platform probably needs server-backed realtime state, but replacing this abruptly could break the working single-device runtime.

### 5. Broadcast event messages are not fully self-contained

Messages like `hint-sound` and `lose-media` rely on the receiving Cast page looking up room media from local `ROOMS`. If room media moves to the database, these event messages either need to include resolved media URLs or the Cast page must reliably have the same room config loaded.

### 6. Static hint files do not map cleanly to editable room records

Room hints are newline-separated text files loaded by static path. Admin-created/editable hints will need a structured hint model or JSON field. Preserving order, language, categories, and deletions should be considered before migration.

### 7. Custom saved hints are local and room-scoped, not session-scoped

`ahaji-saved-hints-{roomId}` lives in a single browser profile and is not visible to other admins or devices. Migrating rooms without deciding what these hints mean could cause data loss or confusing behavior.

### 8. Session identity is generated client-side

`sessionId` is a browser-generated UUID/query param. A database-backed session launch flow should probably create sessions server-side, but the URL contract should be preserved during transition.

### 9. No authorization boundaries exist

Anyone with the GM URL can operate the session. Adding `/admin` auth later must not accidentally block Cast display access or break current direct GM/Cast URLs before replacement routes are ready.

### 10. No schema validation

State and room config are plain objects. Bad/missing fields from a future database or API could break rendering unless validation/defaulting is added at the data boundary.

### 11. Asset paths are static relative URLs

Future uploaded media may live in remote storage. Current code assumes simple relative URLs and uses them directly in `<img>`, `<audio>`, and `<video>`.

### 12. Ended-state time adjustment has a UI mismatch

`doUpdateTimer()` contains logic to recover an ended game when time is added, but the Apply button is disabled when ended. This should be clarified before turning game state into a server-backed contract.

### 13. Vercel config is implicit

No deployment config is checked in. Adding APIs, auth callbacks, or admin routes will require explicit Vercel/project configuration that does not currently exist in source control.

## Recommended Seams for Future Admin and Database Layer

The safest migration path is to attach the future admin/database layer at data-loading seams while keeping the working GM/Cast runtime contract intact at first.

### Seam 1: Room Repository

Create a single room-loading abstraction that initially returns the existing `ROOMS` data:

```txt
getRooms()
getRoom(roomId)
```

Then update `index.html`/room selection, GM, and Cast to consume the same source. This should happen before adding a database so duplicated hardcoded config is removed in a controlled way.

### Seam 2: Room Asset Manifest

Normalize room media into one shape:

```txt
backgroundImage
hintSound
loseSound
loseVideo
gmImages[]
gmSounds[]
hints[]
```

Initially map existing static files into that shape. Later, database records can use the same shape with uploaded/public URLs.

### Seam 3: Session State Adapter

Keep the current session state shape for the GM/Cast renderer, but hide persistence behind an adapter:

```txt
loadSessionState(sessionId)
saveSessionState(sessionId, state)
subscribeToSession(sessionId, callback)
publishSessionEvent(sessionId, event)
```

The first implementation can wrap `localStorage` and `BroadcastChannel`. A later implementation can use API/realtime services without rewriting the renderer.

### Seam 4: Session Creation

Preserve the URL contract while introducing a launch step:

```txt
/admin launches session
  -> creates session record
  -> redirects/opens /gm.html?room={roomId}&session={sessionId}
  -> opens /cast.html?room={roomId}&session={sessionId}
```

This lets the current GM and Cast pages keep working during migration.

### Seam 5: Shared Cast Renderer

`renderCastView(state, els, options)` is already a valuable seam. Preserve it. Future work should feed it validated session state rather than rewrite Cast UI while changing persistence.

### Seam 6: Static-to-Database Room Migration Script/Data File

Before building `/admin`, encode the current rooms as structured seed data. The seed should include all fields from `ROOMS`, `HINTS_FILE`, and `index.html` thumbnails so the first database records exactly reproduce current behavior.

### Seam 7: Compatibility Layer for Current URLs

Keep supporting:

```txt
gm.html?room={roomId}&session={sessionId}
cast.html?room={roomId}&session={sessionId}
```

until new routes are fully stable. If new `/admin` routes eventually replace direct static pages, redirect old URLs rather than removing them abruptly.

## Safest Next Implementation Step

The safest next implementation step is not to add `/admin`, auth, or a database yet. First, consolidate hardcoded room data behind a single room configuration module or JSON manifest that exactly reproduces the current three rooms.

That step should:

- Preserve all current routes and query params.
- Preserve the current Game Master and Cast state shape.
- Preserve the existing `BroadcastChannel`/`localStorage` runtime.
- Move duplicated room metadata and hint-file paths into one source of truth.
- Add defensive defaults for missing optional media fields.

Once that seam exists, database-backed room records can replace the manifest with far less risk.
