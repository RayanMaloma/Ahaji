// Game Master page logic

(function () {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');
  const room = getRoom(roomId);
  const serverMode=Boolean(window.ahajiSupabase && !window.ahajiUseLocalSession);

  if (!roomId || !room) {
    window.location.href = 'index.html';
    return;
  }

  // Each GM page owns its own session. Generate a fresh sessionId if one is
  // not already present in the URL, then stamp it back into the URL so reloads
  // keep the same session (and so the Open Cast link can pass it along).
  let sessionId = params.get('session');
  if (!isValidSessionId(sessionId)) {
    sessionId = generateSessionId();
    params.set('session', sessionId);
    const newUrl = window.location.pathname + '?' + params.toString() + window.location.hash;
    window.history.replaceState({}, '', newUrl);
  }

  let session = createSessionAdapter({ roomId, sessionId });
  let loaded = session.loadSessionState();
  if (loaded.status === 'room-mismatch' || loaded.status === 'invalid') {
    // Never overwrite a different room's session or corrupt saved data.
    session.close();
    sessionId = generateSessionId();
    params.set('session', sessionId);
    window.history.replaceState({}, '', window.location.pathname + '?' + params.toString() + window.location.hash);
    session = createSessionAdapter({ roomId, sessionId });
    loaded = session.loadSessionState();
  }
  let state = loaded.state || createInitialState(roomId, sessionId);

  state.sessionId = sessionId;
  state.image = room.backgroundImage;
  state.roomConfig = room;
  state.activeImageSrc = resolveRoomAsset(state.activeImageSrc);
  state.activeVideoSrc = resolveRoomAsset(state.activeVideoSrc);
  state.activeImageSrc = state.activeImageSrc || null;
  state.activeVideoSrc = state.activeVideoSrc || null;
  state.activeImageScale =
    typeof state.activeImageScale === 'number' ? state.activeImageScale : 100;

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
        const roomMedia = getRoomMedia(roomId);
        if (roomMedia.loseVideo) { state.loseMode = 'video'; } else { delete state.loseMode; }
      }
    }
  }

  document.title = `${state.roomName} - Game Master`;

  let renderIntervalId = null;
  // One-shot latch so the timeout/lose handler only fires once per run.
  let timeoutHandled = state.status === 'ended';
  const HINTS_KEY = 'ahaji-saved-hints-' + roomId;

  let roomHints = []; // hints loaded from the room's .txt file

  async function loadRoomHints() {
    if (Array.isArray(room.hints.items)) {
      roomHints = [...room.hints.items];
      return;
    }
    const file = room.hints.source;
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
  const elImageSizeSlider = document.getElementById('image-size-slider');
  const elImageSizeValue = document.getElementById('image-size-value');
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
  const elPreviewImageOverlay = document.getElementById('gm-preview-image-overlay');
  const elPreviewImageOverlayImg = document.getElementById('gm-preview-image-overlay-img');
  const elMediaDrop = document.getElementById('gm-media-drop');
  const elMediaList = document.getElementById('gm-media-list');
  const elMediaEmpty = document.getElementById('gm-media-empty');
  const elMediaHeader = document.getElementById('gm-media-header');
  let activeMediaType = null;

  elRoomName.textContent = state.roomName;
  elHintInput.value = state.hintText || '';
  render();
  broadcast();

  session.subscribe(message => {
    if (message.type === 'sync-request') session.publishSnapshot(state);
    if (message.type === 'state' && message.authority === 'server') {
      state={...message.state,roomConfig:room};
      state.activeImageSrc=resolveRoomAsset(state.activeImageSrc);
      state.activeVideoSrc=resolveRoomAsset(state.activeVideoSrc);
      timeoutHandled=state.status==='ended';
      if(state.status==='running')startRenderLoop();else stopRenderLoop();
      render();
    }
    if(message.type==='error')alert(message.error?.message||'تعذّر حفظ حالة الجلسة. أعد تحميل الصفحة.');
    if(message.type==='connection'){
      const indicator=document.getElementById('gm-connection');
      if(indicator){indicator.textContent=message.status==='connected'?'متصل':'جارٍ إعادة الاتصال…';
        indicator.classList.toggle('connected',message.status==='connected');}
    }
  });

  if (state.status === 'running') {
    startRenderLoop();
  }

  function broadcast(command,value) {
    const sent=session.saveSessionState(state,command,value);
    if(sent && typeof sent.catch==='function')sent.catch(()=>{});
    return sent;
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
    if (state.viewMode !== 'win') {
      state = setLoseState(state);
      const roomMedia = getRoomMedia(roomId);
      if (roomMedia.loseVideo) { state.loseMode = 'video'; } else { delete state.loseMode; }
    }
    render();
    broadcast('timeout');
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
    if(serverMode && state.status==='ended')return;
    const minutes = parseInt(elTimeAdjValue.value, 10);
    if (isNaN(minutes)) return;

    const deltaMs = minutes * 60 * 1000;

    if (state.status === 'running') {
      const currentMs = Math.max(0, state.endsAt - Date.now());
      const newMs = Math.max(0, Math.min(currentMs + deltaMs, MAX_SECONDS * 1000));
      if (newMs === 0) {
        // The server owns the timer. Record the adjustment first; its next
        // authoritative read settles expiry and publishes the loss state.
        if (serverMode) {
          broadcast('adjust',{delta_seconds:minutes*60});
          return;
        }
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
    broadcast('adjust',{delta_seconds:minutes*60});
  }

  function doStart() {
    if(serverMode && state.status==='ended')return;
    if (state.status !== 'idle' && state.status !== 'ended') return;
    const remainingSecs = typeof state.remainingSeconds === 'number' ? state.remainingSeconds : 0;
    if (remainingSecs <= 0) return;

    state.status = 'running';
    state.endsAt = Date.now() + remainingSecs * 1000;
    timeoutHandled = false;
    startRenderLoop();
    render();
    broadcast('start');
  }

  function doTogglePause() {
    const command=state.status==='running'?'pause':'resume';
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
    broadcast(command);
  }

  function doSendHint() {
    state.hintText = elHintInput.value.trim();
    render();
    broadcast('hint',{text:state.hintText});
    if (state.hintText) {
      session.publishSessionEvent('hint-sound');
    }
    elHintInput.value = '';
  }

  function doClearHint() {
    state.hintText = '';
    render();
    broadcast('hint',{text:''});
  }

  function doClearImage() {
    state.activeImageSrc = null;
    state.activeImageScale = 100;
    render();
    broadcast('image',{media_id:null});
  }

  function doImageSize() {
    const scale = parseInt(elImageSizeSlider.value, 10);
    state.activeImageScale = isNaN(scale) ? 100 : scale;
    render();
    broadcast('scale',{scale:state.activeImageScale});
  }

  function handleWin() {
    if(serverMode && !['running','paused'].includes(state.status))return;
    stopRenderLoop();
    state = freezeRunningTimer(state);
    state.status = 'ended';
    state.viewMode = 'win';
    state.resultState = 'win';
    state.isWin = true;
    state.isLose = false;
    render();
    broadcast('win');
  }

  function handleReset() {
    if(window.ahajiSupabase && !window.ahajiUseLocalSession){
      (async()=>{
        try{
          if(state.status==='running'||state.status==='paused')
            await session.saveSessionState(state,'lose');
          const {data,error}=await window.ahajiSupabase.rpc('create_game_session',{p_room_id:roomId});
          if(error)throw error;
          localStorage.setItem(`ahaji-cast-${roomId}-${data.sessionId}`,data.castToken);
          location.replace(`gm.html?room=${encodeURIComponent(roomId)}&session=${encodeURIComponent(data.sessionId)}`);
        }catch(error){alert(error.message||'تعذّر إنشاء جلسة جديدة.');}
      })();
      return;
    }
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
    const roomMedia = getRoomMedia(roomId);
    const items = type === 'images' ? (roomMedia.gmImages || []) :
                  type === 'sounds' ? (roomMedia.gmSounds || []) :
                  type === 'videos' ? (roomMedia.gmVideos || []) : [];

    elMediaHeader.textContent = {images:'الصور',sounds:'الأصوات',videos:'الفيديوهات'}[type] || '';
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
            state.activeVideoSrc = null;
          }
          render();
          broadcast('image',{media_id:state.activeImageSrc?item.id:null});
          if (isActivatingImage) {
            session.publishSessionEvent('hint-sound');
          }
        });
      }

      if (type === 'videos') {
        if (state.activeVideoSrc === item.src) li.classList.add('selected');
        li.addEventListener('click', () => {
          state.activeVideoSrc = state.activeVideoSrc === item.src ? null : item.src;
          if (state.activeVideoSrc) state.activeImageSrc = null;
          render();broadcast('video',{media_id:state.activeVideoSrc?item.id:null});
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
        playBtn.title = 'تشغيل';
        playBtn.addEventListener('click', () => {
          try { new Audio(item.src).play().catch(() => {}); } catch (e) {}
          session.publishSessionEvent('alert',{type:'gm-sound',media_id:item.id});
        });
        li.appendChild(playBtn);
      }

      elMediaList.appendChild(li);
    });
  }

  function playAlert() {
    const volume = parseFloat(elAlertVolume.value) || 0.5;
    session.publishSessionEvent('alert', { volume });
  }

  function openCastPage() {
    const token=window.ahajiUseLocalSession?'':localStorage.getItem(`ahaji-cast-${roomId}-${sessionId}`);
    if(!window.ahajiUseLocalSession && !token){alert('رابط العرض غير متاح لهذه الجلسة. ابدأ جلسة جديدة.');return;}
    const url = `cast.html?room=${encodeURIComponent(roomId)}&session=${encodeURIComponent(sessionId)}`+
      (token?`&key=${encodeURIComponent(token)}`:'');
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
  elImageSizeSlider.addEventListener('input', doImageSize);
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
    elCurrentImageStatus.textContent = hasImage ? 'الصورة معروضة' : '';

    const scale = typeof state.activeImageScale === 'number' ? state.activeImageScale : 100;
    if (document.activeElement !== elImageSizeSlider) {
      elImageSizeSlider.value = String(scale);
    }
    elImageSizeValue.textContent = scale + '%';

    if (elPreviewImageOverlay && elPreviewImageOverlayImg) {
      if (hasImage) {
        elPreviewImageOverlayImg.src = resolveRoomAsset(state.activeImageSrc) || '';
        elPreviewImageOverlayImg.style.maxWidth = scale + '%';
        elPreviewImageOverlayImg.style.maxHeight = scale + '%';
        elPreviewImageOverlay.style.display = 'flex';
      } else {
        elPreviewImageOverlay.style.display = 'none';
        elPreviewImageOverlayImg.src = '';
      }
    }
    const previewVideo=document.getElementById('gm-preview-video');
    if(previewVideo){
      if(state.activeVideoSrc){
        if(previewVideo.getAttribute('src')!==state.activeVideoSrc){previewVideo.src=resolveRoomAsset(state.activeVideoSrc)||'';previewVideo.play().catch(()=>{});}
        previewVideo.hidden=false;
      }else{previewVideo.hidden=true;previewVideo.pause();previewVideo.removeAttribute('src');}
    }

    if (activeMediaType) {
      renderMediaDrop(activeMediaType);
    }

    renderCastView(state, previewEls);

    const isRunning = state.status === 'running';
    const isPaused = state.status === 'paused';
    const isEnded = state.status === 'ended';
    const isIdle = state.status === 'idle';

    if(serverMode && isEnded){elMediaDrop.classList.remove('visible');activeMediaType=null;}

    btnPause.textContent = isPaused ? 'استئناف' : 'إيقاف مؤقت';
    btnStart.disabled = isRunning || isPaused || (serverMode && isEnded);
    btnPause.disabled = isIdle || isEnded;
    btnWin.disabled = serverMode && (isIdle || isEnded);
    btnAddTime.disabled = serverMode && isEnded;
    btnSubTime.disabled = serverMode && isEnded;
    btnUpdateTime.disabled = isEnded;
    for(const control of [btnSendHint,btnClearHint,btnClearImage,btnShowVideos,
      btnShowImages,btnShowSounds,btnAlert,btnVolume,elImageSizeSlider,elHintInput])
      control.disabled=serverMode && isEnded;
  }
})();
