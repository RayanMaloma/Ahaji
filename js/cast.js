// Cast page logic

(function () {
  const bootstrap = window.__CAST_BOOTSTRAP__ || null;
  const roomId =
    (bootstrap && bootstrap.roomId) ||
    new URLSearchParams(window.location.search).get('room') ||
    'default';
  const channel = new BroadcastChannel(getChannelName(roomId));
  const els = getCastViewElements(document);

  // Browsers block Audio().play() and AudioContext until the page has received
  // at least one user gesture. The popup bootstrap uses the GM click first.
  let audioUnlocked = false;
  let pendingSound = null;   // stores the first sound that arrived before unlock
  let sharedAudioContext = window.__CAST_SHARED_AUDIO_CONTEXT__ || null;

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

    if (pendingSound) {
      const fn = pendingSound;
      pendingSound = null;
      fn();
    }

    console.info(`[cast] Audio unlocked via ${source}.`);
  }

  function applyBootstrapPrimeState() {
    const primeState = window.__CAST_BOOTSTRAP__;

    if (!primeState) return;

    if (primeState.audioPrimed) {
      finalizeAudioUnlock('GM popup open gesture');
      return;
    }

    if (primeState.audioPrimeAttempted && primeState.audioPrimeFailed) {
      console.warn(
        '[cast] Popup audio priming did not complete.',
        primeState.audioPrimeError || ''
      );
    }
  }

  window.addEventListener('cast-audio-prime-result', applyBootstrapPrimeState);
  applyBootstrapPrimeState();

  function applyState(nextState) {
    if (!nextState) return;
    renderCastView(nextState, els, { updateDocumentTitle: true });

    const overlayEl = document.getElementById('cast-image-overlay');
    const imgEl = document.getElementById('cast-image-overlay-img');
    if (!overlayEl || !imgEl) return;

    if (nextState.activeImageSrc) {
      imgEl.src = nextState.activeImageSrc;
      overlayEl.style.display = 'flex';
    } else {
      overlayEl.style.display = 'none';
      imgEl.src = '';
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
