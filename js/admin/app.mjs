import { supabase, currentAccess } from '../auth/client.mjs';
import { createAdminRepository } from '../data/admin-repository.mjs?v=loader-1';
import { metricLabel, roomMetrics } from './room-metrics.mjs';
import { profileInitial, profileName } from './profile-avatar.mjs?v=phase5-final';
import { renderRoomWorkspace } from './room-workspace.mjs?v=loader-1';
import { createRoomDraft } from './room-draft.mjs';
import {activeDuration,dateKey,groupLabel} from './history-model.mjs?v=refinement-2';
import {createLoader,withImageSkeleton} from '../loader.mjs?v=loader-1';

const repository = createAdminRepository(supabase);
const shell = document.getElementById('admin-shell');
const gate = document.getElementById('admin-auth-loading');
const gateError = document.getElementById('admin-auth-error');
const content = document.getElementById('admin-content');
const adminMain=document.querySelector('.admin-main');
const sidebar = document.getElementById('admin-sidebar');
const menuButton = document.getElementById('admin-menu-button');
const scrim = document.getElementById('admin-scrim');
const state = { access: null, data: null, loading: false, error: false,
  history:null,historyLoading:false,historyError:false,
  historyView:{timeZone:localStorage.getItem('ahaji-history-timezone')||'Asia/Riyadh',
    mode:'all',day:'',start:'',end:'',showShort:false} };
let accessRequestId = 0,lastVerifiedAt = 0;
// UI re-checks are throttled for routine navigation; RLS still authorizes every request.
const ACCESS_RECHECK_MS = 15000;
let workspaceDraft=null,workspaceCleanup=null,lastRenderedUrl=location.pathname+location.search;
const roomName = room => room.name;

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
  if (typeof ref === 'string' && ref.startsWith('storage://room-assets/')) {
    const path=ref.slice('storage://room-assets/'.length);
    if(!/^[a-z][a-z0-9_-]{0,63}\/[A-Za-z0-9._-]+$/.test(path))return null;
    return supabase.storage.from('room-assets').getPublicUrl(path).data.publicUrl;
  }
  if (typeof ref !== 'string' || !/^(images|source)\//.test(ref) || ref.includes('..')) return null;
  const url = new URL(ref, location.origin + '/');
  return url.origin === location.origin ? url.href : null;
}
function profileAvatarUrl(ref){
  if(typeof ref!=='string'||!/^storage:\/\/profile-assets\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(ref))return '';
  return supabase.storage.from('profile-assets').getPublicUrl(ref.slice('storage://profile-assets/'.length)).data.publicUrl;
}
function image(ref, alt, className, eager = false) {
  const src = assetUrl(ref);
  if (!src) return node('span', `${className} mini-thumb-fallback`, '◇');
  const item = node('img', className);
  item.src = src;
  item.alt = alt;
  item.decoding = 'async';
  item.loading = eager || className === 'room-background' ? 'eager' : 'lazy';
  if (eager) item.fetchPriority = 'high';
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
  titleGroup.append(node('h1', '', title));
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
function fmtDateTime(value){if(!value)return '—';const date=new Date(value);
  return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('ar-SA',
    {dateStyle:'medium',timeStyle:'short',numberingSystem:'latn',
      timeZone:state.historyView.timeZone}).format(date);}
function sessionOutcome(session){return session.status!=='ended'?(
  session.status==='running'?'جارية':session.status==='paused'?'متوقفة مؤقتاً':'جاهزة'):
  session.result==='win'?'فوز':session.result==='lose'?'خسارة':'انتهت الصلاحية';}
function sessionDuration(session){if(!session.started_at||!session.ended_at)return '—';
  return `${Math.max(0,Math.round((new Date(session.ended_at)-new Date(session.started_at))/60000))} دقيقة`;}
function roomUrl(room) { return `admin.html?view=room&id=${encodeURIComponent(room.id)}`; }
function metricTags(room) {
  const metrics = roomMetrics(room);
  const list = node('div', 'room-metric-tags');
  for (const kind of ['hints', 'images', 'videos', 'audio']) {
    list.append(node('span', `room-metric-tag metric-${kind}`, metricLabel(kind, metrics[kind])));
  }
  return list;
}

function roomTile(room, index = 0) {
  const tile = link(roomUrl(room), 'room-tile', '');
  const cover = node('div', 'room-tile-image');
  const coverImage = image(room.thumbnail, `صورة غرفة ${roomName(room)}`, 'room-cover', index < 6);
  cover.append(coverImage, statusPill(room.isActive));
  withImageSkeleton(coverImage, cover);
  const body = node('div', 'room-tile-body');
  body.append(node('h2', '', roomName(room)), metricTags(room));
  tile.append(cover, body);
  return tile;
}
function renderRooms() {
  const rooms = state.data.rooms;
  const add=button('＋ إضافة غرفة','button-dark');
  add.addEventListener('click',()=>navigate('admin.html?view=new-room'));
  content.append(heading('إدارة الغرف','الغرف','إعداد الغرف ومحتواها وتشغيلها.',add));
  const grid = node('div','room-grid-admin');
  if (!rooms.length) {
    const empty = node('div','empty-box');
    empty.append(node('strong','','لا توجد غرف بعد'),node('span','','ستظهر الغرف هنا عند إعدادها.'));
    grid.append(empty);
  } else rooms.forEach((room, index) => grid.append(roomTile(room, index)));
  const addTile=button('＋  إضافة غرفة','room-add-tile');
  addTile.addEventListener('click',()=>navigate('admin.html?view=new-room'));
  grid.append(addTile);
  content.append(grid);
}

function detailField(label, value) {
  const box = node('div'); box.append(node('small','',label),node('strong','',value)); return box;
}
function showDialog(title,build) {
  const dialog=node('dialog','admin-dialog');
  const titleId=`admin-dialog-${crypto.randomUUID()}`;
  dialog.setAttribute('aria-labelledby',titleId);
  const form=node('form','admin-dialog-form');form.method='dialog';
  const head=node('div','admin-dialog-head');const titleNode=node('h2','',title);
  titleNode.id=titleId;head.append(titleNode);
  const close=button('✕','mini-action');close.setAttribute('aria-label','إغلاق');close.addEventListener('click',()=>dialog.close());head.append(close);
  form.append(head);build(form,dialog);
  dialog.append(form);document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  return {dialog,form};
}
function field(label,control){const wrap=node('label','form-field');wrap.append(node('span','',label),control);return wrap;}
function formStatus(form,message,error=true){let status=form.querySelector('[data-form-status]');if(!status){status=node('p','form-message');status.dataset.formStatus='';status.setAttribute('role','status');form.append(status);}status.classList.toggle('error',error);status.textContent=message;}
async function refresh(){await loadData();}
function renderStaff() {
  const staff = state.data.staff;
  const rooms = new Map(state.data.rooms.map(room => [room.id,roomName(room)]));
  const invite=button('＋ إضافة عضو','button-dark');invite.addEventListener('click',()=>showStaffEditor());
  content.append(heading('إدارة الفريق','فريق العمل','الدعوات والأدوار وصلاحيات الغرف.',invite));
  const panelData = panel('حسابات الفريق',`${staff.length} حساب`);
  if (!staff.length) panelData.wrap.append(node('p','panel-empty','لا توجد حسابات فريق عمل حالياً.'));
  else {
    const wrap = node('div','table-wrap'); const table = node('table','staff-table');
    const thead = node('thead'); const header = node('tr');
    for (const label of ['الحساب','الدور','الغرف المسموح بها','الحالة','الإجراءات']) header.append(node('th','',label));
    thead.append(header); table.append(thead);
    const tbody = node('tbody');
    for (const person of staff) {
      const row = node('tr'); const accountCell=node('td'); const identity=node('div','staff-identity');
      const display=person.display_name||person.login_name||person.email||'عضو الفريق';
      const staffAvatar=node('span','staff-identity-icon',display.slice(0,1).toUpperCase());
      const avatarSrc=profileAvatarUrl(person.avatar_ref);
      if(avatarSrc){staffAvatar.style.backgroundImage=`url("${avatarSrc}")`;staffAvatar.textContent='';}
      identity.append(staffAvatar);
      const copy=node('span');
      const email=node('strong','staff-email',display);email.dir='auto';
      copy.append(email,node('small','',person.account_type==='operator'
        ? `${person.login_name}@ahaji.com · حساب تشغيلي`
        : person.email_confirmed?'بريد موثّق':'البريد غير موثّق'));
      identity.append(copy); accountCell.append(identity); row.append(accountCell);
      const roleCell=node('td'); roleCell.append(rolePill(person.role)); row.append(roleCell);
      const assignments=node('td'); const chips=node('div','assignment-list');
      if(person.role==='admin') chips.append(node('span','assignment-chip','جميع الغرف'));
      else if(!person.room_ids?.length) chips.append(node('span','','لا توجد غرف معيّنة'));
      else for(const id of person.room_ids) chips.append(node('span','assignment-chip',rooms.get(id)||id));
      assignments.append(chips);row.append(assignments);
      const statusCell=node('td');
      statusCell.append(!person.active?statusPill(false):person.account_type==='operator'||person.email_confirmed?statusPill(true):
        node('span','status-pill pending','بانتظار توثيق البريد'));
      row.append(statusCell);
      const actionCell=node('td');const edit=button('إدارة','mini-action');
      edit.addEventListener('click',()=>showStaffEditor(person));actionCell.append(edit);
      if(person.account_type==='operator'){
        const reset=button('إعادة تعيين كلمة المرور','mini-action');
        reset.addEventListener('click',()=>resetOperator(person));actionCell.append(reset);
      }else if(!person.email_confirmed){const resend=button('إعادة الدعوة','mini-action');
        resend.addEventListener('click',()=>resendInvite(person));actionCell.append(resend);}
      row.append(actionCell);
      tbody.append(row);
    }
    table.append(tbody);wrap.append(table);panelData.wrap.append(wrap);
  }
  content.append(panelData.wrap);
}
function renderHistory(){
  content.append(heading('','سجل الجلسات',''));
  if(!state.history&&!state.historyLoading&&!state.historyError){
    state.historyLoading=true;repository.loadHistory().then(data=>{
      state.history=data;state.historyLoading=false;
      if(route().view==='history'){content.replaceChildren();renderHistory();}
    }).catch(()=>{state.historyLoading=false;state.historyError=true;
      if(route().view==='history'){content.replaceChildren();renderHistory();}});
  }
  if(state.historyLoading){content.append(createLoader({label:'جارٍ تحميل سجل الجلسات…'}));return;}
  if(state.historyError){const error=node('div','error-panel');error.append(node('p','','تعذّر تحميل السجل.'));
    const retry=button('إعادة المحاولة','button-dark');retry.addEventListener('click',()=>{
      state.historyError=false;content.replaceChildren();renderHistory();});error.append(retry);content.append(error);return;}
  if(!state.history)return;
  const v=state.historyView,filters=node('div','history-filters');
  const mode=node('select','admin-select');for(const [value,label] of
    [['all','كل التواريخ'],['day','يوم محدد'],['range','فترة مخصصة']]){
    const option=node('option','',label);option.value=value;mode.append(option);}mode.value=v.mode;
  const day=node('input','admin-input');day.type='date';day.value=v.day;
  const start=node('input','admin-input');start.type='date';start.value=v.start;
  const end=node('input','admin-input');end.type='date';end.value=v.end;
  const zone=node('select','admin-select');for(const value of ['Asia/Riyadh','UTC','Asia/Dubai','Asia/Kuwait']){
    const option=node('option','',value);option.value=value;zone.append(option);}zone.value=v.timeZone;
  const short=node('input');short.type='checkbox';short.checked=v.showShort;
  const shortLabel=node('label','history-short-toggle');shortLabel.append(short,node('span','','إظهار الجلسات القصيرة والاختبارية'));
  const dayField=field('اليوم',day),startField=field('من',start),endField=field('إلى',end);
  const update=()=>{v.mode=mode.value;v.day=day.value;v.start=start.value;v.end=end.value;
    v.timeZone=zone.value;v.showShort=short.checked;
    localStorage.setItem('ahaji-history-timezone',v.timeZone);
    content.replaceChildren();renderHistory();};
  for(const control of [mode,day,start,end,zone,short])control.addEventListener('change',update);
  dayField.hidden=v.mode!=='day';startField.hidden=endField.hidden=v.mode!=='range';
  filters.append(field('التاريخ',mode),dayField,startField,endField,field('المنطقة الزمنية',zone),shortLabel);
  content.append(filters);
  const groups=new Map();let hiddenShort=0;
  for(const item of state.history.sessions){
    const key=dateKey(item.started_at||item.created_at,v.timeZone);
    if(v.mode==='day'&&v.day&&key!==v.day)continue;
    if(v.mode==='range'&&((v.start&&key<v.start)||(v.end&&key>v.end)))continue;
    const result=activeDuration(state.history.eventMap.get(item.id)||[],item);
    const shortSession=item.status==='ended'&&result.precise&&
      result.seconds!==null&&result.seconds<1200;
    if(shortSession&&!v.showShort){hiddenShort++;continue;}
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({item,result,shortSession});
  }
  const count=[...groups.values()].reduce((sum,items)=>sum+items.length,0);
  const summary=node('p','history-summary',`${count} جلسة معروضة${hiddenShort?` · ${hiddenShort} قصيرة مخفية`:''}`);
  content.append(summary);
  if(!count){content.append(node('div','empty-box','لا توجد جلسات مطابقة.'));return;}
  for(const [key,items] of groups){
    const section=node('section','history-group');section.append(node('h2','',groupLabel(key,v.timeZone)));
    for(const {item,result,shortSession} of items){
      const card=node('article','history-card');
      const room=state.data.rooms.find(r=>r.id===item.room_id);
      const staff=state.data.staff.find(s=>s.user_id===item.gm_user_id);
      const main=node('div','history-card-main');
      main.append(node('h3','',room?.name||item.room_id),
        node('span','history-outcome',sessionOutcome(item)));
      const time=item.started_at||item.created_at;
      const timeText=new Intl.DateTimeFormat('ar-SA',{timeZone:v.timeZone,
        hour:'numeric',minute:'2-digit',numberingSystem:'latn'}).format(new Date(time));
      const duration=result.seconds===null?'المدة غير قابلة للحساب':
        `${Math.floor(result.seconds/60)} دقيقة${result.precise?'':' · تقديرية'}`;
      const meta=node('div','history-card-meta');
      for(const label of [staff?.display_name||staff?.login_name||staff?.email||'مدير لعبة غير متاح',
        `البدء ${timeText}`,duration,shortSession?'قصيرة / اختبارية':
          item.status!=='ended'?'غير مكتملة':''])if(label)meta.append(node('span','',label));
      card.append(main,meta,link(`admin.html?view=session&id=${encodeURIComponent(item.id)}`,
        'mini-action','التفاصيل'));section.append(card);
    }content.append(section);
  }
}
function renderSessionDetail(id){
  if(!state.history&&!state.historyLoading){state.historyLoading=true;
    repository.loadHistory().then(data=>{state.history=data;state.historyLoading=false;
      if(route().view==='session'){content.replaceChildren();renderSessionDetail(id);}})
      .catch(()=>{state.historyError=true;state.historyLoading=false;
        if(route().view==='session'){content.replaceChildren();renderSessionDetail(id);}});
  }
  if(state.historyLoading){content.append(createLoader({label:'جارٍ تحميل تفاصيل الجلسة…'}));return;}
  if(state.historyError){content.append(node('div','error-panel','تعذّر تحميل تفاصيل الجلسة.'));return;}
  const session=state.history?.sessions.find(s=>s.id===id)||
    (state.data.sessions||[]).find(s=>s.id===id);
  if(!session){renderNotFound('لا توجد جلسة بهذا المعرّف ضمن السجل المتاح.');return;}
  const room=state.data.rooms.find(r=>r.id===session.room_id);
  const staff=state.data.staff.find(s=>s.user_id===session.gm_user_id);
  content.append(link('admin.html?view=history','subtle-button room-back','→ سجل الجلسات'),
    heading('',room?roomName(room):session.room_id,''));
  const summary=panel('ملخص الجلسة');const info=node('div','detail-meta');
  const duration=activeDuration(state.history?.eventMap.get(id)||[],session);
  const durationLabel=duration.seconds===null?'غير قابلة للحساب من الأحداث':
    `${Math.floor(duration.seconds/60)} دقيقة${duration.precise?'':' · تقديرية'}`;
  for(const [label,value] of [['مدير اللعبة',staff?.display_name||staff?.login_name||staff?.email||'غير متاح'],
    ['الحالة',sessionOutcome(session)],['البدء',fmtDateTime(session.started_at)],
    ['النهاية',fmtDateTime(session.ended_at)],['مدة اللعب الفعلية',durationLabel]])
    info.append(detailField(label,value));
  summary.wrap.append(info);content.append(summary.wrap);
  const events=panel('سجل الأحداث','الأحداث المسجلة أثناء اللعب');
  const holder=node('div','panel-body');holder.append(createLoader({label:'جارٍ تحميل الأحداث…',size:56}));
  events.wrap.append(holder);content.append(events.wrap);
  repository.listEvents(id).then(rows=>{
    if(!holder.isConnected)return;holder.replaceChildren();
    if(!rows.length){holder.append(node('p','panel-empty','لا توجد أحداث مسجلة.'));return;}
    const labels={created:'إنشاء الجلسة',start:'بدء المؤقت',pause:'إيقاف مؤقت',resume:'استئناف',
      adjust:'تعديل الوقت',hint:'تلميح',image:'صورة',video:'فيديو',scale:'حجم الصورة',
      signal:'إشارة صوتية',win:'فوز',lose:'خسارة',timeout:'انتهاء الوقت',expired:'انتهاء الصلاحية'};
    const list=node('ol','detail-list');for(const event of rows){const item=node('li');
      item.append(node('span','',fmtDateTime(event.created_at)),
        node('strong','',labels[event.event_type]||event.event_type));
      if(event.event_type==='hint'&&event.payload?.text)item.append(node('span','detail-text',event.payload.text));
      list.append(item);}holder.append(list);
  }).catch(()=>{if(holder.isConnected)holder.textContent='تعذّر تحميل سجل الأحداث.';});
}

function staffRoomChoices(form,selected=[]){
  const list=node('fieldset','staff-room-choices');list.append(node('legend','','الغرف المسموح بها'));
  for(const room of state.data.rooms.filter(r=>r.isActive)){
    const input=node('input');input.type='checkbox';input.value=room.id;input.checked=selected.includes(room.id);
    list.append(field(roomName(room),input));
  }
  form.append(list);return list;
}
function showStaffEditor(person=null){
  showDialog(person?'إدارة عضو الفريق':'إضافة عضو فريق',(form,dialog)=>{
    let email=null,username=null,accountType=null;
    if(!person){
      accountType=node('select','admin-select');
      for(const [value,label] of [['operator','حساب تشغيلي باسم مستخدم'],['email','دعوة عبر بريد موثّق']]){
        const option=node('option','',label);option.value=value;accountType.append(option);}
      form.append(field('طريقة الدخول',accountType));
      username=node('input','admin-input');username.type='text';username.dir='ltr';
      username.pattern='[a-z][a-z0-9._-]{2,63}';username.placeholder='gamemaster';
      const usernameWrap=field('اسم المستخدم · ‎@ahaji.com',username);
      email=node('input','admin-input');email.type='email';email.dir='ltr';
      const emailWrap=field('البريد الإلكتروني',email);
      form.append(usernameWrap,emailWrap);
      accountType.addEventListener('change',()=>{
        const operator=accountType.value==='operator';usernameWrap.hidden=!operator;
        emailWrap.hidden=operator;username.required=operator;email.required=!operator;
        role.disabled=operator;if(operator)role.value='game_master';syncRooms();
      });
    }else form.append(node('p','staff-email',person.account_type==='operator'
      ? `${person.login_name}@ahaji.com`:person.email));
    const role=node('select','admin-select');
    for(const [value,label] of [['game_master','مدير لعبة'],['admin','مدير']]){
      const option=node('option','',label);option.value=value;role.append(option);}
    if(person?.account_type==='operator')role.querySelector('[value=admin]').remove();
    role.value=person?.role||'game_master';form.append(field('الدور',role));
    const active=node('input');active.type='checkbox';active.checked=person?.active??true;
    if(person)form.append(field('الحساب نشط',active));
    const rooms=staffRoomChoices(form,person?.room_ids||[]);
    const syncRooms=()=>{rooms.hidden=role.value==='admin';};role.addEventListener('change',syncRooms);syncRooms();
    if(accountType)accountType.dispatchEvent(new Event('change'));
    const save=button(person?'حفظ الصلاحيات':'إنشاء الحساب','button-dark');save.type='submit';form.append(save);
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;
      const roomIds=role.value==='admin'?[]:[...rooms.querySelectorAll('input:checked')].map(x=>x.value);
      try{
        if(person){const {error}=await supabase.rpc('admin_manage_staff',{
          p_user_id:person.user_id,p_role:role.value,p_active:active.checked,p_room_ids:roomIds});
          if(error)throw error;
        }else if(accountType.value==='operator'){
          const {data,error}=await supabase.functions.invoke('operator-account',{
            body:{action:'create',username:username.value.trim(),room_ids:roomIds}});
          if(error||data?.error)throw new Error(data?.error||error?.message||'تعذّر إنشاء الحساب.');
          await refresh();save.hidden=true;
          const secret=node('div','operator-credentials');
          secret.append(node('strong','','بيانات الدخول · تظهر مرة واحدة'),
            detailAccount('اسم المستخدم',data.username,true),
            detailAccount('كلمة المرور المؤقتة',data.password,true),
            node('p','account-note','سلّم كلمة المرور للموظف عبر قناة آمنة. لا توجد رسائل بريد أو استعادة بريدية لهذا الحساب.'));
          form.append(secret);return;
        }else{
          const {data,error}=await supabase.functions.invoke('staff-invite',{
            body:{email:email.value.trim(),role:role.value,room_ids:roomIds}});
          if(error)throw error;if(data?.error)throw new Error(data.error);
        }
        dialog.close();await refresh();
      }catch(error){formStatus(form,error.message||'تعذّر حفظ بيانات الفريق.');save.disabled=false;}
    });
  });
}
function resetOperator(person){
  if(!confirm(`إعادة تعيين كلمة مرور ${person.login_name}@ahaji.com؟ ستُلغى الجلسات الحالية.`))return;
  showDialog('إعادة تعيين كلمة المرور',(form,dialog)=>{
    const result=node('div','operator-credentials');
    result.append(node('p','','جارٍ إنشاء كلمة مرور جديدة…'));
    form.append(result);
    supabase.functions.invoke('operator-account',{body:{action:'reset',user_id:person.user_id}})
      .then(({data,error})=>{
        if(error||data?.error)throw new Error(data?.error||error?.message);
        result.replaceChildren(node('strong','','كلمة المرور الجديدة'),
          detailAccount('اسم المستخدم',`${person.login_name}@ahaji.com`,true),
          detailAccount('كلمة المرور',data.password,true),
          node('p','account-note','انسخها الآن وسلّمها للموظف عبر قناة آمنة. لن تُعرض مجدداً.'));
      }).catch(error=>{formStatus(form,error.message||'تعذّرت إعادة التعيين.');});
  });
}
async function resendInvite(person){
  if(!confirm(`إعادة إرسال دعوة إلى ${person.email}؟`))return;
  const {data,error}=await supabase.functions.invoke('staff-invite',{
    body:{email:person.email,role:person.role,room_ids:person.room_ids||[]}});
  if(error||data?.error)alert(data?.error||error?.message||'تعذّرت إعادة الدعوة. يمكن للعضو استخدام استعادة كلمة المرور.');
  else{alert('أُرسلت الدعوة مجدداً.');await refresh();}
}

function renderAccount() {
  const access=state.access;
  content.append(heading('','حسابـــي',''));
  const grid=node('div','account-layout');
  const profile=node('section','panel account-card');
  const profileHeader = node('div','account-profile-heading');
  const identity=node('div','account-profile-identity');
  identity.append(node('strong','',profileName(access.user,access.profile)||'حسابي'),rolePill(access.role));
  const avatar=node('span','admin-avatar account-avatar',profileInitial(access.user,access.profile));
  const currentAvatar=profileAvatarUrl(access.profile?.avatar_ref);
  if(currentAvatar){avatar.style.backgroundImage=`url("${currentAvatar}")`;avatar.textContent='';}
  profileHeader.append(avatar,identity);
  profile.append(profileHeader);
  const editProfile=node('form','profile-edit-form');
  const displayName=node('input','admin-input');displayName.type='text';displayName.maxLength=80;
  displayName.value=access.profile?.display_name||'';displayName.placeholder='الاسم الذي يراه الفريق';
  const avatarInput=node('input','upload-native');avatarInput.type='file';
  avatarInput.accept='image/jpeg,image/png,image/webp';
  avatarInput.tabIndex=-1;avatarInput.setAttribute('aria-hidden','true');
  const avatarPick=button(currentAvatar?'استبدال الصورة':'اختيار صورة','upload-choose');
  avatarPick.addEventListener('click',()=>avatarInput.click());
  const avatarRemove=button('إزالة الصورة','mini-action danger');avatarRemove.hidden=!currentAvatar;
  const avatarPreview=node('div','upload-preview');let previewUrl='',removeAvatar=false;
  const drawAvatar=()=>{avatarPreview.replaceChildren();
    const src=previewUrl||(!removeAvatar?currentAvatar:'');
    if(src){const img=node('img');img.src=src;img.alt='معاينة الصورة الشخصية';avatarPreview.append(img);}};
  drawAvatar();
  avatarInput.addEventListener('change',()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);
    const file=avatarInput.files?.[0];previewUrl=file?URL.createObjectURL(file):'';
    removeAvatar=false;avatarRemove.hidden=!file&&!currentAvatar;drawAvatar();});
  avatarRemove.addEventListener('click',()=>{avatarInput.value='';if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl='';removeAvatar=true;avatarRemove.hidden=true;drawAvatar();});
  const avatarControls=node('div','upload-actions');avatarControls.append(avatarPick,avatarRemove,avatarInput);
  const avatarField=node('div','upload-control');avatarField.append(node('strong','','الصورة الشخصية'),
    node('small','field-note','JPG، PNG أو WebP · حتى 2 ميغابايت'),avatarControls,avatarPreview);
  const profileSave=button('حفظ الملف الشخصي','button-dark');profileSave.type='submit';
  editProfile.append(field('الاسم الظاهر',displayName),avatarField,profileSave);
  profile.append(editProfile);
  editProfile.addEventListener('submit',async event=>{event.preventDefault();profileSave.disabled=true;
    let newRef=null;
    try{
      const file=avatarInput.files?.[0];
      if(file){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2*1024*1024)
        throw new Error('اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 2 ميغابايت.');
        const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
        const path=`${access.user.id}/${crypto.randomUUID()}.${ext}`;
        const upload=await supabase.storage.from('profile-assets').upload(path,file,
          {contentType:file.type,upsert:false});if(upload.error)throw upload.error;
        newRef=`storage://profile-assets/${path}`;
      }
      const avatarRef=newRef||(!removeAvatar?access.profile?.avatar_ref:null)||null;
      const {error}=await supabase.from('staff_profiles').upsert({
        user_id:access.user.id,display_name:displayName.value.trim(),avatar_ref:avatarRef,
      },{onConflict:'user_id'});
      if(error)throw error;
      if((newRef||removeAvatar)&&access.profile?.avatar_ref){
        const path=access.profile.avatar_ref.slice('storage://profile-assets/'.length);
        await supabase.storage.from('profile-assets').remove([path]).catch(()=>{});
      }
      if(previewUrl)URL.revokeObjectURL(previewUrl);
      await verifyAccess({force:true});render();await loadData();
    }catch(error){
      if(newRef)await supabase.storage.from('profile-assets')
        .remove([newRef.slice('storage://profile-assets/'.length)]).catch(()=>{});
      formStatus(editProfile,error.message||'تعذّر حفظ الملف الشخصي.');profileSave.disabled=false;
    }
  });
  if(access.accountType==='email'){
    if(profileName(access.user,access.profile)!==access.user.email)
      profile.append(detailAccount('البريد الإلكتروني',access.user.email||'غير متاح',true));
    profile.append(detailAccount('حالة البريد',access.user.email_confirmed_at?'موثّق':'بانتظار التوثيق'));
  }
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
  const actions=node('div','account-actions');
  actions.append(change,security);
  grid.append(profile,actions);content.append(grid);
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
  const section=['room','new-room','edit-room'].includes(view)?'rooms':view==='session'?'history':view;
  document.querySelectorAll('[data-nav]').forEach(item=>{
    if(item.dataset.nav===section)item.setAttribute('aria-current','page');
    else item.removeAttribute('aria-current');
  });
  const titles={rooms:'الغرف',staff:'فريق العمل',account:'حسابي',room:'تفاصيل الغرفة',
    'new-room':'إضافة غرفة','edit-room':'تعديل الغرفة',history:'سجل الجلسات',session:'تفاصيل الجلسة'};
  let title=titles[view]||'صفحة غير موجودة';
  if(view==='room'){
    const room=state.data?.rooms.find(r=>r.id===id);
    if(room)title=roomName(room);
  }
  document.title=`${title} · أحاجي`;
}
function render(){
  workspaceCleanup?.();workspaceCleanup=null;
  const {view,id}=route();lastRenderedUrl=location.pathname+location.search;
  setNavigation(view,id);content.replaceChildren();
  adminMain.classList.toggle('rooms-scroll',['rooms','room','edit-room','new-room'].includes(view));
  content.classList.toggle('compact-content',view==='rooms'||view==='staff'||view==='account');
  if(view==='account' && state.access){renderAccount();return;}
  if(state.error){
    const box=node('div','error-panel');
    box.append(node('h2','','تعذّر تحميل البيانات'),
      node('p','','تعذّر الاتصال بقاعدة البيانات. تحقّق من اتصالك ثم أعد المحاولة.'));
    const retry=button('إعادة المحاولة','button-dark');retry.addEventListener('click',loadData);box.append(retry);content.append(box);
    return;
  }
  if(!state.data){
    const labels={rooms:'جارٍ تحميل الغرف…',room:'جارٍ تحميل مساحة الغرفة…','edit-room':'جارٍ تحميل مساحة الغرفة…',
      'new-room':'جارٍ تجهيز غرفة جديدة…',staff:'جارٍ تحميل فريق العمل…',history:'جارٍ تحميل سجل الجلسات…',
      session:'جارٍ تحميل تفاصيل الجلسة…'};
    content.append(createLoader({label:labels[view]||'جارٍ تحميل لوحة الإدارة…'}));return;
  }
  if(view==='rooms')renderRooms();
  else if(view==='room'||view==='edit-room'){
    const room=state.data.rooms.find(item=>item.id===id);
    if(room){
      if(!workspaceDraft||workspaceDraft.roomId!==room.id)workspaceDraft=createRoomDraft(room);
      workspaceCleanup=renderRoomWorkspace({draft:workspaceDraft,container:content,
        onSave:saveCurrentDraft,onDiscard:discardCurrentDraft,rerender:render});
    }
    else renderNotFound('لم نتمكن من العثور على هذه الغرفة.');
  }
  else if(view==='new-room'){
    if(!workspaceDraft||workspaceDraft.roomId)workspaceDraft=createRoomDraft();
    workspaceCleanup=renderRoomWorkspace({draft:workspaceDraft,container:content,
      onSave:saveCurrentDraft,onDiscard:discardCurrentDraft,rerender:render});
  }
  else if(view==='staff')renderStaff();
  else if(view==='history')renderHistory();
  else if(view==='session')renderSessionDetail(id);
  else renderNotFound('هذا الرابط لا يشير إلى صفحة في لوحة الإدارة.');
}
function sameWorkspace(url){
  if(!workspaceDraft)return false;
  const params=url.searchParams,view=params.get('view');
  return workspaceDraft.roomId
    ?(['room','edit-room'].includes(view)&&params.get('id')===workspaceDraft.roomId)
    :view==='new-room';
}
async function discardCurrentDraft(){
  if(!workspaceDraft?.isDirty())return;
  if(!confirm('تجاهل جميع التغييرات غير المحفوظة في هذه الغرفة؟'))return;
  const draft=workspaceDraft;
  if(draft.roomId){
    try{
      const latest=await repository.getRoom(draft.roomId);
      if(!latest)throw new Error('لم نتمكن من تحميل الغرفة.');
      draft.resetFrom(latest);
      const index=state.data?.rooms.findIndex(room=>room.id===draft.roomId)??-1;
      if(index>=0)state.data.rooms[index]=latest;
    }catch(error){draft.setStatus(error.message||'تعذّر تحميل أحدث بيانات الغرفة.',true);return;}
  }else draft.discard();
  render();
}
async function saveCurrentDraft(){
  const draft=workspaceDraft;
  if(!draft||draft.saving||draft.locked)return false;
  if(!draft.isDirty())return true;
  const values=draft.general;
  if(!values.name.trim()){draft.setStatus('اكتب اسم الغرفة.',true);return false;}
  if(!Number.isInteger(values.durationSeconds)||values.durationSeconds<60||
    values.durationSeconds>5940){draft.setStatus('مدة اللعبة يجب أن تكون بين دقيقة و99 دقيقة.',true);return false;}
  const stagedRefs=[],uploaded=new Map();
  draft.setSaving(true);
  let roomId=draft.roomId,created=false,committed=false;
  try{
    if(!roomId){
      roomId=await repository.createRoomForName({
        name:values.name.trim(),description:values.description.trim(),
        default_duration_seconds:values.durationSeconds,
        is_active:false,presentation_settings:values.presentation,
        thumbnail_ref:'images/ahajilogo.svg',background_ref:'images/ahajilogo.svg'
      });
      created=true;
    }
    for(const entry of draft.uploadEntries()){
      const ref=await repository.uploadAsset(roomId,entry.file);
      stagedRefs.push(ref);uploaded.set(entry.kind==='image'?'image':entry.id,ref);
    }
    const payload=draft.payload(uploaded);
    if(created){
      await repository.updateRoom(roomId,{
        name:payload.room.name,description:payload.room.description,
        default_duration_seconds:payload.room.durationSeconds,
        is_active:payload.room.active,
        presentation_settings:payload.room.presentation,
        thumbnail_ref:payload.room.imageRef,background_ref:payload.room.imageRef
      });
      draft.markCommitted(0);
    }else{
      const result=await repository.saveRoomDraft(roomId,draft.revision,payload);
      draft.markCommitted(result.revision);
    }
    committed=true;
    const savedRoom=await repository.getRoom(roomId);
    if(!savedRoom)throw new Error('حُفظت البيانات لكن تعذّر تحديث عرض الغرفة. أعد تحميل الصفحة.');
    if(state.data){
      state.data.rooms=state.data.rooms.filter(room=>room.id!==roomId);
      state.data.rooms.push(savedRoom);
      state.data.rooms.sort((a,b)=>a.displayOrder-b.displayOrder||a.id.localeCompare(b.id));
    }
    if(created){
      workspaceDraft=createRoomDraft(savedRoom);
      workspaceDraft.setStatus('أُنشئت الغرفة وحُفظت التغييرات.');
      history.replaceState(null,'',`admin.html?view=room&id=${encodeURIComponent(roomId)}&tab=settings`);
    }else draft.resetFrom(savedRoom);
    render();return true;
  }catch(error){
    if(!committed){
      const cleanup=await Promise.allSettled(stagedRefs.map(ref=>repository.removeAsset(ref)));
      if(created)await repository.deleteNewRoom(roomId).catch(()=>{});
      const incomplete=cleanup.some(result=>result.status==='rejected');
      draft.setSaving(false);
      const conflict=error.code==='40001';
      draft.setStatus(conflict
        ?'عدّل مدير آخر هذه الغرفة. لم يُحفظ شيء. احتفظ بمسودتك أو تجاهلها لتحميل أحدث نسخة.'
        :`${error.message||'تعذّر الحفظ.'}${incomplete?' تعذّر تنظيف بعض الملفات المرفوعة؛ راجع التخزين.':''}`,true);
    }else{
      draft.setStatus('حُفظت البيانات، لكن تعذّر تحديث عرض الغرفة. أعد تحميل الصفحة قبل تعديلها مجدداً.',true);
    }
    return false;
  }
}
function leaveDialog(continueTo){
  const {dialog,form}=showDialog('تغييرات غير محفوظة',(form,dialog)=>{
    form.append(node('p','leave-draft-copy','لديك تغييرات في هذه الغرفة لم تُحفظ بعد.'),
      node('p','leave-draft-copy','يمكنك حفظها أولاً، أو تجاهلها، أو البقاء لإكمال التعديل.'));
    const actions=node('div','leave-draft-actions');
    const save=button('حفظ التغييرات والمغادرة','button-dark');
    const discard=button('تجاهل التغييرات','mini-action danger');
    const stay=button('البقاء في الصفحة','mini-action');
    save.addEventListener('click',async()=>{
      save.disabled=true;discard.disabled=true;stay.disabled=true;
      if(await saveCurrentDraft()){dialog.close();continueTo();}
      else{save.disabled=false;discard.disabled=false;stay.disabled=false;}
    });
    discard.addEventListener('click',()=>{
      workspaceDraft?.discard();workspaceDraft=null;dialog.close();continueTo();
    });
    stay.addEventListener('click',()=>dialog.close());
    actions.append(save,discard,stay);form.append(actions);
  });
  dialog.addEventListener('cancel',event=>{
    if(workspaceDraft?.saving)event.preventDefault();
  });
  return dialog;
}
function navigate(href){
  const url=new URL(href,location.href);
  if(workspaceDraft?.saving||workspaceDraft?.locked){
    workspaceDraft.setStatus('انتظر حتى يكتمل الحفظ قبل المغادرة.');return;
  }
  const go=()=>{
    if(!sameWorkspace(url))workspaceDraft=null;
    history.pushState(null,'',url.pathname+url.search);closeMenu();render();
    verifyAccess();content.focus({preventScroll:true});adminMain.scrollTo(0,0);
  };
  if(workspaceDraft?.isDirty()&&!sameWorkspace(url))leaveDialog(go);
  else go();
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
  navigate(target.href);
});
window.addEventListener('popstate',()=>{
  const target=location.pathname+location.search;
  const targetUrl=new URL(target,location.origin);
  if(workspaceDraft?.saving||workspaceDraft?.locked){
    history.pushState(null,'',lastRenderedUrl);
    workspaceDraft.setStatus('انتظر حتى يكتمل الحفظ قبل المغادرة.');return;
  }
  if(workspaceDraft?.isDirty()&&!sameWorkspace(targetUrl)){
    history.pushState(null,'',lastRenderedUrl);
    leaveDialog(()=>{workspaceDraft=null;history.back();});
    return;
  }
  if(!sameWorkspace(targetUrl))workspaceDraft=null;
  closeMenu();
  render();verifyAccess();
});
window.addEventListener('beforeunload',event=>{
  if(workspaceDraft?.isDirty()){
    event.preventDefault();
    event.returnValue='';
  }
});

async function loadData(){
  if(state.loading)return;
  state.loading=true;
  // Keep showing current data during a refresh; the loader covers only first load or retry.
  if(!state.data||state.error){state.error=false;state.data=null;if(route().view!=='account')render();}
  try{state.data=await repository.load();state.error=false;if(route().view!=='account')render();}
  catch{
    state.error=true;if(route().view!=='account')render();
  } finally{state.loading=false;}
}
async function verifyAccess({force=false}={}){
  if(!force&&state.access&&Date.now()-lastVerifiedAt<ACCESS_RECHECK_MS)return true;
  const requestId=++accessRequestId;
  try{
    const previous=state.access;
    const access=await currentAccess();
    if(requestId!==accessRequestId)return false;
    if(!access){location.replace(`login.html?next=${encodeURIComponent(location.pathname.slice(1)+location.search)}`);return false;}
    if(access.role!=='admin'){state.data=null;location.replace('unauthorized.html?reason=admin');return false;}
    state.access=access;lastVerifiedAt=Date.now();
    const avatar=profileAvatarUrl(access.profile?.avatar_ref);
    const sidebarAvatar=document.getElementById('sidebar-avatar');
    sidebarAvatar.textContent=avatar?'':profileInitial(access.user,access.profile);
    sidebarAvatar.style.backgroundImage=avatar?`url("${avatar}")`:'';
    const name=profileName(access.user,access.profile);
    document.getElementById('sidebar-name').textContent=name===access.user.email?'مدير':name||'مدير';
    document.getElementById('sidebar-email').textContent=access.user.email||'';
    gate.hidden=true;gateError.hidden=true;shell.hidden=false;
    const identityChanged=previous && (
      previous.user.id!==access.user.id || previous.user.email!==access.user.email ||
      previous.user.email_confirmed_at!==access.user.email_confirmed_at ||
      profileName(previous.user,previous.profile)!==profileName(access.user,access.profile) ||
      previous.profile?.avatar_ref!==access.profile?.avatar_ref);
    if(route().view==='account' && (identityChanged || content.querySelector('[data-loader]') || !content.hasChildNodes()))render();
    return true;
  }catch(error){
    console.error('Admin access verification failed',error);
    if(requestId!==accessRequestId)return false;
    if(!state.access){gate.hidden=true;gateError.hidden=false;}
    else{state.data=null;state.error=true;render();}
    return false;
  }
}
document.getElementById('admin-auth-retry').addEventListener('click',async()=>{
  gateError.hidden=true;gate.hidden=false;if(await verifyAccess({force:true}))await loadData();
});
document.getElementById('admin-logout').addEventListener('click',async event=>{
  if(workspaceDraft?.saving||workspaceDraft?.locked){
    workspaceDraft.setStatus('انتظر حتى يكتمل الحفظ قبل المغادرة.');return;
  }
  const action=async()=>{
    event.currentTarget.disabled=true;
    try{await supabase.auth.signOut();location.replace('login.html');}
    catch{event.currentTarget.disabled=false;}
  };
  if(workspaceDraft?.isDirty())leaveDialog(action);
  else await action();
});
supabase.auth.onAuthStateChange(event=>{
  if(event==='SIGNED_OUT')location.replace('login.html');
  if(event==='TOKEN_REFRESHED'||event==='USER_UPDATED')setTimeout(()=>verifyAccess({force:true}),0);
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)verifyAccess();});
const initialRoute=route();
setNavigation(initialRoute.view,initialRoute.id);
if(await verifyAccess({force:true}))await loadData();
