import { supabase, currentAccess } from '../auth/client.mjs';
import { createAdminRepository } from '../data/admin-repository.mjs?v=full-delivery-3';
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
const roomName = room => room.name;
const mediaKinds = {
  hint_sound: 'صوت التلميح', lose_sound: 'صوت الخسارة',
  lose_video: 'فيديو الخسارة', gm_image: 'صورة', gm_sound: 'مؤثر صوتي', gm_video: 'فيديو'
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
  if (typeof ref === 'string' && ref.startsWith('storage://room-assets/')) {
    const path=ref.slice('storage://room-assets/'.length);
    if(!/^[a-z][a-z0-9_-]{0,63}\/[A-Za-z0-9._-]+$/.test(path))return null;
    return supabase.storage.from('room-assets').getPublicUrl(path).data.publicUrl;
  }
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
function fmtDateTime(value){if(!value)return '—';const date=new Date(value);
  return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('ar-SA',
    {dateStyle:'medium',timeStyle:'short',numberingSystem:'latn'}).format(date);}
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
  const add=button('＋ إضافة غرفة','button-dark');
  add.addEventListener('click',()=>navigate('admin.html?view=new-room'));
  content.append(heading('إدارة الغرف','الغرف','إعداد الغرف ومحتواها وتشغيلها.',add));
  const grid = node('div','room-grid-admin');
  if (!rooms.length) {
    const empty = node('div','empty-box');
    empty.append(node('strong','','لا توجد غرف بعد'),node('span','','ستظهر الغرف هنا عند إعدادها.'));
    grid.append(empty);
  } else rooms.forEach(room => grid.append(roomTile(room)));
  const addTile=button('＋  إضافة غرفة','room-add-tile');
  addTile.addEventListener('click',()=>navigate('admin.html?view=new-room'));
  grid.append(addTile);
  content.append(grid);
}

function detailField(label, value) {
  const box = node('div'); box.append(node('small','',label),node('strong','',value)); return box;
}
function renderRoom(roomId) {
  const room = state.data.rooms.find(item => item.id === roomId);
  if (!room) { renderNotFound('لم نتمكن من العثور على هذه الغرفة في قاعدة البيانات.'); return; }
  const back = link('admin.html?view=rooms','subtle-button room-back','→  جميع الغرف');
  const edit=button('تعديل الغرفة','button-dark');
  edit.addEventListener('click',()=>navigate(`admin.html?view=edit-room&id=${encodeURIComponent(roomId)}`));
  content.append(back, heading('تفاصيل الغرفة',roomName(room),room.description||'إعدادات الغرفة ومحتواها',edit));
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
  const addHint=button('＋ تلميح','subtle-button');
  addHint.addEventListener('click',()=>showHintEditor(room,null));
  hints.head.append(addHint);
  const hintsList = node('ol','detail-list');
  if (!room.hints.length) hints.wrap.append(node('p','panel-empty','لا توجد تلميحات نصية لهذه الغرفة.'));
  room.hints.forEach((hint,index) => {
    const item = node('li');
    const copy = node('span','detail-text',hint.text); copy.dir = 'auto';
    item.append(node('span','item-index',String(index+1).padStart(2,'0')),copy);
    const actions=node('span','item-actions');
    const editHint=button('تعديل','mini-action');editHint.addEventListener('click',()=>showHintEditor(room,hint));
    const delHint=button('حذف','mini-action danger');delHint.addEventListener('click',()=>removeHint(room,hint));
    actions.append(editHint,delHint);
    if(index>0){const up=button('↑','mini-action');up.setAttribute('aria-label','رفع التلميح');up.addEventListener('click',()=>moveHint(room,index,-1));actions.append(up);}
    if(index<room.hints.length-1){const down=button('↓','mini-action');down.setAttribute('aria-label','خفض التلميح');down.addEventListener('click',()=>moveHint(room,index,1));actions.append(down);}
    item.append(actions);hintsList.append(item);
  });
  if (room.hints.length) { const padding = node('div','panel-body'); padding.append(hintsList); hints.wrap.append(padding); }
  const media = panel('مكتبة الوسائط',`${room.mediaRecords.length} ملف`);
  const addMedia=button('＋ ملف','subtle-button');addMedia.addEventListener('click',()=>showMediaEditor(room));media.head.append(addMedia);
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
      const actions=node('span','item-actions');
      const replace=button('استبدال','mini-action');replace.addEventListener('click',()=>replaceMedia(room,record));
      const remove=button('حذف','mini-action danger');remove.addEventListener('click',()=>removeMedia(room,record));
      actions.append(replace,remove);item.append(actions);
      list.append(item);
    }
    const padding = node('div','panel-body'); padding.append(list); media.wrap.append(padding);
  }
  columns.append(hints.wrap,media.wrap); content.append(columns);
  if(room.isActive){
    const archive=button('أرشفة الغرفة','subtle-button danger-button');
    archive.addEventListener('click',()=>archiveRoom(room));
    content.append(node('div','room-danger-zone'));content.lastElementChild.append(archive);
  }
}

function showDialog(title,build) {
  const dialog=node('dialog','admin-dialog');
  const form=node('form','admin-dialog-form');form.method='dialog';
  const head=node('div','admin-dialog-head');head.append(node('h2','',title));
  const close=button('✕','mini-action');close.setAttribute('aria-label','إغلاق');close.addEventListener('click',()=>dialog.close());head.append(close);
  form.append(head);build(form,dialog);
  dialog.append(form);document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  return {dialog,form};
}
function field(label,control){const wrap=node('label','form-field');wrap.append(node('span','',label),control);return wrap;}
function formStatus(form,message,error=true){let status=form.querySelector('[data-form-status]');if(!status){status=node('p','form-message');status.dataset.formStatus='';status.setAttribute('role','status');form.append(status);}status.classList.toggle('error',error);status.textContent=message;}
async function refresh(){await loadData();}
function showHintEditor(room,hint){
  showDialog(hint?'تعديل التلميح':'إضافة تلميح',(form,dialog)=>{
    const text=node('textarea','admin-textarea');text.required=true;text.maxLength=2000;text.rows=5;text.value=hint?.text||'';
    form.append(field('نص التلميح',text));
    const save=button('حفظ التلميح','button-dark');save.type='submit';form.append(save);
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;
      try{await repository.saveHint(room.id,{id:hint?.id,text:text.value.trim(),displayOrder:Math.max(-1,...room.hints.map(h=>h.displayOrder))+1});dialog.close();await refresh();}
      catch(error){formStatus(form,error.message||'تعذّر حفظ التلميح.');save.disabled=false;}
    });
  });
}
async function removeHint(room,hint){
  if(!confirm('حذف هذا التلميح؟'))return;
  try{await repository.deleteHint(room.id,hint.id);await refresh();}
  catch(error){alert(error.message||'تعذّر حذف التلميح.');}
}
async function moveHint(room,index,direction){
  const ids=room.hints.map(h=>h.id);[ids[index],ids[index+direction]]=[ids[index+direction],ids[index]];
  try{await repository.reorderHints(room.id,ids);await refresh();}
  catch(error){alert(error.message||'تعذّر تغيير ترتيب التلميحات.');}
}
function mediaAccept(kind){return kind==='gm_image'?'image/jpeg,image/png,image/webp,image/gif':
  kind==='lose_video'||kind==='gm_video'?'video/mp4,video/webm':'audio/mpeg,audio/ogg,audio/wav,audio/mp4';}
function showMediaEditor(room){
  showDialog('إضافة ملف وسائط',(form,dialog)=>{
    const kind=node('select','admin-select');
    for(const [value,label] of Object.entries(mediaKinds)){const option=node('option','',label);option.value=value;kind.append(option);}
    kind.value='gm_image';
    const label=node('input','admin-input');label.required=true;label.maxLength=120;
    const file=node('input','admin-input');file.type='file';file.required=true;file.accept=mediaAccept(kind.value);
    kind.addEventListener('change',()=>{file.accept=mediaAccept(kind.value);file.value='';});
    form.append(field('نوع الملف',kind),field('اسم الملف',label),field('الملف · حتى 10 ميغابايت',file));
    const save=button('رفع وحفظ','button-dark');save.type='submit';form.append(save);
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;let ref=null;
      try{
        ref=await repository.uploadAsset(room.id,file.files[0]);
        const next=Math.max(-1,...room.mediaRecords.filter(x=>x.kind===kind.value).map(x=>x.displayOrder))+1;
        await repository.saveMedia(room.id,{kind:kind.value,label:label.value.trim(),assetRef:ref,displayOrder:next});
        dialog.close();await refresh();
      }catch(error){if(ref)await repository.removeAsset(ref).catch(()=>{});formStatus(form,error.message||'تعذّر حفظ الملف.');save.disabled=false;}
    });
  });
}
function replaceMedia(room,record){
  showDialog('استبدال الملف',(form,dialog)=>{
    const file=node('input','admin-input');file.type='file';file.required=true;file.accept=mediaAccept(record.kind);
    form.append(node('p','account-note',record.label||mediaKinds[record.kind]||'الملف'),field('الملف الجديد · حتى 10 ميغابايت',file));
    const save=button('استبدال','button-dark');save.type='submit';form.append(save);
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;let ref=null;
      try{ref=await repository.uploadAsset(room.id,file.files[0]);
        await repository.saveMedia(room.id,{...record,assetRef:ref});
        dialog.close();await repository.removeAsset(record.assetRef).catch(()=>{});await refresh();
      }catch(error){if(ref)await repository.removeAsset(ref).catch(()=>{});formStatus(form,error.message||'تعذّر استبدال الملف.');save.disabled=false;}
    });
  });
}
async function removeMedia(room,record){
  if(!confirm('حذف هذا الملف من مكتبة الغرفة؟'))return;
  try{await repository.deleteMedia(room.id,record.id);await repository.removeAsset(record.assetRef).catch(()=>{});await refresh();}
  catch(error){alert(error.message||'تعذّر حذف الملف.');}
}
async function archiveRoom(room){
  if(!confirm(`أرشفة غرفة ${roomName(room)}؟ ستبقى بياناتها وتاريخها محفوظة.`))return;
  try{await repository.updateRoom(room.id,{is_active:false});await refresh();}
  catch(error){alert(error.message||'تعذّرت أرشفة الغرفة. قد تكون هناك جلسة نشطة.');}
}
function renderRoomForm(roomId){
  const room=roomId?state.data.rooms.find(r=>r.id===roomId):null;
  if(roomId&&!room){renderNotFound('الغرفة غير موجودة.');return;}
  const creating=!room;
  content.append(heading('إدارة الغرف',creating?'إضافة غرفة':'تعديل الغرفة',
    creating?'أدخل البيانات الأساسية ثم أضف التلميحات والوسائط.':'تحديث بيانات الغرفة ومظهرها.'));
  const form=node('form','room-editor panel');
  const id=node('input','admin-input');id.required=true;id.pattern='[a-z][a-z0-9_-]{0,63}';id.maxLength=64;id.dir='ltr';id.value=room?.id||'';id.disabled=!creating;
  const name=node('input','admin-input');name.required=true;name.maxLength=120;name.value=room?.name||'';
  const description=node('textarea','admin-textarea');description.maxLength=2000;description.rows=3;description.value=room?.description||'';
  const duration=node('input','admin-input');duration.type='number';duration.min='1';duration.max='99';duration.required=true;duration.value=String(Math.round((room?.defaultDuration||3600)/60));
  const active=node('input');active.type='checkbox';active.checked=room?.isActive??true;
  const cover=node('input','admin-input');cover.type='file';cover.accept='image/jpeg,image/png,image/webp,image/gif';
  const background=node('input','admin-input');background.type='file';background.accept=cover.accept;
  form.append(field('معرّف الغرفة · أحرف لاتينية صغيرة',id),field('اسم الغرفة',name),field('الوصف',description),field('مدة اللعبة بالدقائق',duration),field('صورة الغلاف',cover),field('صورة الخلفية',background),field('الغرفة نشطة',active));
  const buttons=node('div','form-buttons');const save=button(creating?'إنشاء الغرفة':'حفظ التغييرات','button-dark');save.type='submit';
  buttons.append(save,link(creating?'admin.html?view=rooms':roomUrl(room),'subtle-button','إلغاء'));form.append(buttons);content.append(form);
  form.addEventListener('submit',async event=>{
    event.preventDefault();save.disabled=true;
    const roomKey=id.value.trim();const uploaded=[];let created=false;
    try{
      const values={name:name.value.trim(),description:description.value.trim(),
        default_duration_seconds:Number(duration.value)*60,is_active:active.checked};
      if(creating){await repository.createRoom({id:roomKey,...values,is_active:false,
        thumbnail_ref:'images/ahajilogo.svg',background_ref:'images/ahajilogo.svg'});created=true;}
      if(cover.files[0]){values.thumbnail_ref=await repository.uploadAsset(roomKey,cover.files[0]);uploaded.push(values.thumbnail_ref);}
      if(background.files[0]){values.background_ref=await repository.uploadAsset(roomKey,background.files[0]);uploaded.push(values.background_ref);}
      await repository.updateRoom(roomKey,values);
      for(const old of [cover.files[0]&&room?.thumbnail,background.files[0]&&room?.backgroundImage])
        if(old)await repository.removeAsset(old).catch(()=>{});
      navigate(roomUrl({id:roomKey}));await refresh();
    }catch(error){
      for(const ref of uploaded)await repository.removeAsset(ref).catch(()=>{});
      if(created)await repository.deleteNewRoom(roomKey).catch(()=>{});
      formStatus(form,error.message||'تعذّر حفظ الغرفة.');save.disabled=false;
    }
  });
}

function renderStaff() {
  const staff = state.data.staff;
  const rooms = new Map(state.data.rooms.map(room => [room.id,roomName(room)]));
  const invite=button('＋ دعوة عضو','button-dark');invite.addEventListener('click',()=>showStaffEditor());
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
      const statusCell=node('td');
      statusCell.append(!person.active?statusPill(false):person.email_confirmed?statusPill(true):
        node('span','status-pill pending','بانتظار توثيق البريد'));
      row.append(statusCell);
      const actionCell=node('td');const edit=button('إدارة','mini-action');
      edit.addEventListener('click',()=>showStaffEditor(person));actionCell.append(edit);
      if(!person.email_confirmed){const resend=button('إعادة الدعوة','mini-action');
        resend.addEventListener('click',()=>resendInvite(person));actionCell.append(resend);}
      row.append(actionCell);
      tbody.append(row);
    }
    table.append(tbody);wrap.append(table);panelData.wrap.append(wrap);
  }
  content.append(panelData.wrap);
}
function renderHistory(){
  const sessions=state.data.sessions||[];
  content.append(heading('العمليات','سجل الجلسات','الجلسات الفعلية المحفوظة في قاعدة البيانات.'));
  const data=panel('الجلسات',`${sessions.length} جلسة`);
  if(!sessions.length)data.wrap.append(node('p','panel-empty','لا توجد جلسات محفوظة بعد.'));
  else{
    const wrap=node('div','table-wrap');const table=node('table','staff-table history-table');
    const header=node('tr');for(const label of ['الغرفة','مدير اللعبة','البدء','النهاية','النتيجة','المدة',''])header.append(node('th','',label));
    const thead=node('thead');thead.append(header);table.append(thead);
    const tbody=node('tbody');
    for(const item of sessions){
      const row=node('tr');const room=state.data.rooms.find(r=>r.id===item.room_id);
      const staff=state.data.staff.find(s=>s.user_id===item.gm_user_id);
      for(const value of [room?roomName(room):item.room_id,staff?.email||'غير متاح',
        fmtDateTime(item.started_at),fmtDateTime(item.ended_at),sessionOutcome(item),sessionDuration(item)]){
        const cell=node('td','',value);if(value===sessionOutcome(item))cell.classList.add('history-outcome');row.append(cell);}
      const action=node('td');action.append(link(`admin.html?view=session&id=${encodeURIComponent(item.id)}`,'mini-action','التفاصيل'));row.append(action);
      tbody.append(row);
    }
    table.append(tbody);wrap.append(table);data.wrap.append(wrap);
  }
  content.append(data.wrap);
}
function renderSessionDetail(id){
  const session=(state.data.sessions||[]).find(s=>s.id===id);
  if(!session){renderNotFound('لا توجد جلسة بهذا المعرّف ضمن السجل المتاح.');return;}
  const room=state.data.rooms.find(r=>r.id===session.room_id);
  const staff=state.data.staff.find(s=>s.user_id===session.gm_user_id);
  content.append(link('admin.html?view=history','subtle-button room-back','→ سجل الجلسات'),
    heading('تفاصيل الجلسة',room?roomName(room):session.room_id,sessionOutcome(session)));
  const summary=panel('ملخص الجلسة');const info=node('div','detail-meta');
  for(const [label,value] of [['مدير اللعبة',staff?.email||'غير متاح'],['البدء',fmtDateTime(session.started_at)],
    ['النهاية',fmtDateTime(session.ended_at)],['المدة',sessionDuration(session)]])info.append(detailField(label,value));
  summary.wrap.append(info);content.append(summary.wrap);
  const events=panel('سجل الأحداث','الأحداث المسجلة أثناء اللعب');
  const holder=node('div','panel-body loading-panel','جارٍ تحميل الأحداث…');events.wrap.append(holder);content.append(events.wrap);
  repository.listEvents(id).then(rows=>{
    if(!holder.isConnected)return;holder.replaceChildren();holder.classList.remove('loading-panel');
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
  showDialog(person?'إدارة عضو الفريق':'دعوة عضو جديد',(form,dialog)=>{
    let email=null;
    if(!person){email=node('input','admin-input');email.type='email';email.dir='ltr';email.required=true;
      form.append(field('البريد الإلكتروني',email));}
    else form.append(node('p','staff-email',person.email));
    const role=node('select','admin-select');
    for(const [value,label] of [['game_master','مدير لعبة'],['admin','مدير']]){
      const option=node('option','',label);option.value=value;role.append(option);}
    role.value=person?.role||'game_master';form.append(field('الدور',role));
    const active=node('input');active.type='checkbox';active.checked=person?.active??true;
    if(person)form.append(field('الحساب نشط',active));
    const rooms=staffRoomChoices(form,person?.room_ids||[]);
    const syncRooms=()=>{rooms.hidden=role.value==='admin';};role.addEventListener('change',syncRooms);syncRooms();
    const save=button(person?'حفظ الصلاحيات':'إرسال الدعوة','button-dark');save.type='submit';form.append(save);
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;
      const roomIds=role.value==='admin'?[]:[...rooms.querySelectorAll('input:checked')].map(x=>x.value);
      try{
        if(person){const {error}=await supabase.rpc('admin_manage_staff',{
          p_user_id:person.user_id,p_role:role.value,p_active:active.checked,p_room_ids:roomIds});
          if(error)throw error;
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
async function resendInvite(person){
  if(!confirm(`إعادة إرسال دعوة إلى ${person.email}؟`))return;
  const {data,error}=await supabase.functions.invoke('staff-invite',{
    body:{email:person.email,role:person.role,room_ids:person.room_ids||[]}});
  if(error||data?.error)alert(data?.error||error?.message||'تعذّرت إعادة الدعوة. يمكن للعضو استخدام استعادة كلمة المرور.');
  else{alert('أُرسلت الدعوة مجدداً.');await refresh();}
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
  breadcrumbs.replaceChildren();
  const titles={rooms:'الغرف',staff:'فريق العمل',account:'حسابي',room:'تفاصيل الغرفة',
    'new-room':'إضافة غرفة','edit-room':'تعديل الغرفة',history:'سجل الجلسات',session:'تفاصيل الجلسة'};
  let title=titles[view]||'صفحة غير موجودة';
  if(view==='room'){
    const room=state.data?.rooms.find(r=>r.id===id);
    if(room)title=roomName(room);
  }
  const displayTitles={rooms:'الغـــرف',staff:'فريق العمـــل',account:'حسابـــي'};
  const visibleTitle=node('strong','page-title',displayTitles[view]||title);
  visibleTitle.setAttribute('aria-hidden','true');
  breadcrumbs.append(visibleTitle,node('span','sr-only',title));
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
  else if(view==='new-room')renderRoomForm(null);
  else if(view==='edit-room')renderRoomForm(id);
  else if(view==='staff')renderStaff();
  else if(view==='history')renderHistory();
  else if(view==='session')renderSessionDetail(id);
  else renderNotFound('هذا الرابط لا يشير إلى صفحة في لوحة الإدارة.');
}
function navigate(href){
  const url=new URL(href,location.href);
  history.pushState(null,'',url.pathname+url.search);closeMenu();render();
  content.focus({preventScroll:true});window.scrollTo(0,0);
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
