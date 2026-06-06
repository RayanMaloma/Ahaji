// Game Master page logic

(function () {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');

  if (!roomId || !ROOMS[roomId]) {
    window.location.href = 'index.html';
    return;
  }

  // Each GM page owns its own session. Generate a fresh sessionId if one is
  // not already present in the URL, then stamp it back into the URL so reloads
  // keep the same session (and so the Open Cast link can pass it along).
  let sessionId = params.get('session');
  if (!sessionId) {
    sessionId = generateSessionId();
    params.set('session', sessionId);
    const newUrl = window.location.pathname + '?' + params.toString() + window.location.hash;
    window.history.replaceState({}, '', newUrl);
  }

  const channel = new BroadcastChannel(getChannelName(sessionId));
  let state = loadState(sessionId);

  if (!state || state.roomId !== roomId || state.sessionId !== sessionId) {
    state = createInitialState(roomId, sessionId);
  }

  state.sessionId = sessionId;
  state.image = ROOMS[roomId].image;
  state.activeImageSrc = state.activeImageSrc || null;

  // Recover any timer that was running when the page was last open. endsAt is
  // a wall-clock timestamp so we can compute the real remaining time even after
  // a reload or long period of tab throttling.
  if (state.status === 'running') {
    if (typeof state.endsAt !== 'number') {
      // Legacy persisted state without endsAt — fall back to paused to avoid
      // silently losing time.
      state.status = 'paused';
    } else if (state.endsAt <= Date.now()) {
      state.remainingSeconds = 0;
      state.endsAt = null;
      state.status = 'ended';
      if (state.viewMode !== 'win') {
        state = setLoseState(state);
        const roomMedia = (ROOMS[roomId] && ROOMS[roomId].media) || {};
        if (roomMedia.loseVideo) { state.loseMode = 'video'; } else { delete state.loseMode; }
      }
    }
  }

  saveState(state);
  document.title = `${state.roomName} - Game Master`;

  let renderIntervalId = null;
  // One-shot latch so the timeout/lose handler only fires once per run.
  let timeoutHandled = state.status === 'ended';
  const HINTS_KEY = 'ahaji-saved-hints-' + roomId;

  const HINTS_FILE = {
    anbar: 'hints/prison.txt',
    haram:  'hints/pyramid.txt',
    saleh:  'hints/uncle-saleh.txt',
  };

  let roomHints = []; // hints loaded from the room's .txt file

  async function loadRoomHints() {
    const file = HINTS_FILE[roomId];
    if (!file) return;
    try {
      const res = await fetch(file);
      if (!res.ok) return;
      const text = await res.text();
      roomHints = text.split('\n').map(l => l.trim()).filter(Boolean);
    } catch {
      roomHints = [];
    }
  }

  loadRoomHints();

  const elRoomName = document.getElementById('gm-room-name');
  const elTimerDisp = document.getElementById('gm-timer-display');
  const elHintInput = document.getElementById('hint-input');
  const elCurrentHintBlock = document.getElementById('gm-current-hint-block');
  const elCurrentHintDisplay = document.getElementById('gm-current-hint-display');
  const elCurrentImageBlock = document.getElementById('gm-current-image-block');
  const elCurrentImageStatus = document.getElementById('gm-current-image-status');
  const btnClearHint = document.getElementById('btn-clear-hint');
  const btnClearImage = document.getElementById('btn-clear-image');
  const elTimeAdjValue = document.getElementById('time-adj-value');
  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnWin = document.getElementById('btn-win');
  const btnReset = document.getElementById('btn-reset');
  const btnAddTime = document.getElementById('btn-add-time');
  const btnSubTime = document.getElementById('btn-sub-time');
  const btnUpdateTime = document.getElementById('btn-update-time');
  const btnShowHints = document.getElementById('btn-show-hints');
  const btnShowVideos = document.getElementById('btn-show-videos');
  const btnShowImages = document.getElementById('btn-show-images');
  const btnShowSounds = document.getElementById('btn-show-sounds');
  const btnSendHint = document.getElementById('btn-send-hint');
  const btnOpenCast = document.getElementById('btn-open-cast');
  const btnAlert = document.getElementById('btn-alert');
  const btnVolume = document.getElementById('btn-volume');
  const elVolumeCtrl = document.getElementById('gm-volume-ctrl');
  const elVolumePopover = document.getElementById('gm-volume-popover');
  const elAlertVolume = document.getElementById('alert-volume');
  const elSavedDrop = document.getElementById('saved-hints-drop');
  const elSavedList = document.getElementById('saved-hints-list');
  const elSavedEmpty = document.getElementById('saved-hints-empty');
  const previewEls = getCastViewElements(document.getElementById('gm-cast-preview'));
  const elMediaDrop = document.getElementById('gm-media-drop');
  const elMediaList = document.getElementById('gm-media-list');
  const elMediaEmpty = document.getElementById('gm-media-empty');
  const elMediaHeader = document.getElementById('gm-media-header');
  let activeMediaType = null;

  elRoomName.textContent = state.roomName;
  elHintInput.value = state.hintText || '';
  render();
  broadcast();

  if (state.status === 'running') {
    startRenderLoop();
  }

  function broadcast() {
    saveState(state);
    channel.postMessage({ type: 'state', state });
  }

  function emitLoseMediaIfNeeded() {
    const roomMedia = (ROOMS[roomId] && ROOMS[roomId].media) || {};
    if (roomMedia.loseSound || roomMedia.loseVideo) {
      channel.postMessage({ type: 'lose-media' });
    }
  }

  function stopRenderLoop() {
    if (renderIntervalId !== null) {
      clearInterval(renderIntervalId);
      renderIntervalId = null;
    }
  }

  // UI-only render loop. The source of truth for elapsed time is state.endsAt
  // (wall-clock), so even if this interval is throttled while the tab is in the
  // background, the timer stays accurate — the next render just reads the real
  // remaining time from Date.now() and endsAt.
  function startRenderLoop() {
    stopRenderLoop();
    renderIntervalId = setInterval(tick, 250);
  }

  function tick() {
    if (state.status !== 'running') {
      stopRenderLoop();
      return;
    }
    if (getRemainingMs(state) <= 0) {
      handleTimeout();
      return;
    }
    render();
  }

  function handleTimeout() {
    if (timeoutHandled) {
      stopRenderLoop();
      return;
    }
    timeoutHandled = true;
    stopRenderLoop();
    state.remainingSeconds = 0;
    state.endsAt = null;
    state.status = 'ended';
    let shouldEmitLose = false;
    if (state.viewMode !== 'win') {
      state = setLoseState(state);
      const roomMedia = (ROOMS[roomId] && ROOMS[roomId].media) || {};
      if (roomMedia.loseVideo) { state.loseMode = 'video'; } else { delete state.loseMode; }
      shouldEmitLose = true;
    }
    render();
    broadcast();
    if (shouldEmitLose) emitLoseMediaIfNeeded();
  }

  function doAddCounter() {
    const value = parseInt(elTimeAdjValue.value, 10) || 0;
    elTimeAdjValue.value = value + 1;
  }

  function doSubCounter() {
    const value = parseInt(elTimeAdjValue.value, 10) || 0;
    elTimeAdjValue.value = value - 1;
  }

  const MAX_SECONDS = 5999;

  function doUpdateTimer() {
    const minutes = parseInt(elTimeAdjValue.value, 10);
    if (isNaN(minutes)) return;

    const deltaMs = minutes * 60 * 1000;

    if (state.status === 'running') {
      const currentMs = Math.max(0, state.endsAt - Date.now());
      const newMs = Math.max(0, Math.min(currentMs + deltaMs, MAX_SECONDS * 1000));
      if (newMs === 0) {
        state.endsAt = Date.now();
        handleTimeout();
        return;
      }
      state.endsAt = Date.now() + newMs;
    } else {
      const currentSecs = typeof state.remainingSeconds === 'number' ? state.remainingSeconds : 0;
      const newSecs = Math.max(0, Math.min(currentSecs + minutes * 60, MAX_SECONDS));
      state.remainingSeconds = newSecs;
      if (state.status === 'ended' && newSecs > 0) {
        state.status = 'paused';
        timeoutHandled = false;
        state.viewMode = 'normal';
        state.resultState = 'normal';
        state.isWin = false;
        state.isLose = false;
        delete state.loseMode;
      }
    }
    render();
    broadcast();
  }

  function doStart() {
    if (state.status !== 'idle' && state.status !== 'ended') return;
    const remainingSecs = typeof state.remainingSeconds === 'number' ? state.remainingSeconds : 0;
    if (remainingSecs <= 0) return;

    state.status = 'running';
    state.endsAt = Date.now() + remainingSecs * 1000;
    timeoutHandled = false;
    startRenderLoop();
    render();
    broadcast();
  }

  function doTogglePause() {
    if (state.status === 'running') {
      state = freezeRunningTimer(state);
      state.status = 'paused';
      stopRenderLoop();
    } else if (state.status === 'paused') {
      const remainingSecs = typeof state.remainingSeconds === 'number' ? state.remainingSeconds : 0;
      if (remainingSecs <= 0) return;
      state.endsAt = Date.now() + remainingSecs * 1000;
      state.status = 'running';
      timeoutHandled = false;
      startRenderLoop();
    }

    render();
    broadcast();
  }

  function doSendHint() {
    state.hintText = elHintInput.value.trim();
    render();
    broadcast();
    if (state.hintText) {
      channel.postMessage({ type: 'hint-sound' });
    }
    elHintInput.value = '';
  }

  function doClearHint() {
    state.hintText = '';
    render();
    broadcast();
  }

  function doClearImage() {
    state.activeImageSrc = null;
    render();
    broadcast();
  }

  function handleWin() {
    stopRenderLoop();
    state = freezeRunningTimer(state);
    state.status = 'paused';
    state.viewMode = 'win';
    state.resultState = 'win';
    state.isWin = true;
    state.isLose = false;
    render();
    broadcast();
  }

  function handleReset() {
    stopRenderLoop();
    state = resetGameState(state);
    timeoutHandled = false;
    render();
    broadcast();
  }

  function handleMediaOption(type) {
    if (activeMediaType === type) {
      elMediaDrop.classList.remove('visible');
      activeMediaType = null;
      return;
    }
    activeMediaType = type;
    renderMediaDrop(type);
    elMediaDrop.classList.add('visible');
  }

  function renderMediaDrop(type) {
    const roomMedia = (ROOMS[roomId] && ROOMS[roomId].media) || {};
    const items = type === 'images' ? (roomMedia.gmImages || []) :
                  type === 'sounds' ? (roomMedia.gmSounds || []) : [];

    elMediaHeader.textContent = type.charAt(0).toUpperCase() + type.slice(1);
    elMediaList.innerHTML = '';
    elMediaEmpty.style.display = items.length === 0 ? 'block' : 'none';

    items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'gm-media-item';

      if (type === 'images') {
        const thumb = document.createElement('img');
        thumb.className = 'gm-media-thumb';
        thumb.src = item.src;
        thumb.alt = item.label;
        li.appendChild(thumb);
        if (state.activeImageSrc === item.src) li.classList.add('selected');
        li.addEventListener('click', () => {
          const isActivatingImage = state.activeImageSrc !== item.src;
          if (state.activeImageSrc === item.src) {
            state.activeImageSrc = null;
          } else {
            state.activeImageSrc = item.src;
          }
          render();
          broadcast();
          if (isActivatingImage) {
            channel.postMessage({ type: 'hint-sound' });
          }
        });
      }

      const label = document.createElement('span');
      label.className = 'gm-media-label';
      label.textContent = item.label;
      li.appendChild(label);

      if (type === 'sounds') {
        const playBtn = document.createElement('button');
        playBtn.className = 'gm-media-play-btn';
        playBtn.textContent = '▶';
        playBtn.title = 'Play';
        playBtn.addEventListener('click', () => {
          try { new Audio(item.src).play().catch(() => {}); } catch (e) {}
        });
        li.appendChild(playBtn);
      }

      elMediaList.appendChild(li);
    });
  }

  function playAlert() {
    const volume = parseFloat(elAlertVolume.value) || 0.5;
    channel.postMessage({ type: 'alert', volume });
  }

  function openCastPage() {
    const url = `cast.html?room=${encodeURIComponent(roomId)}&session=${encodeURIComponent(sessionId)}`;
    window.open(url, '_blank');
  }

  function loadSavedHints() {
    try {
      return JSON.parse(localStorage.getItem(HINTS_KEY)) || [];
    } catch {
      return [];
    }
  }

  function persistSavedHints(hints) {
    localStorage.setItem(HINTS_KEY, JSON.stringify(hints));
  }

  function toggleSavedDrop() {
    const isOpen = elSavedDrop.classList.contains('visible');
    if (isOpen) {
      elSavedDrop.classList.remove('visible');
    } else {
      renderSavedDrop();
      elSavedDrop.classList.add('visible');
    }
  }

  function renderSavedDrop() {
    const saved = loadSavedHints();
    elSavedList.innerHTML = '';

    const allEmpty = roomHints.length === 0 && saved.length === 0;
    elSavedEmpty.style.display = allEmpty ? 'block' : 'none';
    if (allEmpty) return;

    // Room hints from .txt file — click to use, no delete
    roomHints.forEach(hint => {
      const li = document.createElement('li');
      li.className = 'saved-hint-item saved-hint-room';

      const textSpan = document.createElement('span');
      textSpan.className = 'saved-hint-text';
      textSpan.textContent = hint;
      textSpan.addEventListener('click', () => {
        elHintInput.value = hint;
        elSavedDrop.classList.remove('visible');
      });

      li.appendChild(textSpan);
      elSavedList.appendChild(li);
    });

    // Manually saved hints — click to use, × to delete
    saved.forEach((hint, index) => {
      const li = document.createElement('li');
      li.className = 'saved-hint-item';

      const textSpan = document.createElement('span');
      textSpan.className = 'saved-hint-text';
      textSpan.textContent = hint;
      textSpan.addEventListener('click', () => {
        elHintInput.value = hint;
        elSavedDrop.classList.remove('visible');
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'saved-hint-del';
      delBtn.textContent = '×';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', event => {
        event.stopPropagation();
        const updated = loadSavedHints().filter((_, idx) => idx !== index);
        persistSavedHints(updated);
        renderSavedDrop();
      });

      li.appendChild(textSpan);
      li.appendChild(delBtn);
      elSavedList.appendChild(li);
    });
  }

  function toggleVolumePopover(event) {
    event.stopPropagation();
    const isOpen = !elVolumePopover.hidden;
    elVolumePopover.hidden = isOpen;
    btnVolume.classList.toggle('is-open', !isOpen);
  }

  document.addEventListener('click', event => {
    if (!elSavedDrop.contains(event.target) && event.target !== btnShowHints) {
      elSavedDrop.classList.remove('visible');
    }
    if (!elVolumeCtrl.contains(event.target)) {
      elVolumePopover.hidden = true;
      btnVolume.classList.remove('is-open');
    }
    const mediaButtons = [btnShowImages, btnShowSounds, btnShowVideos];
    if (!elMediaDrop.contains(event.target) && !mediaButtons.includes(event.target)) {
      elMediaDrop.classList.remove('visible');
      activeMediaType = null;
    }
  });

  btnStart.addEventListener('click', doStart);
  btnPause.addEventListener('click', doTogglePause);
  btnWin.addEventListener('click', handleWin);
  btnReset.addEventListener('click', handleReset);
  btnAddTime.addEventListener('click', doAddCounter);
  btnSubTime.addEventListener('click', doSubCounter);
  btnUpdateTime.addEventListener('click', doUpdateTimer);
  btnShowHints.addEventListener('click', event => {
    event.stopPropagation();
    toggleSavedDrop();
  });
  btnShowVideos.addEventListener('click', () => handleMediaOption('videos'));
  btnShowImages.addEventListener('click', () => handleMediaOption('images'));
  btnShowSounds.addEventListener('click', () => handleMediaOption('sounds'));
  btnSendHint.addEventListener('click', doSendHint);
  btnClearHint.addEventListener('click', doClearHint);
  btnClearImage.addEventListener('click', doClearImage);
  btnAlert.addEventListener('click', playAlert);
  btnVolume.addEventListener('click', toggleVolumePopover);
  btnOpenCast.addEventListener('click', openCastPage);

  elHintInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      doSendHint();
    }
  });

  function render() {
    elTimerDisp.textContent = formatTime(getDisplaySeconds(state));
    elTimerDisp.className = 'gm-timer-display ' + state.status;

    const hasHint = Boolean(state.hintText && state.hintText.trim());
    elCurrentHintBlock.style.display = hasHint ? 'flex' : 'none';
    elCurrentHintDisplay.textContent = hasHint ? state.hintText.trim() : '';

    const hasImage = Boolean(state.activeImageSrc);
    elCurrentImageBlock.style.display = hasImage ? 'flex' : 'none';
    elCurrentImageStatus.textContent = hasImage ? 'Image displayed' : '';

    if (activeMediaType) {
      renderMediaDrop(activeMediaType);
    }

    renderCastView(state, previewEls);

    const isRunning = state.status === 'running';
    const isPaused = state.status === 'paused';
    const isEnded = state.status === 'ended';
    const isIdle = state.status === 'idle';

    btnPause.textContent = isPaused ? 'Resume' : 'Pause';
    btnStart.disabled = isRunning || isPaused;
    btnPause.disabled = isIdle || isEnded;
    btnAddTime.disabled = false;
    btnSubTime.disabled = false;
    btnUpdateTime.disabled = isEnded;
  }
})();
