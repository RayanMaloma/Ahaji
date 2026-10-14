import { supabase } from './client.mjs';
import { checkPassword, PASSWORD_RULES } from './password-policy.mjs';
import { revealPage, showPageGate } from '../loader.mjs?v=loader-2';

// Invitation activation: verify the one-time link only after a click (mail
// scanners that prefetch links cannot consume it), set a password through
// Supabase Auth, then activate through accept_staff_invitation(). The server
// refuses activation without a confirmed email, a password, and a live,
// unexpired, unrevoked invitation.
const $ = id => document.getElementById(id);
const gate = $('activation-loading');
const title = $('activation-title');
const welcome = $('activation-welcome');
const form = $('activation-form');
const done = $('activation-done');
const message = $('activation-message');
const loginLink = $('activation-login');
const password = $('activation-password');
const confirm = $('activation-confirm');
const submit = $('activation-submit');
const rules = $('password-rules');
const params = new URLSearchParams(location.search);
const tokenHash = params.get('token_hash');
const linkType = params.get('type');
// Keep the one-time token out of history, bookmarks, and screenshots.
if (tokenHash) history.replaceState(null, '', location.pathname);

const STATES = {
  invalid: ['الرابط غير صالح أو منتهي', 'هذا الرابط لم يعد صالحاً. اطلب من مدير أحاجي إعادة إرسال الدعوة.'],
  expired: ['انتهت صلاحية الدعوة', 'انتهت مدة هذه الدعوة. اطلب من مدير أحاجي إعادة إرسالها.'],
  revoked: ['الدعوة ملغاة', 'ألغى مدير أحاجي هذه الدعوة. تواصل مع الإدارة إذا كنت تتوقع الانضمام.'],
  none: ['لا توجد دعوة نشطة', 'لا توجد دعوة بانتظار التفعيل لهذا الحساب.'],
  signin: ['افتح رابط الدعوة', 'افتح زر «تفعيل حسابي» من رسالة الدعوة على هذا الجهاز للمتابعة.'],
  failed: ['تعذّر إكمال التفعيل', 'تحقّق من اتصالك ثم أعد المحاولة. إذا تكررت المشكلة فاطلب دعوة جديدة.'],
};
let email = '';

function hideAll() { welcome.hidden = form.hidden = done.hidden = message.hidden = loginLink.hidden = true; }
function reveal() { revealPage(gate); }
function showGate() { showPageGate(gate); }
async function showState(key, signOut = true) {
  if (signOut) await supabase.auth.signOut().catch(() => {});
  hideAll();
  const [heading, text] = STATES[key];
  title.textContent = heading;
  message.textContent = text;
  message.hidden = false;
  loginLink.hidden = false;
  reveal();
  title.focus();
}
function destination(role) { return role === 'admin' ? 'admin.html?view=rooms' : 'index.html'; }
function finish(role) {
  hideAll();
  title.textContent = 'تم تفعيل حسابك';
  $('activation-done-text').textContent = role === 'admin'
    ? 'أصبح بإمكانك إدارة أحاجي.' : 'أصبح بإمكانك تشغيل الغرف المسندة إليك.';
  const next = $('activation-next');
  next.href = destination(role);
  done.hidden = false;
  reveal();
  title.focus();
}

function renderRules() {
  const state = checkPassword(password.value, { email, confirm: confirm.value });
  rules.replaceChildren(...state.results.map(rule => {
    const item = document.createElement('li');
    item.className = rule.ok ? 'met' : '';
    item.textContent = `${rule.ok ? '✓' : '•'} ${rule.label}`;
    return item;
  }));
  const status = $('confirm-status');
  status.textContent = confirm.value ? (state.matches ? '✓ كلمتا المرور متطابقتان' : 'كلمتا المرور غير متطابقتين') : '';
  status.className = `password-confirm${confirm.value && !state.matches ? ' mismatch' : ''}`;
  return state;
}

async function accept() {
  const { data, error } = await supabase.rpc('accept_staff_invitation');
  if (error) throw error;
  const status = data?.status;
  if (status === 'accepted') { finish(data.role); return; }
  if (status === 'password_required') { showForm(); return; }
  await showState(['expired', 'revoked', 'none'].includes(status) ? status : 'failed');
}

function showForm(row) {
  hideAll();
  const name = row?.display_name?.trim();
  title.textContent = name ? `مرحباً ${name}` : 'مرحباً بك في أحاجي';
  $('activation-intro').textContent = `اختر كلمة مرور لحسابك${row?.role === 'admin' ? ' بصفة مدير' : row?.role ? ' بصفة مدير لعبة' : ''}. تُحفظ لدى خدمة الدخول فقط ولا يراها أحد.`;
  form.hidden = false;
  renderRules();
  reveal();
  password.focus();
}

async function loadInvitation() {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) { await showState('signin', false); return; }
  email = session.session.user.email || '';
  const { data, error } = await supabase.rpc('my_staff_invitation');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) { await showState('none'); return; }
  if (row.status === 'accepted') { finish(row.role); return; }
  if (row.status !== 'pending') { await showState(row.status === 'expired' ? 'expired' : row.status === 'revoked' ? 'revoked' : 'none'); return; }
  if (row.password_set) { await accept(); return; }
  showForm(row);
}

async function verifyLink() {
  showGate();
  const type = linkType === 'recovery' ? 'recovery' : linkType === 'magiclink' ? 'magiclink' : 'invite';
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) { await showState('invalid'); return; }
  await loadInvitation();
}

password.addEventListener('input', renderRules);
confirm.addEventListener('input', renderRules);
document.querySelectorAll('[data-toggle]').forEach(button => button.addEventListener('click', () => {
  const field = $(button.dataset.toggle);
  const show = field.type === 'password';
  field.type = show ? 'text' : 'password';
  confirm.type = field.type;
  button.textContent = show ? 'إخفاء' : 'إظهار';
  button.setAttribute('aria-pressed', String(show));
}));
$('activation-continue').addEventListener('click', () => verifyLink().catch(() => showState('failed')));
form.addEventListener('submit', async event => {
  event.preventDefault();
  const state = renderRules();
  if (!state.ok) {
    message.textContent = state.matches ? 'كلمة المرور لا تستوفي المتطلبات أعلاه.' : 'كلمتا المرور غير متطابقتين.';
    message.hidden = false;
    (state.matches ? password : confirm).focus();
    return;
  }
  submit.disabled = true; message.hidden = true;
  try {
    const { error } = await supabase.auth.updateUser({ password: password.value });
    if (error) {
      message.textContent = error.code === 'weak_password'
        ? 'رفضت خدمة الدخول كلمة المرور لضعفها أو لظهورها في تسريبات معروفة. اختر كلمة أقوى.'
        : 'تعذّر حفظ كلمة المرور. حاول مجدداً.';
      message.hidden = false;
      return;
    }
    password.value = confirm.value = '';
    await accept();
  } catch {
    await showState('failed', false);
  } finally { submit.disabled = false; }
});

if (PASSWORD_RULES.length) renderRules();
if (tokenHash) { hideAll(); welcome.hidden = false; reveal(); }
else loadInvitation().catch(() => showState('failed', false));
