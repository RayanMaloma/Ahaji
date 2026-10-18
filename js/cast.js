// Cast page logic

(function () {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');
  let room = getRoom(roomId);
  const sessionId = params.get('session');

  // Cast must be opened from a specific GM session. Refuse to attach to any
  // channel/state when no sessionId is supplied — otherwise two rooms with
  // the same roomId would silently share the same Cast screen.
  if (!sessionId) {
    showInvalidSession(
      'الجلسة مفقودة',
      'افتح شاشة العرض من صفحة مدير اللعبة.'
    );
    return;
  }
  if (!window.ahajiUseLocalSession && !params.get('key')) {
    showInvalidSession('رابط العرض غير مكتمل','افتح رابط الشاشة من مدير اللعبة.');
    return;
  }
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(roomId || '') || !isValidSessionId(sessionId)) {
    showInvalidSession('رابط جلسة غير صالح', 'تحقّق من رابط الغرفة والجلسة مع مدير اللعبة.');
    return;
  }

  const session = createSessionAdapter({ roomId, sessionId });
  const els = getCastViewElements(document);

  function showInvalidSession(title, message) {
    const existing = document.getElementById('cast-invalid-session');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'cast-invalid-session';
    overlay.style.cssText =
      'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;background:#000;color:#fff;z-index:9999;padding:32px;' +
      'text-align:center;font-family:system-ui,sans-serif;gap:12px;';
    const h = document.createElement('div');
    h.style.cssText = 'font-size:32px;font-weight:700;letter-spacing:0.02em;';
    h.textContent = title;
    const p = document.createElement('div');
    p.style.cssText = 'font-size:18px;opacity:0.75;max-width:520px;line-height:1.5;';
    p.textContent = message;
    overlay.appendChild(h);
    overlay.appendChild(p);
    document.body.appendChild(overlay);
  }

  // Browsers block Audio().play() and AudioContext until the page has received
  // at least one user gesture, so the cast page starts with a blocking unlock screen.
  let audioUnlocked = false;
  let pendingSound = null;
  let sharedAudioContext = window.__CAST_SHARED_AUDIO_CONTEXT__ || null;
  const audioUnlockOverlay = document.getElementById('cast-audio-unlock');

  function syncAudioUnlockUi() {
    if (!audioUnlockOverlay) return;
    audioUnlockOverlay.hidden = audioUnlocked;
  }

  function getAudioContext() {
    if (!sharedAudioContext) {
      sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      window.__CAST_SHARED_AUDIO_CONTEXT__ = sharedAudioContext;
    }
    return sharedAudioContext;
  }

  function finalizeAudioUnlock(source) {
    if (audioUnlocked) return;
    audioUnlocked = true;
    syncAudioUnlockUi();

    if (pendingSound) {
      const fn = pendingSound;
      pendingSound = null;
      fn();
    }
    if (currentState?.activeVideoSrc) document.getElementById('cast-room-video')?.play().catch(()=>{});
    if (currentState) syncTheme(currentState);

    console.info(`[cast] Audio unlocked via ${source}.`);
  }

  // Theme music loops within its trim while the timer runs and the GM has it
  // enabled. Any other sound on Cast ducks it slightly until that sound stops.
  const THEME_VOLUME = 0.7;
  const THEME_DUCKED_VOLUME = 0.3;
  const activeEffects = new Set();
  let themeAudio = null;
  let themeSrc = null;
  let detachThemeTrim = null;
  let fadeTimer = null;

  function videoIsAudible(id) {
    const video = document.getElementById(id);
    return Boolean(video && !video.paused && !video.ended && !video.muted &&
      video.style.display !== 'none' && !video.hidden);
  }

  function effectsPlaying() {
    return activeEffects.size > 0 || videoIsAudible('cast-room-video') || videoIsAudible('cast-lose-video');
  }

  function fadeTheme(target) {
    if (!themeAudio) return;
    clearInterval(fadeTimer);
    fadeTimer = setInterval(() => {
      const step = 0.05;
      const volume = themeAudio ? themeAudio.volume : target;
      if (!themeAudio || Math.abs(volume - target) <= step) {
        if (themeAudio) themeAudio.volume = target;
        clearInterval(fadeTimer);
        fadeTimer = null;
      } else {
        themeAudio.volume = volume + (target > volume ? step : -step);
      }
    }, 25);
  }

  function syncDucking() {
    fadeTheme(effectsPlaying() ? THEME_DUCKED_VOLUME : THEME_VOLUME);
  }

  // Registers a one-shot sound (or a short synthetic beep token) for ducking.
  function trackEffect(effect, maxMs) {
    activeEffects.add(effect);
    syncDucking();
    const done = () => { if (activeEffects.delete(effect)) syncDucking(); };
    if (effect instanceof HTMLMediaElement) {
      for (const type of ['ended', 'pause', 'trimend', 'error']) effect.addEventListener(type, done);
    }
    if (maxMs) setTimeout(done, maxMs);
  }

  for (const id of ['cast-room-video', 'cast-lose-video']) {
    const video = document.getElementById(id);
    for (const type of ['play', 'pause', 'ended', 'volumechange', 'emptied'])
      video?.addEventListener(type, syncDucking);
  }

  function stopTheme() {
    if (!themeAudio) return;
    clearInterval(fadeTimer);
    fadeTimer = null;
    if (detachThemeTrim) detachThemeTrim();
    themeAudio.pause();
    themeAudio.removeAttribute('src');
    themeAudio.load();
    themeAudio = null;
    themeSrc = null;
    detachThemeTrim = null;
  }

  function syncTheme(state) {
    const media = room ? room.media : getRoomMedia(roomId);
    const theme = media.themeSound;
    if (themeAudio && (!theme || theme.src !== themeSrc)) stopTheme();
    const resultShown = state.viewMode === 'win' || state.viewMode === 'lose';
    const shouldPlay = audioUnlocked && theme && isThemeEnabled(state, media) &&
      state.status === 'running' && !resultShown;
    if (!shouldPlay) {
      // Paused or toggled off keeps the position; idle and ended start over.
      if (state.status === 'running' || state.status === 'paused') themeAudio?.pause();
      else stopTheme();
      return;
    }
    if (!themeAudio) {
      themeAudio = new Audio(theme.src);
      themeSrc = theme.src;
      themeAudio.preload = 'auto';
      themeAudio.volume = effectsPlaying() ? THEME_DUCKED_VOLUME : THEME_VOLUME;
      detachThemeTrim = applyAudioTrim(themeAudio, theme, { loop: true });
    }
    if (themeAudio.paused) themeAudio.play().catch(err => console.warn('[cast] Theme blocked:', err));
  }

  function unlockAudio() {
    if (audioUnlocked) return Promise.resolve();

    let resumePromise = Promise.resolve();

    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        resumePromise = ctx.resume();
      }
    } catch (err) {
      console.warn('[cast] AudioContext unlock setup failed:', err);
    }

    return Promise.resolve(resumePromise)
      .catch(err => {
        console.warn('[cast] AudioContext resume failed during unlock:', err);
      })
      .finally(() => {
        finalizeAudioUnlock('cast unlock overlay');
      });
  }

  // --- Fullscreen helpers ---
  const fullscreenBtn = document.getElementById('cast-fullscreen-btn');

  function enterFullscreen() {
    const el = document.documentElement;
    const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (rfs) {
      rfs.call(el).catch(err => console.warn('[cast] Fullscreen request failed:', err));
    }
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  }

  function syncFullscreenBtn() {
    if (!fullscreenBtn) return;
    fullscreenBtn.style.display = isFullscreen() ? 'none' : 'flex';
  }

  document.addEventListener('fullscreenchange', syncFullscreenBtn);
  document.addEventListener('webkitfullscreenchange', syncFullscreenBtn);

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', enterFullscreen);
  }

  syncFullscreenBtn();
  syncAudioUnlockUi();

  if (audioUnlockOverlay) {
    const handleUnlockInteraction = event => {
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      if (event.type === 'keydown') {
        event.preventDefault();
      }

      unlockAudio();
    };

    audioUnlockOverlay.addEventListener('click', handleUnlockInteraction);
    audioUnlockOverlay.addEventListener('keydown', handleUnlockInteraction);
  }

  // Cast keeps its own local copy of the latest state so the tick loop can
  // re-derive the displayed remaining time from endsAt on every frame, even
  // between GM broadcasts (so the clock stays smooth and accurate regardless
  // of GM tab throttling).
  let currentState = null;
  let renderIntervalId = null;

  function stopRenderLoop() {
    if (renderIntervalId !== null) {
      clearInterval(renderIntervalId);
      renderIntervalId = null;
    }
  }

  function startRenderLoop() {
    if (renderIntervalId !== null) return;
    renderIntervalId = setInterval(() => {
      const hintPending = currentState?.hintText && typeof currentState.hintExpiresAt === 'number' &&
        Date.now() + (window.ahajiClockOffset || 0) < currentState.hintExpiresAt;
      if (!currentState || (currentState.status !== 'running' && !hintPending)) {
        stopRenderLoop();
        return;
      }
      renderCastView(currentState, els, { updateDocumentTitle: false });
    }, 250);
  }

  function applyState(nextState) {
    if (!nextState) return;
    if (nextState.roomConfig && nextState.roomConfig.id === roomId) {
      setRoomCatalog([nextState.roomConfig]);
      room = getRoom(roomId);
    }
    const invalidOverlay = document.getElementById('cast-invalid-session');
    if (invalidOverlay) invalidOverlay.remove();
    const previous=currentState;
    currentState = nextState;
    renderCastView(nextState, els, { updateDocumentTitle: true });
    const roomVideo=document.getElementById('cast-room-video');
    if(roomVideo){
      if(nextState.activeVideoSrc){
        const src=resolveRoomAsset(nextState.activeVideoSrc);
        if(src && roomVideo.getAttribute('src')!==src){roomVideo.src=src;roomVideo.play().catch(()=>{});}
        roomVideo.hidden=false;
      }else{roomVideo.hidden=true;roomVideo.pause();roomVideo.removeAttribute('src');}
    }
    syncTheme(nextState);

    if ((nextState.status === 'running' && typeof nextState.endsAt === 'number') ||
        (nextState.hintText && typeof nextState.hintExpiresAt === 'number' &&
        Date.now() + (window.ahajiClockOffset || 0) < nextState.hintExpiresAt)) {
      startRenderLoop();
    } else {
      stopRenderLoop();
    }

    const overlayEl = document.getElementById('cast-image-overlay');
    const imgEl = document.getElementById('cast-image-overlay-img');
    if (!overlayEl || !imgEl) return;

    // The win/lose screen replaces any image the GM left on display.
    const resultShown = nextState.viewMode === 'win' || nextState.viewMode === 'lose';
    if (nextState.activeImageSrc && !resultShown) {
      imgEl.src = resolveRoomAsset(nextState.activeImageSrc) || '';
      const scale =
        typeof nextState.activeImageScale === 'number' ? nextState.activeImageScale : 100;
      imgEl.style.maxWidth = scale + '%';
      imgEl.style.maxHeight = scale + '%';
      overlayEl.style.display = 'flex';
    } else {
      overlayEl.style.display = 'none';
      imgEl.src = '';
    }
    if(nextState.signal && nextState.signal.revision!==previous?.signal?.revision){
      if(nextState.signal.type==='alert')playRoomNotificationSound(nextState.signal.volume);
      if(nextState.signal.type==='hint-sound')playRoomNotificationSound(1);
      if(nextState.signal.type==='gm-sound'){
        const src=resolveRoomAsset(nextState.signal.asset_ref);
        const media=room ? room.media : getRoomMedia(roomId);
        const sound=media.gmSounds.find(item=>item.src===src);
        if(src && audioUnlocked){
          const audio=createTrimmedSound(src,sound,1);
          trackEffect(audio);
          audio.play().catch(()=>{});
        }
      }
    }
    if(nextState.viewMode==='lose' && room?.media?.loseVideo)nextState.loseMode='video';
    if(nextState.viewMode==='lose' && previous?.viewMode!=='lose')triggerLoseMedia();

    // Hide and stop the lose video whenever we're not in an active lose+video state.
    const videoEl = document.getElementById('cast-lose-video');
    if (videoEl && (nextState.viewMode !== 'lose' || nextState.loseMode !== 'video')) {
      videoEl.style.display = 'none';
      if (!videoEl.paused) videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
    }
  }

  function playRoomNotificationSound(volume) {
    if (!audioUnlocked) {
      if (!pendingSound) pendingSound = () => playRoomNotificationSound(volume);
      return;
    }

    const vol = typeof volume === 'number' ? Math.max(0, Math.min(1, volume)) : 1;
    const roomMedia = room ? room.media : getRoomMedia(roomId);

    if (roomMedia.hintSound) {
      try {
        const audio = createTrimmedSound(roomMedia.hintSound, roomMedia.hintSoundTrim, vol);
        trackEffect(audio);
        audio.play().catch(err => console.warn('[cast] Notification sound blocked:', err));
      } catch (err) {
        console.warn('[cast] Notification sound error:', err);
      }
    } else {
      try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
          ctx.resume().catch(err => console.warn('[cast] AudioContext resume failed:', err));
        }

        function beep(startTime, freq, duration) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime(vol * 0.28, startTime + 0.012);
          gain.gain.setValueAtTime(vol * 0.28, startTime + duration - 0.012);
          gain.gain.linearRampToValueAtTime(0, startTime + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + duration);
        }

        beep(ctx.currentTime, 700, 0.14);
        beep(ctx.currentTime + 0.19, 700, 0.14);
        trackEffect({}, 450);
      } catch (err) {
        console.warn('[cast] Beep fallback failed:', err);
      }
    }
  }

  function triggerLoseMedia() {
    if (!audioUnlocked) {
      if (!pendingSound) pendingSound = triggerLoseMedia;
      return;
    }

    const roomMedia = room ? room.media : getRoomMedia(roomId);
    if (roomMedia.loseVideo) {
      const videoEl = document.getElementById('cast-lose-video');
      if (videoEl) {
        videoEl.src = roomMedia.loseVideo;
        videoEl.style.display = 'block';
        videoEl.play().catch(err => console.warn('[cast] Lose video blocked:', err));
      }
    } else if (roomMedia.loseSound) {
      try {
        const audio = createTrimmedSound(roomMedia.loseSound, roomMedia.loseSoundTrim);
        trackEffect(audio);
        audio.play().catch(err => console.warn('[cast] Lose sound blocked:', err));
      } catch (err) {
        console.warn('[cast] Lose sound error:', err);
      }
    }
  }

  session.subscribe(message => {
    if (message.type === 'state') {
      applyState(message.state);
    }
    if (message.type === 'alert') {
      playRoomNotificationSound(message.volume);
    }
    if (message.type === 'hint-sound') {
      playRoomNotificationSound(1);
    }
    if (message.type === 'lose-media') {
      triggerLoseMedia();
    }
    if(message.type==='connection'){
      const status=document.getElementById('cast-connection');
      if(status){status.textContent=message.status==='connected'?'متصل':'جارٍ إعادة الاتصال…';
        status.classList.toggle('offline',message.status!=='connected');}
    }
    if(message.type==='error' && /access denied|expired/i.test(message.error?.message||''))
      showInvalidSession('انتهت صلاحية العرض','اطلب رابطاً جديداً من مدير اللعبة.');
  });

  const loaded = session.loadSessionState();
  if (loaded.state) applyState(loaded.state);
  else showInvalidSession(
    loaded.status === 'room-mismatch' ? 'Invalid session' : 'Session unavailable',
    'Check the link or wait for the Game Master to connect.'
  );
  session.requestSync();
})();
