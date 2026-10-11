import { supabase, currentAccess } from '../auth/client.mjs';
import { createAdminRepository } from '../data/admin-repository.mjs';
import { metricLabel, roomMetrics } from './room-metrics.mjs';
import { profileInitial, profileName } from './profile-avatar.mjs?v=phase5-final';

const repository = createAdminRepository(supabase);
const shell = document.getElementById('admin-shell');
const gate = document.getElementById('admin-auth-loading');
const gateError = document.getElementById('admin-auth-error');
const content = document.getElementById('admin-content');
const breadcrumbs = document.getElementById('admin-breadcrumbs');
const sidebar = document.getElementById('admin-sidebar');
const menuButton = document.getElementById('admin-menu-button');
const scrim = document.getElementById('admin-scrim');
const state = { access: null, data: null, loading: false, error: false };
let accessRequestId = 0;
const arabicRoomNames = { anbar: 'السجن', haram: 'الهرم', saleh: 'العم صالح' };
const roomName = room => arabicRoomNames[room.id] || room.name;
const mediaKinds = {
  hint_sound: 'صوت التلميح', lose_sound: 'صوت الخسارة',
  lose_video: 'فيديو الخسارة', gm_image: 'صورة', gm_sound: 'مؤثر صوتي'
};

function node(tag, className = '', value) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (value !== undefined) item.textContent = value;
  return item;
}
function link(href, className, label) {
  const item = node('a', className, label);
  item.href = href;
  if (href.startsWith('admin.html')) item.dataset.adminLink = '';
  return item;
}
function button(label, className = 'subtle-button') {
  const item = node('button', className, label);
  item.type = 'button';
  return item;
}
function assetUrl(ref) {
  if (typeof ref !== 'string' || !/^(images|source)\//.test(ref) || ref.includes('..')) return null;
  const url = new URL(ref, location.origin + '/');
  return url.origin === location.origin ? url.href : null;
}
function image(ref, alt, className) {
  const src = assetUrl(ref);
  if (!src) return node('span', `${className} mini-thumb-fallback`, '◇');
  const item = node('img', className);
  item.src = src;
  item.alt = alt;
  item.loading = className === 'room-background' ? 'eager' : 'lazy';
  let retry = false;
  item.onerror = () => {
    if (!retry) {
      retry = true;
      item.src = `${src}${src.includes('?') ? '&' : '?'}retry=1`;
    } else item.replaceWith(node('span', `${className} mini-thumb-fallback`, '◇'));
  };
  return item;
}
function statusPill(active) {
  const item = node('span', `status-pill ${active ? 'active' : 'inactive'}`);
  item.append(node('span', 'status-dot'), document.createTextNode(active ? 'نشطة' : 'غير نشطة'));
  return item;
}
function rolePill(role) {
  return node('span', `role-pill ${role === 'admin' ? 'admin' : 'game_master'}`,
    role === 'admin' ? 'مدير' : 'مدير لعبة');
}
function heading(kicker, title, intro, action) {
  const wrap = node('div', 'page-heading');
  const titleGroup = node('div');
  titleGroup.append(node('p', 'page-kicker', kicker), node('h1', '', title), node('p', '', intro));
  wrap.append(titleGroup);
  if (action) wrap.append(action);
  return wrap;
}
function panel(title, subtitle) {
  const wrap = node('section', 'panel');
  const head = node('div', 'panel-head');
  const copy = node('div');
  copy.append(node('h2', '', title));
  if (subtitle) copy.append(node('p', '', subtitle));
  head.append(copy);
  wrap.append(head);
  return { wrap, head };
}
function fmtDuration(seconds) {
  const minutes = Math.round(Number(seconds) / 60);
  return `${minutes} دقيقة`;
}
function fmtDate(value) {
  if (!value) return 'غير متاح';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'غير متاح' : new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium',numberingSystem:'latn'}).format(date);
}
function roomUrl(room) { return `admin.html?view=room&id=${encodeURIComponent(room.id)}`; }
function metricTags(room) {
  const metrics = roomMetrics(room);
  const list = node('div', 'room-metric-tags');
  for (const kind of ['hints', 'images', 'videos', 'audio']) {
    list.append(node('span', `room-metric-tag metric-${kind}`, metricLabel(kind, metrics[kind])));
  }
  return list;
}

function roomTile(room) {
  const tile = link(roomUrl(room), 'room-tile', '');
  const cover = node('div', 'room-tile-image');
  cover.append(image(room.thumbnail, `صورة غرفة ${roomName(room)}`, 'room-cover'), statusPill(room.isActive));
  const body = node('div', 'room-tile-body');
  body.append(node('h2', '', roomName(room)), metricTags(room));
  tile.append(cover, body);
  return tile;
}
function renderRooms() {
  const rooms = state.data.rooms;
  content.append(node('h1', 'sr-only', 'الغرف'));
  const grid = node('div','room-grid-admin');
  if (!rooms.length) {
    const empty = node('div','empty-box');
    empty.append(node('strong','','لا توجد غرف بعد'),node('span','','ستظهر الغرف هنا عند إعدادها.'));
    grid.append(empty);
  } else rooms.forEach(room => grid.append(roomTile(room)));
  content.append(grid);
}

function detailField(label, value) {
  const box = node('div'); box.append(node('small','',label),node('strong','',value)); return box;
}
function renderRoom(roomId) {
  const room = state.data.rooms.find(item => item.id === roomId);
  if (!room) { renderNotFound('لم نتمكن من العثور على هذه الغرفة في قاعدة البيانات.'); return; }
  const back = link('admin.html?view=rooms','subtle-button room-back','→  جميع الغرف');
  content.append(back, heading('تفاصيل الغرفة',roomName(room),'إعدادات الغرفة ومحتواها الحالي · للعرض فقط'));
  const hero = node('section','room-hero');
  const cover = node('div','room-hero-image'); cover.append(image(room.backgroundImage,`خلفية غرفة ${roomName(room)}`,'room-background'));
  const body = node('div','room-hero-body');
  const summary = node('div');
  summary.append(statusPill(room.isActive),node('h2','',roomName(room)));
  const meta = node('div','detail-meta');
  meta.append(detailField('الوقت الافتراضي',fmtDuration(room.defaultDuration)),
    detailField('آخر تحديث',fmtDate(room.updatedAt)));
  body.append(summary,metricTags(room),meta); hero.append(cover,body); content.append(hero);
  const columns = node('div','detail-columns');
  const hints = panel('التلميحات النصية',metricLabel('hints',room.hints.length));
  const hintsList = node('ol','detail-list');
  if (!room.hints.length) hints.wrap.append(node('p','panel-empty','لا توجد تلميحات نصية لهذه الغرفة.'));
  room.hints.forEach((hint,index) => {
    const item = node('li');
    const copy = node('span','detail-text',hint.text); copy.dir = 'auto';
    item.append(node('span','item-index',String(index+1).padStart(2,'0')),copy); hintsList.append(item);
  });
  if (room.hints.length) { const padding = node('div','panel-body'); padding.append(hintsList); hints.wrap.append(padding); }
  const media = panel('مكتبة الوسائط',`${room.mediaRecords.length} ملف`);
  if (!room.mediaRecords.length) media.wrap.append(node('p','panel-empty','لا توجد ملفات وسائط لهذه الغرفة.'));
  else {
    const list = node('ul','detail-list');
    for (const record of room.mediaRecords) {
      const item = node('li');
      const text = node('div','detail-text');
      const label = node('span','',record.label || record.assetRef?.split('/').at(-1) || 'ملف بلا عنوان');
      label.dir = 'auto';
      text.append(node('span','media-kind',mediaKinds[record.kind] || record.kind),label);
      item.append(text);
      const src = assetUrl(record.assetRef);
      if (src) { const open = link(src,'media-link','فتح الملف ↗'); open.target='_blank'; open.rel='noopener noreferrer'; item.append(open); }
      list.append(item);
    }
    const padding = node('div','panel-body'); padding.append(list); media.wrap.append(padding);
  }
  columns.append(hints.wrap,media.wrap); content.append(columns);
}

function renderStaff() {
  const staff = state.data.staff;
  const rooms = new Map(state.data.rooms.map(room => [room.id,roomName(room)]));
  content.append(node('h1','sr-only','فريق العمل'));
  const panelData = panel('حسابات الفريق',`${staff.length} حساب`);
  if (!staff.length) panelData.wrap.append(node('p','panel-empty','لا توجد حسابات فريق عمل حالياً.'));
  else {
    const wrap = node('div','table-wrap'); const table = node('table','staff-table');
    const thead = node('thead'); const header = node('tr');
    for (const label of ['الحساب','الدور','الغرف المسموح بها','الحالة']) header.append(node('th','',label));
    thead.append(header); table.append(thead);
    const tbody = node('tbody');
    for (const person of staff) {
      const row = node('tr'); const accountCell=node('td'); const identity=node('div','staff-identity');
      identity.append(node('span','staff-identity-icon',(person.email||'?').slice(0,1).toUpperCase()));
      const copy=node('span');
      const email=node('strong','staff-email',person.email||'البريد غير متاح');email.dir='ltr';
      copy.append(email,node('small','',person.email_confirmed?'بريد موثّق':'البريد غير موثّق'));
      identity.append(copy); accountCell.append(identity); row.append(accountCell);
      const roleCell=node('td'); roleCell.append(rolePill(person.role)); row.append(roleCell);
      const assignments=node('td'); const chips=node('div','assignment-list');
      if(person.role==='admin') chips.append(node('span','assignment-chip','جميع الغرف'));
      else if(!person.room_ids?.length) chips.append(node('span','','لا توجد غرف معيّنة'));
      else for(const id of person.room_ids) chips.append(node('span','assignment-chip',rooms.get(id)||id));
      assignments.append(chips);row.append(assignments);
      const statusCell=node('td');statusCell.append(statusPill(person.active));row.append(statusCell);
      tbody.append(row);
    }
    table.append(tbody);wrap.append(table);panelData.wrap.append(wrap);
  }
  content.append(panelData.wrap);
}

function renderAccount() {
  const access=state.access;
  content.append(node('h1','sr-only','حسابي'));
  const grid=node('div','account-layout');
  const profile=node('section','panel account-card');
  const profileHeader = node('div','account-profile-heading');
  const identity=node('div','account-profile-identity');
  identity.append(node('strong','',profileName(access.user)||'حسابي'),rolePill(access.role));
  profileHeader.append(node('span','admin-avatar account-avatar',profileInitial(access.user)),identity);
  profile.append(profileHeader);
  if(profileName(access.user)!==access.user.email)
    profile.append(detailAccount('البريد الإلكتروني',access.user.email||'غير متاح',true));
  profile.append(detailAccount('حالة البريد',access.user.email_confirmed_at?'موثّق':'بانتظار التوثيق'));
  const change=node('section','panel account-card');
  change.append(node('h2','','تغيير البريد الإلكتروني'));
  const form=node('form','account-form');form.id='admin-email-form';
  const label=node('label','','البريد الإلكتروني الجديد');label.htmlFor='admin-new-email';
  const input=node('input');input.id='admin-new-email';input.type='email';input.autocomplete='email';input.dir='ltr';input.required=true;
  const submit=button('إرسال رابط التوثيق','button-dark');submit.type='submit';
  const message=node('p','form-message');message.hidden=true;message.setAttribute('role','status');
  form.append(label,input,submit,message);change.append(form,
    node('p','account-note','سيُطلب توثيق البريد الجديد قبل تغييره. تبقى صلاحية الإدارة مرتبطة بحسابك.'));
  form.addEventListener('submit',async event=>{
    event.preventDefault();submit.disabled=true;message.hidden=true;
    try {
      const {error}=await supabase.auth.updateUser({email:input.value.trim()});
      if(error) throw error;
      message.classList.remove('error');
      message.textContent='تحقّق من صندوق البريد الجديد لفتح رابط التوثيق.';
      input.value='';
    } catch {
      message.classList.add('error');message.textContent='تعذّر طلب تغيير البريد. حاول لاحقاً.';
    } finally {message.hidden=false;submit.disabled=false;}
  });
  const security=node('section','panel account-card');
  security.append(node('h2','','الدخول والأمان'));
  security.append(node('p','account-note','يمكنك استعادة كلمة المرور عبر رابط يُرسل إلى بريدك الإلكتروني.'),
    link('recover.html','subtle-button','استعادة كلمة المرور ↗'));
  grid.append(profile,change,security);content.append(grid);
}
function detailAccount(label,value,ltr=false){const row=node('div','account-field');const text=node('strong','',value);if(ltr)text.dir='ltr';row.append(node('small','',label),text);return row;}
function renderNotFound(message){
  const error=node('div','error-panel');
  error.append(node('h2','','الصفحة غير موجودة'),node('p','',message),link('admin.html?view=rooms','subtle-button','العودة إلى الغرف'));
  content.append(error);
}

function route(){
  const params=new URLSearchParams(location.search);
  const requested=params.get('view')||'rooms';
  if(!params.has('view') || requested==='overview'){
    history.replaceState(null,'','admin.html?view=rooms');
    return {view:'rooms',id:''};
  }
  return {view:requested,id:params.get('id')||''};
}
function setNavigation(view,id){
  const section=view==='room'?'rooms':view;
  document.querySelectorAll('[data-nav]').forEach(item=>{
    if(item.dataset.nav===section)item.setAttribute('aria-current','page');
    else item.removeAttribute('aria-current');
  });
  breadcrumbs.replaceChildren();
  const titles={rooms:'الغرف',staff:'فريق العمل',account:'حسابي',room:'تفاصيل الغرفة'};
  let title=titles[view]||'صفحة غير موجودة';
  if(view==='room'){
    const room=state.data?.rooms.find(r=>r.id===id);
    if(room)title=roomName(room);
  }
  breadcrumbs.append(node('strong','',title));
  document.title=`${title} · أحاجي`;
}
function render(){
  const {view,id}=route();setNavigation(view,id);content.replaceChildren();
  content.classList.toggle('compact-content',view==='rooms'||view==='staff'||view==='account');
  if(view==='account' && state.access){renderAccount();return;}
  if(state.error){
    const box=node('div','error-panel');
    box.append(node('h2','','تعذّر تحميل البيانات'),
      node('p','','تعذّر الاتصال بقاعدة البيانات. تحقّق من اتصالك ثم أعد المحاولة.'));
    const retry=button('إعادة المحاولة','button-dark');retry.addEventListener('click',loadData);box.append(retry);content.append(box);
    return;
  }
  if(!state.data){content.append(node('div','loading-panel','جارٍ تحميل بيانات الغرف…'));return;}
  if(view==='rooms')renderRooms();
  else if(view==='room')renderRoom(id);
  else if(view==='staff')renderStaff();
  else renderNotFound('هذا الرابط لا يشير إلى صفحة في لوحة الإدارة.');
}
function closeMenu(){sidebar.classList.remove('open');scrim.hidden=true;menuButton.setAttribute('aria-expanded','false');}
function openMenu(){sidebar.classList.add('open');scrim.hidden=false;menuButton.setAttribute('aria-expanded','true');}
menuButton.addEventListener('click',()=>sidebar.classList.contains('open')?closeMenu():openMenu());
scrim.addEventListener('click',closeMenu);
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
document.addEventListener('click',event=>{
  const anchor=event.target.closest('a[data-admin-link]');
  if(!anchor||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;
  event.preventDefault();
  const target=new URL(anchor.href);
  if(target.origin!==location.origin)return;
  history.pushState(null,'',target.pathname+target.search);
  closeMenu();
  if(target.searchParams.get('view')==='account') {
    const {view,id}=route();setNavigation(view,id);
    content.replaceChildren(node('div','loading-panel','جارٍ تحديث بيانات الحساب…'));
    verifyAccess();
  } else {render();verifyAccess();}
  content.focus({preventScroll:true});window.scrollTo(0,0);
});
window.addEventListener('popstate',()=>{
  closeMenu();
  if(route().view==='account') {
    const {view,id}=route();setNavigation(view,id);
    content.replaceChildren(node('div','loading-panel','جارٍ تحديث بيانات الحساب…'));
    verifyAccess();
  } else {render();verifyAccess();}
});

async function loadData(){
  if(state.loading)return;
  state.loading=true;state.error=false;state.data=null;
  if(route().view!=='account')render();
  try{state.data=await repository.load();if(route().view!=='account')render();}
  catch{
    state.error=true;if(route().view!=='account')render();
  } finally{state.loading=false;}
}
async function verifyAccess(){
  const requestId=++accessRequestId;
  try{
    const previous=state.access;
    const access=await currentAccess();
    if(requestId!==accessRequestId)return false;
    if(!access){location.replace(`login.html?next=${encodeURIComponent(location.pathname.slice(1)+location.search)}`);return false;}
    if(access.role!=='admin'){state.data=null;location.replace('unauthorized.html?reason=admin');return false;}
    state.access=access;
    const initial=profileInitial(access.user);
    document.getElementById('sidebar-avatar').textContent=initial;
    document.getElementById('topbar-avatar').textContent=initial;
    const name=profileName(access.user);
    document.getElementById('sidebar-name').textContent=name===access.user.email?'مدير':name||'مدير';
    document.getElementById('sidebar-email').textContent=access.user.email||'';
    gate.hidden=true;gateError.hidden=true;shell.hidden=false;
    const identityChanged=previous && (
      previous.user.id!==access.user.id || previous.user.email!==access.user.email ||
      previous.user.email_confirmed_at!==access.user.email_confirmed_at ||
      profileName(previous.user)!==profileName(access.user));
    if(route().view==='account' && (identityChanged || content.querySelector('.loading-panel') || !content.hasChildNodes()))render();
    return true;
  }catch{
    if(requestId!==accessRequestId)return false;
    if(!state.access){gate.hidden=true;gateError.hidden=false;}
    else{state.data=null;state.error=true;render();}
    return false;
  }
}
document.getElementById('admin-auth-retry').addEventListener('click',async()=>{
  gateError.hidden=true;gate.hidden=false;if(await verifyAccess())await loadData();
});
document.getElementById('admin-logout').addEventListener('click',async event=>{
  event.currentTarget.disabled=true;
  try{await supabase.auth.signOut();location.replace('login.html');}
  catch{event.currentTarget.disabled=false;}
});
supabase.auth.onAuthStateChange(event=>{
  if(event==='SIGNED_OUT')location.replace('login.html');
  if(event==='TOKEN_REFRESHED'||event==='USER_UPDATED')setTimeout(verifyAccess,0);
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)verifyAccess();});
const initialRoute=route();
setNavigation(initialRoute.view,initialRoute.id);
if(await verifyAccess())await loadData();
