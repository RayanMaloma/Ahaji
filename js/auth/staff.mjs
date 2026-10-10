import { supabase } from './client.mjs';

const list = document.getElementById('staff-rooms');
const { data, error } = await supabase.from('rooms').select('id,name').order('display_order');
if (error) {
  list.textContent = 'Could not load permitted rooms.';
} else {
  for (const room of data || []) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `gm.html?room=${encodeURIComponent(room.id)}`;
    link.textContent = room.name;
    item.appendChild(link);
    list.appendChild(item);
  }
  if (!list.children.length) list.textContent = 'No rooms assigned yet.';
}

document.getElementById('change-email-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const message = document.getElementById('change-email-message');
  button.disabled = true;
  let updateError;
  try {
    ({ error: updateError } = await supabase.auth.updateUser({
      email: document.getElementById('new-email').value.trim()
    }));
  } catch (error) { updateError = error; }
  message.hidden = false;
  message.classList.toggle('auth-error', Boolean(updateError));
  message.textContent = updateError
    ? 'Email change could not be requested. Please try again later.'
    : 'Check the new email inbox for a confirmation link before using it to sign in.';
  button.disabled = false;
});
