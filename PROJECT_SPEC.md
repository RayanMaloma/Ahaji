# Ahaji Local Escape Room GM System — Project Spec

## 1. Project Summary
This project is a **local-only browser-based control and display system** for escape room sessions at **Ahaji**.

The system includes:
- a room selection page,
- a **Game Master control page**,
- and a **Cast/display page** for the players.

Version 1 is intentionally simple:
- same machine,
- localhost only,
- front-end only,
- no backend,
- no database.

---

## 2. Main Use Case
A Game Master opens the local website, chooses one of the three rooms, opens the room control screen, then opens the Cast screen on another browser window or display.

The Cast screen first shows the room image.
When the Game Master starts the game, the room image remains visible and a large countdown timer plus a large hint area appear as a visual overlay.

---

## 3. Rooms
The system supports 3 rooms:
- Al Anbar
- Al Haram
- Am Saleh

Each room has:
- display name
- unique room ID
- image asset

---

## 4. Required Pages

### A. Home / Room Selection
Purpose:
- Allow the Game Master to choose one of the 3 rooms.

Requirements:
- 3 prominent room cards
- Clear labels
- Fast and easy interaction
- Clicking a room should move into that room's Game Master context

### B. Game Master Page
Purpose:
- Operate the game for one selected room.

Required controls:
- selected room title
- Start
- Pause
- Resume
- Reset to 60:00
- Add time
- Subtract time
- Hint text input
- Send/update hint button
- Open Cast screen button

Behavior:
- All control actions must update the Cast screen in real time locally.
- Timer logic must be stable and not drift badly.

### C. Cast Page
Purpose:
- Show the in-room display to players.

Before Start:
- show room image
- show Ahaji logo top-left
- no timer visible yet

After Start:
- room image remains visible
- timer appears prominently
- hint box appears prominently
- content should scale well for large display use

---

## 5. Functional Requirements

### Timer
- Default starting time: 60 minutes
- Format: `MM:SS`
- Start begins countdown
- Pause freezes countdown
- Resume continues countdown
- Reset returns to 60:00
- Add/subtract time updates current remaining time
- Countdown should never become visually confusing

### Hints
- Game Master enters a hint in a text field
- Sent hint appears on Cast page
- Hint should be easy to read from distance
- Empty hint handling should be reasonable

### Local Synchronization
Because v1 is local-only and same-device:
- Use `BroadcastChannel` as primary mechanism
- optionally mirror latest state in `localStorage`
- Cast page should recover current state if opened after GM page already changed state

---

## 6. State Behavior
Suggested states:
- `idle` — room chosen, image visible, game not started
- `running` — timer counting down, hint box visible
- `paused` — timer frozen, cast still visible
- `ended` — optional if timer reaches zero

Suggested state payload:
```js
{
  roomId: 'anbar',
  roomName: 'Al Anbar',
  image: 'images/anbar.png',
  status: 'idle',
  durationSeconds: 3600,
  remainingSeconds: 3600,
  hintText: '',
  startedAt: null,
  lastUpdatedAt: Date.now()
}
```

---

## 7. Visual Design Requirements

### Overall Feel
- immersive
- clean
- dark / premium
- not cluttered
- suitable for an actual escape room environment

### Cast Page Composition
- background room image should remain the hero visual
- use dark gradient / glass / overlay only as much as needed for readability
- timer should be big and clear
- hint box should be wide and balanced
- logo stays in top-left

### Important Visual Rule
Do **not** replace the image with the timer.
The timer and hint area must be layered **on top of** the room image in a visually integrated way.

---

## 8. Suggested Layout Direction for Cast Screen
- top-left: Ahaji logo
- center or upper-center: timer
- lower-center or bottom area: hint box
- full-screen room image background
- subtle overlay for contrast

The hint box should:
- be wide
- be responsive
- have good padding
- be readable from distance
- not feel like a cheap alert box

---

## 9. Technical Notes
- HTML / CSS / vanilla JS only
- localhost usage
- no backend or db in v1
- keep code modular by page
- avoid framework setup overhead

---

## 10. Success Criteria
The version is successful if:
1. The user can choose any of the 3 rooms.
2. The GM page opens and controls the selected room.
3. The Cast page can be opened on the same machine.
4. The selected room image appears correctly.
5. Starting the timer keeps the image visible and shows the timer + hint overlay.
6. Timer changes and hints sync correctly between pages.
7. The UI feels clean enough for real operational use.
