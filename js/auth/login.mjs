import { supabase, currentAccess, safeNext } from './client.mjs';

const form = document.getElementById('login-form');
const submit = document.getElementById('login-submit');
const errorBox = document.getElementById('login-error');
const requestedNext = new URLSearchParams(location.search).get('next');
const next = safeNext(requestedNext);

function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
function route(access) {
  window.location.replace(access.role
    ? (!requestedNext && access.role === 'admin' ? 'admin.html?view=rooms' : next)
    : 'unauthorized.html');
}

try {
  const access = await currentAccess();
  if (access) route(access);
} catch { /* Keep the sign-in form usable during a temporary connection error. */ }

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  submit.textContent = 'جارٍ تسجيل الدخول…';
  errorBox.hidden = true;
  try {
    const identifier=document.getElementById('email').value.trim().toLowerCase();
    const password=document.getElementById('password').value;
    if(!identifier.includes('@') || identifier.endsWith('@ahaji.com')){
      const {data,error}=await supabase.functions.invoke('operator-login',{
        body:{username:identifier,password}});
      if(error || data?.error || !data?.access_token){showError('اسم المستخدم أو كلمة المرور غير صحيحة.');return;}
      const established=await supabase.auth.setSession({
        access_token:data.access_token,refresh_token:data.refresh_token});
      if(established.error){showError('تعذّر إكمال تسجيل الدخول.');return;}
    }else{
      const { error } = await supabase.auth.signInWithPassword({email:identifier,password});
      if(error){showError('البريد الإلكتروني أو كلمة المرور غير صحيحة، أو لم يُوثّق الحساب بعد.');return;}
    }
    const access = await currentAccess();
    if (!access) { showError('تعذّر التحقق من تسجيل الدخول. حاول مرة أخرى.'); return; }
    route(access);
  } catch {
    showError('تعذّر الاتصال بخدمة الدخول. تحقّق من اتصالك وأعد المحاولة.');
  } finally {
    submit.disabled = false;
    submit.textContent = 'دخول';
  }
});
