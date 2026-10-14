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

## Where it is used

| State | Loader |
|---|---|
| Admin access check | page gate "جارٍ التحقق من صلاحية الإدارة…" |
| Rooms, room workspace, new room, staff, history, session detail (first load or retry) | section loader with a view-specific label |
| Session events panel | small section loader |
| GM room selection, GM session start/restore, staff page access | page gate |
| Room cards (Admin and GM selection), room image preview, image library | skeleton until the image decodes |

The following stay compact on purpose: button progress (sign-in, Save All, uploads, password reset), the GM/Cast connection badges, the audio player status, and GM image thumbnails. The Cast display is unchanged.

## Motion behavior

An SVG inside `<img>` takes reduced motion from the operating system, not from page or browser emulation. On Windows with **Settings → Accessibility → Visual effects → Animation effects** turned off, Chrome shows the finished logo standing still. That is the intended accessible behavior. To review the drawing animation, turn animation effects on and reload. Browsers keep one animation clock per image URL, so a section loader shown later in a session may join the loop partway through.

## Performance changes

The 1–2 second room-image delay came from sequential network round trips before any image request began, not from image size: existing room images are 100–230 KB.

- `currentAccess` reads `staff_accounts` and `staff_profiles` together. The profile is used only after the staff record confirms an active role.
- `admin.load()` runs `admin_settle_sessions` alongside the room and staff reads. Only the session list waits for settlement.
- GM/index pages start the RLS-scoped room read alongside the access check and render nothing until access is confirmed. Admin data is deliberately **not** prefetched before the Admin role is confirmed; `test_phase5_browser` asserts this.
- Preconnect hints to the approved Supabase host are on the protected pages and the login page.
- The first six room images load eagerly with high fetch priority and async decoding.
- A background refresh keeps the current page instead of swapping in a loader.
- Routine Admin re-checks on navigation and tab focus are skipped for 15 seconds after a successful check. Sign-in events, token refresh, profile save, retry, and first load always re-check. RLS still authorizes every request.

## Verification

`tests/test_loader_browser.py` uses real headless Chromium with mocked Supabase. It holds requests open to assert each loader, then releases them to confirm the loader leaves as soon as data arrives. It covers:

- asset hashes;
- the Admin gate followed by the rooms loader;
- staff, history, and workspace loaders;
- the image skeleton;
- the reduced-motion fallback;
- document animations;
- drawing animation inside `<img>`, with both OS motion preferences forced via Chromium flags;
- the GM selection gate at 390 px.

These tests do not exercise live Supabase.
