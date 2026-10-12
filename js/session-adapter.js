// Browser implementation of the Ahaji session transport contract.
// GM owns writes; Cast observes state and publishes sync requests only.
(function () {
  const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
  const EVENT_TYPES = new Set(['alert', 'hint-sound', 'lose-media', 'sync-request']);

  function isValidSessionId(id) {
    return typeof id === 'string' && SESSION_ID_PATTERN.test(id);
  }

  function createSessionAdapter({ roomId, sessionId }) {
    if (typeof roomId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(roomId) || !isValidSessionId(sessionId)) {
      throw new Error('A valid room and session ID are required.');
    }

    const stateKey = 'ahaji-state-' + roomId + '-' + sessionId;
    const localMode = window.ahajiUseLocalSession === true;
    const serverClient = !localMode ? window.ahajiSupabase : null;
    const castToken = !localMode ? new URLSearchParams(location.search).get('key') : null;
    if (!localMode && !serverClient && !castToken) throw new Error('Session-scoped access is required.');
    const channel = localMode ? new BroadcastChannel('ahaji-session-' + roomId + '-' + sessionId) : null;
    const listeners = new Set();
    let closed = false;
    let lastSeenRevision = -1;
    let commandQueue=Promise.resolve();
    let pollTimer=null;
    let connected=false;
    let realtimeChannel=null;

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
      return Number.isFinite(state.serverRevision) ? state.serverRevision :
        Number.isFinite(state.lastUpdatedAt) ? state.lastUpdatedAt : 0;
    }

    function notify(message) {
      listeners.forEach(listener => listener(message));
    }

    function receiveState(state,force=false) {
      if (!matchesState(state) || (!force && revision(state) <= lastSeenRevision)) return;
      lastSeenRevision = revision(state);
      notify({ type: 'state', state, authority: Number.isFinite(state.serverRevision)?'server':'local' });
    }

    async function recoverServerState(error){
      notify({type:'error',error});
      if(!serverClient)return;
      const response=await serverClient.rpc('get_game_session',
        {p_room_id:roomId,p_session_id:sessionId});
      if(response.error || !response.data?.state)return;
      window.ahajiClockOffset=response.data.serverNow-Date.now();
      receiveState({...response.data.state,serverRevision:response.data.revision},true);
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

    if(channel){channel.addEventListener('message', onChannelMessage);window.addEventListener('storage', onStorage);}

    async function pollCast(){
      if(closed || !castToken)return;
      try{
        const response=await fetch('https://gbhleqizxcmxmutgcjon.supabase.co/rest/v1/rpc/cast_session_state',{
          method:'POST',headers:{'Content-Type':'application/json',
            apikey:'sb_publishable_ajP_I5ftvfxFlv9MpC7G5Q_uDMjGIDq'},
          body:JSON.stringify({p_room_id:roomId,p_session_id:sessionId,p_token:castToken})});
        if(!response.ok){
          const failure=await response.json().catch(()=>({}));
          const denied=[401,403].includes(response.status)||
            /invalid or expired display access/i.test(failure.message||'');
          const error=new Error(denied?'Display access denied':'Display connection failed');
          if(denied)error.code='ACCESS_DENIED';
          throw error;
        }
        const data=await response.json();
        window.ahajiClockOffset=data.serverNow-Date.now();
        data.state.serverRevision=data.revision;
        receiveState(data.state);
        if(!connected){connected=true;notify({type:'connection',status:'connected'});}
      }catch(error){
        if(error.code==='ACCESS_DENIED' && pollTimer){clearInterval(pollTimer);pollTimer=null;}
        if(connected || error.code==='ACCESS_DENIED'){
          connected=false;notify({type:'connection',status:'disconnected'});
        }
        notify({type:'error',error});
      }
    }
    if(castToken){setTimeout(pollCast,0);pollTimer=setInterval(pollCast,2000);}
    if(serverClient){
      realtimeChannel=serverClient.channel(`gm-session:${roomId}:${sessionId}`)
        .on('postgres_changes',{event:'UPDATE',schema:'public',table:'game_sessions',
          filter:`id=eq.${sessionId}`},async()=>{
          const {data,error}=await serverClient.rpc('get_game_session',
            {p_room_id:roomId,p_session_id:sessionId});
          if(error){notify({type:'error',error});return;}
          window.ahajiClockOffset=data.serverNow-Date.now();
          receiveState({...data.state,serverRevision:data.revision});
        }).subscribe(status=>notify({type:'connection',status:status==='SUBSCRIBED'?'connected':'disconnected'}));
    }

    return {
      loadSessionState() {
        if(serverClient){
          const bootstrap=window.ahajiSessionBootstrap;
          if(!bootstrap?.state || bootstrap.state.roomId!==roomId || bootstrap.state.sessionId!==sessionId)
            return {status:'missing',state:null};
          const initial={...bootstrap.state,serverRevision:bootstrap.revision};
          lastSeenRevision=bootstrap.revision;
          return {status:'ok',state:initial};
        }
        if(castToken)return {status:'missing',state:null};
        const result = readStored();
        if (result.state) lastSeenRevision = Math.max(lastSeenRevision, revision(result.state));
        return result;
      },
      saveSessionState(state,command,value={}) {
        if (closed || !matchesState(state)) throw new Error('Session state identity or shape is invalid.');
        if(serverClient){
          if(!command)return commandQueue;
          const operation=commandQueue.then(async()=>{
            const {data,error}=await serverClient.rpc('game_session_command',{
              p_room_id:roomId,p_session_id:sessionId,p_command:command,p_value:value});
            if(error)throw error;
            window.ahajiClockOffset=data.serverNow-Date.now();
            const authoritative={...data.state,roomConfig:state.roomConfig,serverRevision:data.revision};
            receiveState(authoritative);
          });
          commandQueue=operation.catch(()=>{});
          return operation.catch(async error=>{
            await recoverServerState(error);
            throw error;
          });
        }
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
        if(!channel)return;
        channel.postMessage({ type: 'state', roomId, sessionId, state });
      },
      subscribe(listener) {
        if (closed || typeof listener !== 'function') throw new Error('Cannot subscribe to a closed session.');
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      publishSessionEvent(type, payload = {}) {
        if (closed || !EVENT_TYPES.has(type)) throw new Error('Invalid session event.');
        if(serverClient){
          if(type==='sync-request'||type==='lose-media')return;
          commandQueue=commandQueue.then(async()=>{
            const {data,error}=await serverClient.rpc('game_session_command',{
              p_room_id:roomId,p_session_id:sessionId,p_command:'signal',
              p_value:{type,...payload}});
            if(error)throw error;
            window.ahajiClockOffset=data.serverNow-Date.now();
            receiveState({...data.state,roomConfig:window.ahajiSessionBootstrap?.state?.roomConfig,
              serverRevision:data.revision});
          }).catch(error=>recoverServerState(error));
          return;
        }
        if(!channel)return;
        channel.postMessage({ ...payload, type, roomId, sessionId });
      },
      requestSync() {
        this.publishSessionEvent('sync-request');
      },
      close() {
        if (closed) return;
        closed = true;
        listeners.clear();
        if(pollTimer)clearInterval(pollTimer);
        if(realtimeChannel)serverClient.removeChannel(realtimeChannel);
        if(channel){window.removeEventListener('storage', onStorage);
          channel.removeEventListener('message', onChannelMessage);channel.close();}
      }
    };
  }

  window.isValidSessionId = isValidSessionId;
  window.createSessionAdapter = createSessionAdapter;
})();
