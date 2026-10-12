import { supabase, currentAccess, safeNext } from './client.mjs';
import { createRoomRepository } from '../data/room-repository.mjs';

const page = document.body.dataset.protectedPage;
const loading = document.getElementById('auth-loading');
const failure = document.getElementById('auth-failure');
const panel = document.getElementById('protected-content');

function loginUrl() {
  const next = window.location.pathname.slice(1) + window.location.search;
  return `login.html?next=${encodeURIComponent(safeNext(next))}`;
}

async function checkAccess() {
  try {
    const access = await currentAccess();
    if (!access) {
      window.location.replace(loginUrl());
      return;
    }
    if (!access.role) {
      window.location.replace('unauthorized.html');
      return;
    }
    if (page === 'gm' || page === 'index') {
      const rooms = await createRoomRepository(supabase).listRooms();
      setRoomCatalog(rooms);
      window.ahajiAuthorizedRoomIds = new Set(rooms.map(room => room.id));
      if (page === 'gm') {
        const roomId = new URLSearchParams(window.location.search).get('room');
        if (!roomId) { window.location.replace('index.html'); return; }
        if (!window.ahajiAuthorizedRoomIds.has(roomId)) {
          window.location.replace('unauthorized.html?reason=room'); return;
        }
        if (!window.ahajiUseLocalSession) {
          const params=new URLSearchParams(window.location.search);
          let sessionId=params.get('session');let bootstrap;
          if(sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) {
            const response=await supabase.rpc('get_game_session',
              {p_room_id:roomId,p_session_id:sessionId});
            if(response.error) throw response.error;
            bootstrap=response.data;
          } else {
            const response=await supabase.rpc('create_game_session',{p_room_id:roomId});
            if(response.error) throw response.error;
            bootstrap=response.data;sessionId=bootstrap.sessionId;
            params.set('session',sessionId);
            history.replaceState(null,'',`${location.pathname}?${params}`);
            localStorage.setItem(`ahaji-cast-${roomId}-${sessionId}`,bootstrap.castToken);
          }
          window.ahajiSupabase=supabase;
          window.ahajiSessionBootstrap={...bootstrap,revision:bootstrap.revision||1};
          window.ahajiClockOffset=bootstrap.serverNow-Date.now();
        }
      }
    }
    const roleLabel = document.getElementById('auth-role');
    if (roleLabel) roleLabel.textContent = access.role === 'admin' ? 'مدير' : 'مدير لعبة';
    const emailLabel = document.getElementById('auth-email');
    if (emailLabel) emailLabel.textContent = access.user.email || '';
    const adminLink = document.getElementById('admin-dashboard-link');
    if (adminLink) adminLink.hidden = access.role !== 'admin';
    loading.hidden = true;
    panel.hidden = false;
    if (!window.ahajiPageLoaded) {
      window.ahajiPageLoaded = true;
      await import(page === 'gm' ? '../gm.js?v=full-delivery-3' : page === 'index' ? '../index.js' : './staff.mjs');
    }
  } catch (error) {
    loading.hidden = true;
    failure.hidden = false;
    failure.textContent = 'تعذّر التحقق من صلاحية الدخول. تحقّق من اتصالك وأعد المحاولة.';
    console.error('Access verification failed:', error);
  }
}

document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true;
  await supabase.auth.signOut();
  window.location.replace('login.html');
}));

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') window.location.replace(loginUrl());
  if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') setTimeout(checkAccess, 0);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkAccess();
});
await checkAccess();
