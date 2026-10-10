import { supabase } from './client.mjs';

const list = document.getElementById('staff-rooms');
const arabicRoomNames = { anbar: 'السجن', haram: 'الهرم', saleh: 'العم صالح' };
const { data, error } = await supabase.from('rooms').select('id,name').order('display_order');
if (error) {
  list.textContent = 'تعذّر تحميل الغرف المسموح بها.';
} else {
  for (const room of data || []) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `gm.html?room=${encodeURIComponent(room.id)}`;
    link.textContent = arabicRoomNames[room.id] || room.name;
    item.appendChild(link);
    list.appendChild(item);
  }
  if (!list.children.length) list.textContent = 'لم تُعيَّن لك غرف بعد.';
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
    ? 'تعذّر طلب تغيير البريد. حاول لاحقاً.'
    : 'تحقّق من صندوق البريد الجديد واتبع رابط التوثيق قبل استخدامه للدخول.';
  button.disabled = false;
});
