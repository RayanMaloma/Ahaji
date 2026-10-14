# Branded loader and perceived performance

Added 2026-10-14 on `codex/final-review-refinements`. Product Owner authorization covered loader integration only. No Supabase, deployment, or `main` changes.

## Assets

`images/loader/ahaji-loader.svg` (animated) and `images/loader/ahaji-loader-reduced.svg` (static) are byte-for-byte copies of the approved package at `svg-animation-studio/output/ahaji-loader/` (studio commit `763ddc4`).

| File | SHA-256 |
|---|---|
| `ahaji-loader.svg` | `f5b876db878bd21cd69aa0b1ed54147314b586721e179b024325b0b2a11d7305` |
| `ahaji-loader-reduced.svg` | `b2b2e14f9d4a13d45b95d781ecdd9b9fca3b2f104f9917441ea1bf490e8d3b65` |

`.gitattributes` marks both files `-text` so Windows line-ending conversion cannot alter them. `tests/test_loader_browser.py` checks the hashes. Do not run SVGO on them or regenerate them. Changes belong in the studio preset.

## Component

- Markup: `.ahaji-loader` with `role="status"`, a `<picture>` that uses the static SVG under `(prefers-reduced-motion: reduce)` and the animated SVG otherwise, and a visible Arabic label. With no label, a visually hidden "جارٍ التحميل…" is announced instead.
- Variants: `--page` is a fixed, opaque gate used before access is confirmed. `--section` sits inline in the content area with a stable minimum height. Size comes from `--loader-size` and keeps the 317:284 aspect ratio, so there is no layout shift.
- `css/loader.css` is imported by `css/admin.css` and `css/style.css`. `js/loader.mjs` exports `createLoader({label, variant, size})` and `withImageSkeleton(img, frame)`.
- Static pages (`admin.html`, `index.html`, `gm.html`, `staff.html`) contain the gate markup directly, so it renders before any script runs. Gates hide through the existing `hidden` attribute. They contain nothing focusable and cannot trap focus.
- The loader fades in after 150 ms, so very fast loads do not flash. It never delays content. Reduced motion removes the fade.

## Initial loading boundary

A hard refresh shows exactly one loader: the full-page gate. It stays up until the first view is complete, then fades out once (180 ms; instant with reduced motion).

Admin boot sequence (`boot()` in `js/admin/app.mjs`):

1. The HTML gate is visible before any script runs. The shell is `hidden`, then `inert` and `aria-busy` while it renders under the gate.
2. In parallel: `currentAccess()` (Auth user → staff role and profile together), the RLS-scoped room read, and preloading of the first six public cover images.
3. Once Admin is confirmed, the Admin-only reads run: settlement → sessions, plus the staff directory. They reuse the room read already in flight. Nothing Admin-only is requested before the role is known.
4. Deep links to history or session detail also load history before reveal.
5. The view renders once under the gate. Then the boot waits for the images actually in the viewport to load and decode, bounded at 2.5 s. A broken image switches to the existing `◇` fallback and stops holding the gate. A slow image keeps its skeleton after the budget and fades in when it arrives.
6. The gate is revealed and the shell becomes interactive. Focus is not moved.

Failures: no session → login, no Admin role → `unauthorized.html`, access network error → the gate error with retry (after supabase-js's own GET retries, about 10 s), data error → the revealed error panel with retry. None of these reveal protected data.

GM room selection (`js/auth/guard.mjs`) follows the same rule: the cards render under the gate and are revealed with their visible images ready (same 2.5 s budget). GM and staff pages hide the gate once their page script has loaded.

## After boot

In-app navigation never shows the page gate again. Rooms, staff, and the workspace render from cached data, and cached images are reused by the browser, so revisited cards appear complete. A small section loader appears only for content not loaded yet: history on first visit, session events, or a data retry. Background refreshes keep current content on screen.

Compact indicators stay as they are: button progress (sign-in, Save All, uploads, password reset), GM/Cast connection badges, the audio player status, and GM image thumbnails. Room images in the workspace and media library use skeletons. The Cast display is unchanged.

## Motion behavior

An SVG inside `<img>` takes reduced motion from the operating system, not from page or browser emulation. On Windows with **Settings → Accessibility → Visual effects → Animation effects** turned off, Chrome shows the finished logo standing still. That is the intended accessible behavior. To review the drawing animation, turn animation effects on and reload. Browsers keep one animation clock per image URL, so a section loader shown later in a session may join the loop partway through.

## Performance changes

The 1–2 second room-image delay came from sequential network round trips before any image request began, not from image size: existing room images are 100–230 KB.

- `currentAccess` reads `staff_accounts` and `staff_profiles` together. The profile is used only after the staff record confirms an active role.
- `admin.load()` runs `admin_settle_sessions` alongside the room and staff reads. Only the session list waits for settlement.
- Admin, GM, and index pages start the RLS-scoped room read alongside the access check and render nothing until access is confirmed. Admin also preloads the first six public cover images. Admin-only requests (`admin_settle_sessions`, `admin_staff_directory`, sessions) are deliberately **not** started before the Admin role is confirmed; `test_phase5_browser` and `test_loader_browser` assert this.
- Preconnect hints to the approved Supabase host are on the protected pages and the login page.
- The first six room images load eagerly with high fetch priority and async decoding.
- Routine Admin re-checks on navigation and tab focus are skipped for 15 seconds after a successful check. Sign-in events, token refresh, profile save, retry, and first load always re-check. RLS still authorizes every request.

## Startup measurements (mocked, controlled latency)

Harness: real headless Chromium, mocked Supabase with 120 ms per API request and 300 ms per cover image, at 1440 × 900. Median of 5 hard loads of `admin.html?view=rooms`. Live Supabase timing was not measured.

| Build | Gate gone | Cards shown | First complete Rooms page | Second loader seen |
|---|---|---|---|---|
| Before loader (`1bb33e0`) | 485 ms | 906 ms | 1290 ms | yes (text panel) |
| First loader (`1df135e`) | 350 ms | 632 ms | 989 ms | yes |
| Current | 797 ms | 797 ms | **797 ms** | no |

Current marks: Admin confirmed ≈ 337 ms (two dependent round trips: Auth user, then staff and profile together); data ready ≈ 614 ms (the longest chain is settlement → session list); visible images decoded ≈ 815 ms. Cover downloads overlap the authorization step. The first complete page arrives about 38% sooner than before the loader, and it now arrives in one step. The remaining critical path is authorization plus `admin_settle_sessions` → `game_sessions`. The Rooms view does not need sessions, so deferring them is the next possible gain.

## Verification

`tests/test_loader_browser.py` (13 tests) uses real headless Chromium with mocked Supabase and controlled slow, held, or aborted requests. A per-frame probe records every visible loader and the state of visible room images at the moment the gate lifts. It covers:

- exactly one loader on hard refresh;
- authorization before any protected content or Admin-only request;
- data and visible images ready before reveal;
- no second loader;
- no image-less cards;
- a broken cover falling back within the budget;
- a slow cover with a bounded wait;
- navigation without the gate or a refetch, with a scoped loader only for unloaded history;
- deep links (staff, history, workspace) booting once;
- auth, role, network, and data failure states;
- the mobile gate centred, with no horizontal scroll;
- the GM selection reveal;
- reduced motion, document animation, and `<img>` animation under both forced OS motion settings;
- asset hashes.

Harness note: Playwright request routing disables the browser cache, and large media passed through the interceptor can stall. `tests/auth_fixture.py` therefore serves local room media with route fulfil and the `cache-control` header that Supabase Storage sends. Image reuse is proven separately in a test without routing.
