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
  gmSounds: Object.freeze([])
});

const ROOM_CONFIGS = [
  {
    id: 'anbar',
    name: 'Prison',
    thumbnail: 'images/prison.jpg',
    backgroundImage: 'source/prison/background.jpg',
    defaultDuration: 3600,
    media: {
      hintSound: 'source/prison/hint-sound.mp3',
      loseSound: 'source/prison/loose-sound.mp3',
      gmImages: [
        { label: 'مكان فك الزنزانة', src: 'source/prison/images/مكان فك الزنزانة.png' }
      ],
      gmSounds: [
        { label: 'صوت باب العنبر', src: 'source/prison/sounds/صوت باب العنبر.mp3' }
      ]
    },
    hints: {
      source: 'hints/prison.txt'
    }
  },
  {
    id: 'haram',
    name: 'Pyramid',
    thumbnail: 'images/pyramid.png',
    backgroundImage: 'source/pyramid/background.jpg',
    defaultDuration: 3600,
    media: {
      hintSound: 'source/pyramid/hint-sound.mp3',
      gmImages: [
        { label: 'تلميح لغز العصا', src: 'source/pyramid/imghint1.png' },
        { label: 'تلميح لغز الدرج', src: 'source/pyramid/imghint2.png' }
      ]
    },
    hints: {
      source: 'hints/pyramid.txt'
    }
  },
  {
    id: 'saleh',
    name: 'Uncle Saleh',
    thumbnail: 'images/unclesaleh.png',
    backgroundImage: 'source/unclesaleh/background.jpg',
    defaultDuration: 3600,
    media: {
      hintSound: 'source/unclesaleh/hint-sound.mp3',
      loseVideo: 'source/unclesaleh/loose-video.mp4',
      gmImages: [
        { label: 'تلميح لغز التركيبة', src: 'source/unclesaleh/imghint1.png' }
      ]
    },
    hints: {
      source: 'hints/uncle-saleh.txt'
    }
  }
];

function normalizeRoom(room) {
  const media = room.media || {};
  return Object.freeze({
    id: room.id,
    name: room.name,
    thumbnail: room.thumbnail,
    backgroundImage: room.backgroundImage,
    image: room.backgroundImage,
    defaultDuration: typeof room.defaultDuration === 'number' ? room.defaultDuration : 3600,
    media: Object.freeze({
      hintSound: media.hintSound || null,
      loseSound: media.loseSound || null,
      loseVideo: media.loseVideo || null,
      gmImages: Object.freeze((media.gmImages || []).map(item => Object.freeze({ ...item }))),
      gmSounds: Object.freeze((media.gmSounds || []).map(item => Object.freeze({ ...item })))
    }),
    hints: Object.freeze({
      source: room.hints && room.hints.source ? room.hints.source : null
    })
  });
}

const ROOM_LIST = Object.freeze(ROOM_CONFIGS.map(normalizeRoom));

const ROOMS = Object.freeze(ROOM_LIST.reduce((rooms, room) => {
  rooms[room.id] = room;
  return rooms;
}, {}));

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
    activeImageScale: 100,
    lastUpdatedAt: Date.now()
  };
}

// Source-of-truth timer helpers. Running timers are expressed as a wall-clock
// endsAt (ms since epoch). Idle/paused/ended timers store remainingSeconds.
// This keeps the timer accurate even when a tab is throttled in the background.
function getRemainingMs(state) {
  if (!state) return 0;
  if (state.status === 'running' && typeof state.endsAt === 'number') {
    return Math.max(0, state.endsAt - Date.now());
  }
  const secs = typeof state.remainingSeconds === 'number' ? state.remainingSeconds : 0;
  return Math.max(0, secs * 1000);
}

function getDisplaySeconds(state) {
  return Math.ceil(getRemainingMs(state) / 1000);
}

function freezeRunningTimer(state) {
  if (state && state.status === 'running' && typeof state.endsAt === 'number') {
    state.remainingSeconds = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
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
    els.bg.src = state.image;
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
      resultMode === 'win' ? 'Victory' :
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
      resultMode === 'win'  ? 'Winners!' :
      resultMode === 'lose' ? (state.loseMode === 'video' ? 'Playing video' : 'Game Over') :
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
