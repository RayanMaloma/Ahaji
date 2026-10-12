// Shared constants and utilities for Ahaji GM System

function generateSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const EMPTY_ROOM_MEDIA = Object.freeze({
  hintSound: null,
  loseSound: null,
  loseVideo: null,
  gmImages: Object.freeze([]),
  gmSounds: Object.freeze([]),
  gmVideos: Object.freeze([])
});

const ROOM_CONFIGS = [];

function resolveRoomAsset(ref) {
  if (typeof ref !== 'string') return null;
  if (/^(images|source)\//.test(ref) && !ref.includes('..')) return ref;
  if (ref.startsWith('storage://room-assets/')) {
    const path = ref.slice('storage://room-assets/'.length);
    if (/^[a-z][a-z0-9_-]{0,63}\/[A-Za-z0-9._-]+$/.test(path))
      return `https://gbhleqizxcmxmutgcjon.supabase.co/storage/v1/object/public/room-assets/${path}`;
  }
  return null;
}

function normalizeRoom(room) {
  const media = room.media || {};
  return Object.freeze({
    id: room.id,
    name: room.name,
    thumbnail: resolveRoomAsset(room.thumbnail),
    backgroundImage: resolveRoomAsset(room.backgroundImage),
    image: resolveRoomAsset(room.backgroundImage),
    defaultDuration: typeof room.defaultDuration === 'number' ? room.defaultDuration : 3600,
    media: Object.freeze({
      hintSound: resolveRoomAsset(media.hintSound),
      loseSound: resolveRoomAsset(media.loseSound),
      loseVideo: resolveRoomAsset(media.loseVideo),
      gmImages: Object.freeze((media.gmImages || []).map(item => Object.freeze({ ...item, src: resolveRoomAsset(item.src) }))),
      gmSounds: Object.freeze((media.gmSounds || []).map(item => Object.freeze({ ...item, src: resolveRoomAsset(item.src) }))),
      gmVideos: Object.freeze((media.gmVideos || []).map(item => Object.freeze({ ...item, src: resolveRoomAsset(item.src) })))
    }),
    hints: Object.freeze({
      items: Object.freeze(Array.isArray(room.hints) ? room.hints.map(item => item.text) : (room.hints?.items || [])),
      source: null
    })
  });
}

let ROOM_LIST = Object.freeze(ROOM_CONFIGS.map(normalizeRoom));

let ROOMS = Object.freeze(ROOM_LIST.reduce((rooms, room) => {
  rooms[room.id] = room;
  return rooms;
}, {}));

function setRoomCatalog(rows) {
  ROOM_LIST = Object.freeze(rows.map(normalizeRoom));
  ROOMS = Object.freeze(ROOM_LIST.reduce((rooms, room) => {
    rooms[room.id] = room;
    return rooms;
  }, {}));
}

function getRooms() {
  return ROOM_LIST;
}

function getRoom(roomId) {
  return Object.hasOwn(ROOMS, roomId) ? ROOMS[roomId] : null;
}

function getRoomMedia(roomId) {
  const room = getRoom(roomId);
  return room ? room.media : EMPTY_ROOM_MEDIA;
}

function formatTime(seconds) {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function createInitialState(roomId, sessionId) {
  const room = getRoom(roomId);
  return {
    sessionId: sessionId,
    roomId: room.id,
    roomName: room.name,
    image: room.backgroundImage,
    viewMode: 'normal',
    status: 'idle',
    remainingSeconds: room.defaultDuration,
    endsAt: null,
    hintText: '',
    activeImageSrc: null,
    activeVideoSrc: null,
    activeImageScale: 100,
    roomConfig: room,
    lastUpdatedAt: Date.now()
  };
}

// Source-of-truth timer helpers. Running timers are expressed as a wall-clock
// endsAt (ms since epoch). Idle/paused/ended timers store remainingSeconds.
// This keeps the timer accurate even when a tab is throttled in the background.
function getRemainingMs(state) {
  if (!state) return 0;
  if (state.status === 'running' && typeof state.endsAt === 'number') {
    return Math.max(0, state.endsAt - (Date.now() + (window.ahajiClockOffset || 0)));
  }
  const secs = typeof state.remainingSeconds === 'number' ? state.remainingSeconds : 0;
  return Math.max(0, secs * 1000);
}

function getDisplaySeconds(state) {
  return Math.ceil(getRemainingMs(state) / 1000);
}

function freezeRunningTimer(state) {
  if (state && state.status === 'running' && typeof state.endsAt === 'number') {
    state.remainingSeconds = Math.max(0, Math.ceil((state.endsAt - (Date.now() + (window.ahajiClockOffset || 0))) / 1000));
    state.endsAt = null;
  }
  return state;
}

function resetGameState(currentState) {
  const initialState = createInitialState(currentState.roomId, currentState.sessionId);
  return {
    ...currentState,
    ...initialState,
    endsAt: null,
    viewMode: 'normal',
    resultState: 'normal',
    isWin: false,
    isLose: false,
    hintText: '',
    activeImageSrc: null,
    activeVideoSrc: null,
    activeImageScale: 100
  };
}

function setLoseState(currentState) {
  return {
    ...currentState,
    viewMode: currentState.viewMode === 'win' ? 'win' : 'lose',
    resultState: currentState.viewMode === 'win' ? 'win' : 'lose',
    isWin: currentState.viewMode === 'win',
    isLose: currentState.viewMode === 'win' ? false : true
  };
}

function getCastViewElements(root = document) {
  return {
    bg: root.querySelector('[data-cast-bg], #cast-bg'),
    overlay: root.querySelector('[data-cast-overlay], #cast-overlay'),
    content: root.querySelector('[data-cast-content], #cast-content'),
    timer: root.querySelector('[data-cast-timer], #cast-timer'),
    hintBox: root.querySelector('[data-cast-hint-box], #cast-hint-box'),
    hintText: root.querySelector('[data-cast-hint-text], #cast-hint-text'),
    idleName: root.querySelector('[data-cast-idle-name], #cast-idle-name'),
    resultScreen: root.querySelector('[data-cast-result-screen], #cast-result-screen'),
    resultKicker: root.querySelector('[data-cast-result-kicker], #cast-result-kicker'),
    resultMessage: root.querySelector('[data-cast-result-message], #cast-result-message'),
    resultMessageAr: root.querySelector('[data-cast-result-message-ar], #cast-result-message-ar'),
    resultMessageEn: root.querySelector('[data-cast-result-message-en], #cast-result-message-en'),
    resultTime: root.querySelector('[data-cast-result-time], #cast-result-time')
  };
}

function renderCastView(state, els, options = {}) {
  if (!state || !els) return;

  const updateDocumentTitle = options.updateDocumentTitle === true;

  if (updateDocumentTitle) {
    document.title = state.roomName ? `${state.roomName} - Cast` : 'Ahaji - Cast';
  }

  const rawResultMode =
    state.viewMode ||
    state.resultState ||
    (state.isWin ? 'win' : state.isLose ? 'lose' : 'normal');
  const resultMode =
    rawResultMode === 'win' || rawResultMode === 'lose' ? rawResultMode : 'normal';

  if (els.bg && state.image) {
    els.bg.src = resolveRoomAsset(state.image) || '';
  }

  const active =
    state.status === 'running' ||
    state.status === 'paused' ||
    state.status === 'ended';

  if (els.overlay) {
    els.overlay.classList.toggle('visible', active || resultMode !== 'normal');
  }

  if (els.content) {
    els.content.classList.toggle('visible', active && resultMode === 'normal');
  }

  if (els.idleName) {
    const idleLabel = els.idleName.querySelector('span') || els.idleName;
    idleLabel.textContent = state.roomName || '';
    els.idleName.style.display = active || resultMode !== 'normal' ? 'none' : 'block';
  }

  if (els.resultScreen) {
    const isResultVisible = resultMode !== 'normal';
    els.resultScreen.classList.toggle('visible', isResultVisible);
    els.resultScreen.classList.toggle('win', resultMode === 'win');
    els.resultScreen.classList.toggle('lose', resultMode === 'lose');
  }

  if (els.resultKicker) {
    els.resultKicker.textContent =
      resultMode === 'win' ? 'الفوز' :
      resultMode === 'lose' ? '' :
      '';
  }

  if (els.resultMessage) {
    els.resultMessage.style.display = resultMode !== 'normal' ? 'grid' : 'none';
  }

  if (els.resultMessageAr) {
    els.resultMessageAr.textContent =
      resultMode === 'win'  ? '\u0645\u0628\u0631\u0648\u0643 \u0627\u0644\u0641\u0648\u0632' :
      resultMode === 'lose' ? (state.loseMode === 'video' ? '\u062c\u0627\u0631\u064a \u0639\u0631\u0636 \u0627\u0644\u0641\u064a\u062f\u064a\u0648' : '\u0643\u0646\u062a\u0645 \u0642\u0631\u064a\u0628\u064a\u0646 \u062c\u062f\u0627\u064b') :
      '';
  }

  if (els.resultMessageEn) {
    els.resultMessageEn.textContent =
      resultMode === 'win'  ? '' :
      resultMode === 'lose' ? '' :
      '';
  }

  if (els.resultTime) {
    if (resultMode === 'win') {
      els.resultTime.textContent = formatTime(getDisplaySeconds(state));
      els.resultTime.style.display = 'block';
    } else {
      els.resultTime.textContent = '';
      els.resultTime.style.display = 'none';
    }
  }

  if (els.timer) {
    els.timer.textContent = formatTime(getDisplaySeconds(state));
    const baseClassName =
      els.timer.dataset.baseClassName ||
      els.timer.className
        .split(/\s+/)
        .filter(Boolean)
        .filter(className => className !== 'running' && className !== 'paused' && className !== 'ended')
        .join(' ');

    if (!els.timer.dataset.baseClassName) {
      els.timer.dataset.baseClassName = baseClassName;
    }

    els.timer.className = `${baseClassName} ${state.status}`.trim();
  }

  const hint = state.hintText ? state.hintText.trim() : '';
  if (els.hintBox && els.hintText) {
    els.hintText.dir = 'auto';
    if (resultMode !== 'normal') {
      els.hintText.textContent = '';
      els.hintText.className = 'cast-hint-text';
      els.hintBox.style.display = 'none';
    } else if (hint) {
      els.hintText.textContent = hint;
      els.hintText.className = 'cast-hint-text';
      els.hintBox.style.display = 'flex';
    } else {
      els.hintText.textContent = '';
      els.hintText.className = 'cast-hint-text';
      els.hintBox.style.display = 'none';
    }
  }
}
