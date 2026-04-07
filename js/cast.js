// Cast page logic

(function () {
  const roomId = new URLSearchParams(window.location.search).get('room') || 'default';
  const channel = new BroadcastChannel(getChannelName(roomId));
  const els = getCastViewElements(document);

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

    console.info(`[cast] Audio unlocked via ${source}.`);
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

  function applyState(nextState) {
    if (!nextState) return;
    renderCastView(nextState, els, { updateDocumentTitle: true });

    const overlayEl = document.getElementById('cast-image-overlay');
    const imgEl = document.getElementById('cast-image-overlay-img');
    if (overlayEl && imgEl) {
      if (nextState.activeImageSrc) {
        imgEl.src = nextState.activeImageSrc;
        overlayEl.style.display = 'block';
      } else {
        overlayEl.style.display = 'none';
        imgEl.src = '';
      }
    }

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
    const roomMedia = (ROOMS[roomId] && ROOMS[roomId].media) || {};

    if (roomMedia.hintSound) {
      try {
        const audio = new Audio(roomMedia.hintSound);
        audio.volume = vol;
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

    const roomMedia = (ROOMS[roomId] && ROOMS[roomId].media) || {};
    if (roomMedia.loseVideo) {
      const videoEl = document.getElementById('cast-lose-video');
      if (videoEl) {
        videoEl.src = roomMedia.loseVideo;
        videoEl.style.display = 'block';
        videoEl.play().catch(err => console.warn('[cast] Lose video blocked:', err));
      }
    } else if (roomMedia.loseSound) {
      try {
        const audio = new Audio(roomMedia.loseSound);
        audio.play().catch(err => console.warn('[cast] Lose sound blocked:', err));
      } catch (err) {
        console.warn('[cast] Lose sound error:', err);
      }
    }
  }

  const state = loadState(roomId);
  if (state) {
    applyState(state);
  }

  channel.addEventListener('message', event => {
    if (!event.data) return;
    if (event.data.type === 'state') {
      applyState(event.data.state);
    }
    if (event.data.type === 'alert') {
      playRoomNotificationSound(event.data.volume);
    }
    if (event.data.type === 'hint-sound') {
      playRoomNotificationSound(1);
    }
    if (event.data.type === 'lose-media') {
      triggerLoseMedia();
    }
  });

  const stateKey = getStateKey(roomId);
  window.addEventListener('storage', event => {
    if (event.key === stateKey && event.newValue) {
      try {
        applyState(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed persisted state updates.
      }
    }
  });
})();
