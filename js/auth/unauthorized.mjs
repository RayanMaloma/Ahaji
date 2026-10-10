import { supabase } from './client.mjs';

if (new URLSearchParams(location.search).get('reason') === 'room') {
  document.getElementById('denial-message').textContent = 'This room is not assigned to your account.';
}
if (new URLSearchParams(location.search).get('reason') === 'admin') {
  document.getElementById('denial-message').textContent = 'The Admin Dashboard requires an active Admin role.';
}
document.getElementById('unauthorized-logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.replace('login.html');
});
