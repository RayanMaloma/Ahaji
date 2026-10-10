import { supabase, currentAccess, safeNext } from './client.mjs';

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
    if (page === 'gm') {
      const roomId = new URLSearchParams(window.location.search).get('room');
      if (!roomId) { window.location.replace('index.html'); return; }
      const { data, error } = await supabase.from('rooms').select('id').eq('id', roomId).maybeSingle();
      if (error) throw error;
      if (!data) { window.location.replace('unauthorized.html?reason=room'); return; }
    }
    if (page === 'index') {
      const { data, error } = await supabase.from('rooms').select('id').order('display_order');
      if (error) throw error;
      window.ahajiAuthorizedRoomIds = new Set((data || []).map(room => room.id));
    }
    const roleLabel = document.getElementById('auth-role');
    if (roleLabel) roleLabel.textContent = page === 'staff' ? (access.role === 'admin' ? 'مدير' : 'مدير لعبة') : (access.role === 'admin' ? 'Admin' : 'Game Master');
    const emailLabel = document.getElementById('auth-email');
    if (emailLabel) emailLabel.textContent = access.user.email || '';
    const adminLink = document.getElementById('admin-dashboard-link');
    if (adminLink) adminLink.hidden = access.role !== 'admin';
    loading.hidden = true;
    panel.hidden = false;
    if (!window.ahajiPageLoaded) {
      window.ahajiPageLoaded = true;
      await import(page === 'gm' ? '../gm.js' : page === 'index' ? '../index.js' : './staff.mjs');
    }
  } catch (error) {
    loading.hidden = true;
    failure.hidden = false;
    failure.textContent = page === 'staff' ? 'تعذّر التحقق من صلاحية الدخول. تحقّق من اتصالك وأعد المحاولة.' : 'Could not verify access. Check your connection and retry.';
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
