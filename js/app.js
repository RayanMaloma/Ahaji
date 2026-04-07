// Shared constants and utilities for Ahaji GM System

function getChannelName(roomId) {
  return 'ahaji-room-' + (roomId || 'default');
}

function getStateKey(roomId) {
  return 'ahaji-state-' + (roomId || 'default');
}

const ROOMS = {
  anbar: {
    id: 'anbar', name: 'Prison', image: 'images/prison.jpg',
    media: {
      hintSound: 'source/prison/hint-sound.mp3',
      loseSound: 'source/prison/loose-sound.mp3',
      gmImages: [
        { label: 'مكان فك الزنزانة', src: 'source/prison/images/مكان فك الزنزانة.jpg' }
      ],
      gmSounds: [
        { label: 'صوت باب العنبر', src: 'source/prison/sounds/صوت باب العنبر.mp3' }
      ]
    }
  },
  haram: {
    id: 'haram', name: 'Pyramid', image: 'images/pyramid.png',
    media: {
      hintSound: 'source/pyramid/hint-sound.mp3'
    }
  },
  saleh: {
    id: 'saleh', name: 'Uncle Saleh', image: 'images/unclesaleh.png',
    media: {
      hintSound: 'source/unclesaleh/hint-sound.mp3',
      loseVideo: 'source/unclesaleh/loose-video.mp4'
    }
  }
};

function formatTime(seconds) {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function saveState(state, roomId) {
  state.lastUpdatedAt = Date.now();
  localStorage.setItem(getStateKey(roomId || state.roomId), JSON.stringify(state));
}

function loadState(roomId) {
  try {
    const raw = localStorage.getItem(getStateKey(roomId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function createInitialState(roomId) {
  const room = ROOMS[roomId];
  return {
    roomId: room.id,
    roomName: room.name,
    image: room.image,
    viewMode: 'normal',
    status: 'idle',
    remainingSeconds: 3600,
    hintText: '',
    activeImageSrc: null,
    lastUpdatedAt: Date.now()
  };
}

function resetGameState(currentState) {
  const initialState = createInitialState(currentState.roomId);
  const reset = {
    ...currentState,
    ...initialState,
    viewMode: 'normal',
    resultState: 'normal',
    isWin: false,
    isLose: false,
    hintText: '',
    activeImageSrc: null
  };
  delete reset.loseMode;
  return reset;
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
      els.resultTime.textContent = formatTime(state.remainingSeconds);
      els.resultTime.style.display = 'block';
    } else {
      els.resultTime.textContent = '';
      els.resultTime.style.display = 'none';
    }
  }

  if (els.timer) {
    els.timer.textContent = formatTime(state.remainingSeconds);
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
