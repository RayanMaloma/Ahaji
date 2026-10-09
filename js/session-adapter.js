// Browser implementation of the Ahaji session transport contract.
// GM owns writes; Cast observes state and publishes sync requests only.
(function () {
  const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
  const EVENT_TYPES = new Set(['alert', 'hint-sound', 'lose-media', 'sync-request']);

  function isValidSessionId(id) {
    return typeof id === 'string' && SESSION_ID_PATTERN.test(id);
  }

  function createSessionAdapter({ roomId, sessionId }) {
    if (!getRoom(roomId) || !isValidSessionId(sessionId)) {
      throw new Error('A known room and valid session ID are required.');
    }

    const stateKey = 'ahaji-state-' + sessionId;
    const channel = new BroadcastChannel('ahaji-session-' + sessionId);
    const listeners = new Set();
    let closed = false;
    let lastSeenRevision = -1;

    function matchesState(state) {
      return state && typeof state === 'object' && !Array.isArray(state) &&
        state.roomId === roomId && state.sessionId === sessionId &&
        ['idle', 'running', 'paused', 'ended'].includes(state.status) &&
        typeof state.remainingSeconds === 'number' &&
        Number.isFinite(state.remainingSeconds) &&
        (state.endsAt === null || (typeof state.endsAt === 'number' && Number.isFinite(state.endsAt))) &&
        typeof state.hintText === 'string';
    }

    function readStored() {
      let raw;
      try {
        raw = localStorage.getItem(stateKey);
        if (raw === null) return { status: 'missing', state: null };
        const state = JSON.parse(raw);
        if (state && (state.roomId !== roomId || state.sessionId !== sessionId)) {
          return { status: 'room-mismatch', state: null };
        }
        return matchesState(state)
          ? { status: 'ok', state }
          : { status: 'invalid', state: null };
      } catch {
        return { status: 'invalid', state: null };
      }
    }

    function revision(state) {
      return Number.isFinite(state.lastUpdatedAt) ? state.lastUpdatedAt : 0;
    }

    function notify(message) {
      listeners.forEach(listener => listener(message));
    }

    function receiveState(state) {
      if (!matchesState(state) || revision(state) <= lastSeenRevision) return;
      lastSeenRevision = revision(state);
      notify({ type: 'state', state });
    }

    function onChannelMessage(event) {
      const message = event.data;
      if (!message || message.roomId !== roomId || message.sessionId !== sessionId) return;
      if (message.type === 'state') receiveState(message.state);
      else if (EVENT_TYPES.has(message.type)) notify(message);
    }

    function onStorage(event) {
      if (event.key !== stateKey || !event.newValue) return;
      try { receiveState(JSON.parse(event.newValue)); } catch { /* Ignore corrupt updates. */ }
    }

    channel.addEventListener('message', onChannelMessage);
    window.addEventListener('storage', onStorage);

    return {
      loadSessionState() {
        const result = readStored();
        if (result.state) lastSeenRevision = Math.max(lastSeenRevision, revision(result.state));
        return result;
      },
      saveSessionState(state) {
        if (closed || !matchesState(state)) throw new Error('Session state identity or shape is invalid.');
        const existing = readStored();
        if (existing.status === 'room-mismatch') {
          throw new Error('Session ID already belongs to another room.');
        }
        state.lastUpdatedAt = Math.max(Date.now(), lastSeenRevision + 1);
        localStorage.setItem(stateKey, JSON.stringify(state));
        lastSeenRevision = state.lastUpdatedAt;
        channel.postMessage({ type: 'state', roomId, sessionId, state });
      },
      // A reconnect response sends the current state without changing its revision.
      publishSnapshot(state) {
        if (closed || !matchesState(state)) return;
        channel.postMessage({ type: 'state', roomId, sessionId, state });
      },
      subscribe(listener) {
        if (closed || typeof listener !== 'function') throw new Error('Cannot subscribe to a closed session.');
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      publishSessionEvent(type, payload = {}) {
        if (closed || !EVENT_TYPES.has(type)) throw new Error('Invalid session event.');
        channel.postMessage({ ...payload, type, roomId, sessionId });
      },
      requestSync() {
        this.publishSessionEvent('sync-request');
      },
      close() {
        if (closed) return;
        closed = true;
        listeners.clear();
        window.removeEventListener('storage', onStorage);
        channel.removeEventListener('message', onChannelMessage);
        channel.close();
      }
    };
  }

  window.isValidSessionId = isValidSessionId;
  window.createSessionAdapter = createSessionAdapter;
})();
