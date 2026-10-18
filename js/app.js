// Shared constants and utilities for Ahaji GM System

function generateSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const FULL_AUDIO_TRIM = Object.freeze({ trimStartMs: 0, trimEndMs: null });

const EMPTY_ROOM_MEDIA = Object.freeze({
  hintSound: null,
  hintSoundTrim: FULL_AUDIO_TRIM,
  loseSound: null,
  loseSoundTrim: FULL_AUDIO_TRIM,
  loseVideo: null,
  themeSound: null,
  gmImages: Object.freeze([]),
  gmSounds: Object.freeze([]),
  gmVideos: Object.freeze([])
});

const ROOM_CONFIGS = [];

const DEFAULT_PRESENTATION = Object.freeze({
  timerScale: 1, timerPosition: 'center', timerColor: '#ffffff', timerFont: 'mono',
  hintScale: 1, hintPosition: 'bottom', hintDurationSeconds: 0,
  imageFit: 'contain', videoFit: 'contain',
  winMessage: 'مبروك الفوز', loseMessage: 'كنتم قريبين جداً'
});

function normalizePresentationSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  const choice = (key, allowed) => allowed.includes(source[key]) ? source[key] : DEFAULT_PRESENTATION[key];
  const number = (key, min, max) => Number.isFinite(Number(source[key])) &&
    Number(source[key]) >= min && Number(source[key]) <= max
      ? Number(source[key]) : DEFAULT_PRESENTATION[key];
  const message = key => typeof source[key] === 'string' && source[key].trim() &&
    source[key].length <= 80 ? source[key].trim() : DEFAULT_PRESENTATION[key];
  return {
    timerScale: number('timerScale', .7, 1.3),
    timerPosition: choice('timerPosition', ['top', 'center', 'bottom']),
    timerColor: /^#[\da-fA-F]{6}$/.test(source.timerColor || '') ? source.timerColor : DEFAULT_PRESENTATION.timerColor,
    timerFont: choice('timerFont', ['mono', 'serif']),
    hintScale: number('hintScale', .75, 1.5),
    hintPosition: choice('hintPosition', ['top', 'bottom']),
    hintDurationSeconds: number('hintDurationSeconds', 0, 120),
    imageFit: choice('imageFit', ['contain', 'cover']),
    videoFit: choice('videoFit', ['contain', 'cover']),
    winMessage: message('winMessage'), loseMessage: message('loseMessage')
  };
}

const ROOM_ASSET_URL = 'https://gbhleqizxcmxmutgcjon.supabase.co/storage/v1/object/public/room-assets/';

// Idempotent: normalized rooms already hold resolved URLs, and callers may
// resolve them again, so an already-resolved room-assets URL passes through.
function resolveRoomAsset(ref) {
  if (typeof ref !== 'string') return null;
  if (/^(images|source)\//.test(ref) && !ref.includes('..')) return ref;
  const prefix = ref.startsWith('storage://room-assets/') ? 'storage://room-assets/'
    : ref.startsWith(ROOM_ASSET_URL) ? ROOM_ASSET_URL : null;
  if (prefix) {
    const path = ref.slice(prefix.length);
    if (/^[a-z][a-z0-9_-]{0,63}\/[A-Za-z0-9._-]+$/.test(path)) return ROOM_ASSET_URL + path;
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
    presentation: Object.freeze(normalizePresentationSettings(room.presentation)),
    media: Object.freeze({
      hintSound: resolveRoomAsset(media.hintSound),
      hintSoundTrim: normalizeAudioTrim(media.hintSoundTrim),
      loseSound: resolveRoomAsset(media.loseSound),
      loseSoundTrim: normalizeAudioTrim(media.loseSoundTrim),
      loseVideo: resolveRoomAsset(media.loseVideo),
      themeSound: media.themeSound && resolveRoomAsset(media.themeSound.src)
        ? Object.freeze({ ...normalizeAudioTrim(media.themeSound), src: resolveRoomAsset(media.themeSound.src) })
        : null,
      gmImages: Object.freeze((media.gmImages || []).map(item => Object.freeze({ ...item, src: resolveRoomAsset(item.src) }))),
      gmSounds: Object.freeze((media.gmSounds || []).map(item => Object.freeze({
        ...item, ...normalizeAudioTrim(item), src: resolveRoomAsset(item.src) }))),
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

// Trims are start/end points in milliseconds over the untouched file. A null
// end means "to the end of the file"; anything malformed plays in full.
function normalizeAudioTrim(input) {
  const start = Number(input?.trimStartMs);
  const end = input?.trimEndMs == null ? null : Number(input.trimEndMs);
  const trimStartMs = Number.isInteger(start) && start >= 0 ? start : 0;
  const trimEndMs = Number.isInteger(end) && end > trimStartMs ? end : null;
  return { trimStartMs, trimEndMs };
}

// Plays only the trimmed part of an audio element. With loop, playback wraps
// back to the start point instead of the beginning of the file. Returns a
// function that detaches the trim.
function applyAudioTrim(audio, trim, { loop = false } = {}) {
  const { trimStartMs, trimEndMs } = normalizeAudioTrim(trim);
  const start = trimStartMs / 1000, end = trimEndMs === null ? null : trimEndMs / 1000;
  let timer = null;
  const seekStart = () => { try { audio.currentTime = start; } catch (e) {} };
  const check = () => {
    if (end !== null && audio.currentTime >= end) {
      if (loop) seekStart();
      else { audio.pause(); seekStart(); audio.dispatchEvent(new Event('trimend')); }
    }
  };
  const onPlay = () => { if (timer === null) timer = setInterval(check, 40); };
  const onPause = () => { clearInterval(timer); timer = null; };
  const onEnded = () => { if (loop) { seekStart(); audio.play().catch(() => {}); } };
  audio.loop = false;
  if (audio.readyState >= 1) seekStart();
  else audio.addEventListener('loadedmetadata', seekStart, { once: true });
  audio.addEventListener('play', onPlay);
  audio.addEventListener('pause', onPause);
  audio.addEventListener('ended', onEnded);
  return () => {
    onPause();
    audio.removeEventListener('play', onPlay);
    audio.removeEventListener('pause', onPause);
    audio.removeEventListener('ended', onEnded);
  };
}

// A one-shot sound limited to its trim. Callers can listen for
// 'trimend'/'ended' on the returned element to know when it stopped.
function createTrimmedSound(src, trim, volume = 1) {
  const audio = new Audio(src);
  audio.volume = Math.max(0, Math.min(1, volume));
  applyAudioTrim(audio, trim);
  return audio;
}

// The GM's theme toggle defaults to on whenever the room has a theme, which
// also covers sessions created before the toggle existed.
function isThemeEnabled(state, roomMedia) {
  if (!roomMedia?.themeSound) return false;
  return typeof state?.themeEnabled === 'boolean' ? state.themeEnabled : true;
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

  const presentation = normalizePresentationSettings(state.roomConfig?.presentation);
  const stage = els.timer?.closest('[data-cast-stage]') || document.body;
  stage.dataset.timerPosition = presentation.timerPosition;
  stage.dataset.hintPosition = presentation.hintPosition;
  stage.dataset.imageFit = presentation.imageFit;
  stage.style.setProperty('--cast-timer-scale', String(presentation.timerScale));
  stage.style.setProperty('--cast-hint-scale', String(presentation.hintScale));
  stage.style.setProperty('--cast-timer-color', presentation.timerColor);
  stage.style.setProperty('--cast-video-fit', presentation.videoFit);
  stage.style.setProperty('--cast-timer-font', presentation.timerFont === 'serif'
    ? '"Thmanyah Serif Display", Tahoma, sans-serif' : '"Courier New", "Lucida Console", monospace');

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
      resultMode === 'win'  ? presentation.winMessage :
      resultMode === 'lose' ? (state.loseMode === 'video' ? '\u062c\u0627\u0631\u064a \u0639\u0631\u0636 \u0627\u0644\u0641\u064a\u062f\u064a\u0648' : presentation.loseMessage) :
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

  const hintExpired = typeof state.hintExpiresAt === 'number' &&
    Date.now() + (window.ahajiClockOffset || 0) >= state.hintExpiresAt;
  const hint = state.hintText && !hintExpired ? state.hintText.trim() : '';
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
