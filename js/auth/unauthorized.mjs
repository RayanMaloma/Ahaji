import { supabase } from './client.mjs';

if (new URLSearchParams(location.search).get('reason') === 'room') {
  document.getElementById('denial-message').textContent = 'هذه الغرفة غير معيّنة لحسابك.';
}
if (new URLSearchParams(location.search).get('reason') === 'admin') {
  document.getElementById('denial-message').textContent = 'تتطلب لوحة الإدارة صلاحية مدير نشطة.';
}
document.getElementById('unauthorized-logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.replace('login.html');
});
