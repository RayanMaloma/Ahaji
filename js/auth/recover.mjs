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
  intro.textContent = 'اختر كلمة مرور جديدة لحسابك.';
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') enableUpdate();
});
if (new URLSearchParams(location.search).has('setup')) {
  enableUpdate();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    updateForm.hidden = true;
    show('انتهت صلاحية الرابط. اطلب رابطاً جديداً.', true);
  }
}

requestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('request-submit');
  button.disabled = true;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(document.getElementById('email').value.trim());
    if (error) throw error;
    show('إذا كان البريد مرتبطاً بحساب فريق عمل، فستصلك رسالة الاستعادة. تحقّق من صندوق بريدك.');
  } catch {
    show('تعذّر إرسال طلب الاستعادة. حاول لاحقاً.', true);
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
    show('تم تحديث كلمة المرور. يمكنك الدخول بكلمة المرور الجديدة.');
  } catch {
    show('تعذّر تحديث كلمة المرور. اطلب رابط استعادة جديداً.', true);
  } finally { button.disabled = false; }
});
