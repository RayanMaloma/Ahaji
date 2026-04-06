# CLAUDE.md

## Project Identity
This project is a **local-only Escape Room Game Master system** for **Ahaji**.
It is used on **the same machine via localhost**, with **no domain, no backend, and no database** in v1.

The product has 3 room options:
- Prison
- Pyramid
- Uncle Saleh

The user flow is:
1. Open the home page.
2. Show 3 room cards.
3. The Game Master clicks one room.
4. Open the Game Master page for that room.
5. Open the Cast page for that room.
6. Before the game starts, the Cast page shows the selected room image.
7. When the Game Master clicks **Start**, the room image remains visible and the screen shows a **large countdown timer** plus a **hint box overlay**.

---

## Main Goal
Build a clean, reliable **front-end only** local MVP that works smoothly on localhost and feels polished enough for real in-room use.

---

## Non-Negotiable Constraints

### Scope
- This is **version 1 only**.
- Do **not** add backend.
- Do **not** add Firebase, Supabase, WebSockets, databases, authentication, APIs, or deployment setup.
- Do **not** add features that were not requested.
- Do **not** redesign the product concept.

### Technical Boundaries
- Use only **HTML, CSS, and vanilla JavaScript**.
- Must run locally on **localhost**.
- Must support communication between pages using a **local-only browser mechanism**, preferably:
  - `BroadcastChannel`
  - and/or `localStorage` events as fallback if needed.
- No frameworks unless explicitly requested later.

### Design Boundaries
- Preserve the immersive room feeling.
- The Cast screen is **not** a boring dashboard.
- The room image must remain visible after start.
- Timer and hint box must feel integrated with the room image, not randomly pasted on top.
- The layout must look strong on a large display.

### Working Style
- Make only the requested changes.
- Keep code clean and modular.
- If you need to make a structural decision, choose the simplest stable option.
- If a requested change might break current behavior, explain it before changing too much.

---

## Product Requirements

### 1) Home Page
Create a landing page that shows 3 room choices:
- Prison
- Pyramid
- Uncle Saleh

Requirements:
- Each room appears as a clear selectable card.
- Strong visual hierarchy.
- Easy for a Game Master to use quickly.
- When a room is selected, navigate into the Game Master flow for that room.

### 2) Game Master Page
The Game Master page must control the selected room.

Minimum required controls:
- Show selected room name
- Start timer
- Pause timer
- Resume timer
- Reset timer back to 60:00
- Add time
- Subtract time
- Hint input field
- Send / update hint
- Open Cast screen button

Behavior:
- The timer starts at **60:00**.
- Game Master actions must immediately affect the Cast page.
- The Cast page should be openable in a separate window/tab from the same local machine.

### 3) Cast Page
The Cast page is the in-room display screen.

Before Start:
- Show the selected room image full-screen or near full-screen.
- Show Ahaji logo at top-left.
- No timer visible yet.
- No ugly placeholder UI.

After Start:
- Keep the room image visible.
- Show a large clear countdown timer over the image.
- Show a large hint box over the image.
- The timer and hint box must be visually balanced with the background image.
- The hint box should be wide, responsive, and suitable for TV or display casting.

Important:
- The image must **not disappear** when the timer starts.
- The timer and hint container should feel like part of the scene.
- Use an overlay layer if needed for readability.

---

## Assets
Assume this structure exists or should be used:

```txt
/images
  anbar.png
  pyramid.png
  amsaleh.png
  ahaji-logo.png
```

Map rooms like this:
- Al Anbar -> `images/prison.png`
- Al Haram -> `images/pyramid.png`
- Am Saleh -> `images/unclesaleh.png`
- Logo -> `images/ahajilogo.png`

If file names need to be referenced in code, keep them exactly as above unless the actual project files differ.

---

## Suggested File Structure
Use this unless the current project already has a better equivalent structure:

```txt
/index.html
/gm.html
/cast.html
/css/style.css
/js/app.js
/js/gm.js
/js/cast.js
/images/...
```

If reorganization is needed, do it cleanly and keep paths obvious.

---

## Room State Model
Use a single simple room state object for local communication.

Suggested state fields:
- `roomId`
- `roomName`
- `image`
- `status` (`idle`, `running`, `paused`, `ended`)
- `durationSeconds`
- `remainingSeconds`
- `hintText`
- `startedAt`
- `lastUpdatedAt`

Keep the implementation simple.

---

## UX Priorities
Prioritize these in order:
1. Reliability of local communication between GM and Cast
2. Readability of timer on large display
3. Strong room atmosphere on Cast page
4. Clean controls on GM page
5. Responsive layout

---

## Visual Direction
- Clean
- Dark / immersive
- Professional
- Minimal clutter
- Good spacing
- Large readable timer
- Hint box should feel intentional and premium
- Avoid over-animating
- Avoid gimmicks

---

## What Not To Do
- Do not add login
- Do not add unnecessary settings panels
- Do not add sound systems unless requested
- Do not add networking or server setup
- Do not add admin roles
- Do not add extra room management complexity
- Do not convert to React/Vue/etc.
- Do not create fake backend code

---

## Delivery Standard
When implementing:
- Keep code readable
- Comment only where helpful
- Avoid duplication
- Keep naming clear
- Make sure the full flow works end-to-end
- If something is mocked temporarily, label it clearly

---

## Response Style
When responding while coding:
- Be direct and practical
- State what you changed
- State what files were touched
- State any assumptions clearly
- Do not add unnecessary explanation
