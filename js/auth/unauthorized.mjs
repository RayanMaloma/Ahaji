import { supabase } from './client.mjs';

if (new URLSearchParams(location.search).get('reason') === 'room') {
  document.getElementById('denial-message').textContent = 'This room is not assigned to your account.';
}
document.getElementById('unauthorized-logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.replace('login.html');
});
