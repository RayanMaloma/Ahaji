import { supabase } from './client.mjs';

const requestForm = document.getElementById('request-form');
const updateForm = document.getElementById('update-form');
const intro = document.getElementById('recovery-intro');
const message = document.getElementById('recovery-message');

function show(messageText, error = false) {
  message.textContent = messageText;
  message.classList.toggle('auth-error', error);
  message.hidden = false;
}
function enableUpdate() {
  requestForm.hidden = true;
  updateForm.hidden = false;
  intro.textContent = 'Choose a new password for your staff account.';
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') enableUpdate();
});
if (new URLSearchParams(location.search).has('setup')) {
  enableUpdate();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    updateForm.hidden = true;
    show('This setup link has expired. Request a fresh link.', true);
  }
}

requestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('request-submit');
  button.disabled = true;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(document.getElementById('email').value.trim());
    if (error) throw error;
    show('If this email belongs to a staff account, a reset link has been sent. Check your inbox.');
  } catch {
    show('The reset request could not be sent. Please try again later.', true);
  } finally { button.disabled = false; }
});

updateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('update-submit');
  button.disabled = true;
  try {
    const { error } = await supabase.auth.updateUser({ password: document.getElementById('new-password').value });
    if (error) throw error;
    await supabase.auth.signOut();
    updateForm.hidden = true;
    show('Password updated. Sign in with your new password.');
  } catch {
    show('The password could not be updated. Request a fresh reset link.', true);
  } finally { button.disabled = false; }
});
