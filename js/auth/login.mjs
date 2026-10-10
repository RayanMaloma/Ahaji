import { supabase, currentAccess, safeNext } from './client.mjs';

const form = document.getElementById('login-form');
const submit = document.getElementById('login-submit');
const errorBox = document.getElementById('login-error');
const next = safeNext(new URLSearchParams(location.search).get('next'));

function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
function route(access) {
  window.location.replace(access.role ? next : 'unauthorized.html');
}

try {
  const access = await currentAccess();
  if (access) route(access);
} catch { /* Keep the sign-in form usable during a temporary connection error. */ }

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  errorBox.hidden = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value
    });
    if (error) { showError('Email or password is incorrect, or this account is not confirmed.'); return; }
    const access = await currentAccess();
    if (!access) { showError('Sign-in could not be verified. Please try again.'); return; }
    route(access);
  } catch {
    showError('Could not reach the sign-in service. Check your connection and retry.');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Sign in';
  }
});
