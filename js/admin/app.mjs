import { supabase, currentAccess } from '../auth/client.mjs';
import { createAdminRepository } from '../data/admin-repository.mjs';

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
  item.loading = 'lazy';
  item.onerror = () => { item.replaceWith(node('span', `${className} mini-thumb-fallback`, '◇')); };
  return item;
}
function statusPill(active) {
  const item = node('span', `status-pill ${active ? 'active' : 'inactive'}`);
  item.append(node('span', 'status-dot'), document.createTextNode(active ? 'Active' : 'Inactive'));
  return item;
}
function rolePill(role) {
  return node('span', `role-pill ${role === 'admin' ? 'admin' : 'game_master'}`,
    role === 'admin' ? 'Admin' : 'Game Master');
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
  return `${minutes} min`;
}
function fmtDate(value) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(date);
}
function roomUrl(room) { return `admin.html?view=room&id=${encodeURIComponent(room.id)}`; }
function roomSummary(room) { return `${room.hints.length} hints · ${room.mediaRecords.length} media`; }

function renderOverview() {
  const { rooms, staff } = state.data;
  const totalHints = rooms.reduce((sum, room) => sum + room.hints.length, 0);
  const totalMedia = rooms.reduce((sum, room) => sum + room.mediaRecords.length, 0);
  const activeStaff = staff.filter(person => person.active).length;
  content.append(heading('OPERATIONAL OVERVIEW', 'Your workspace',
    'A current view of room content and staff access from Ahaji’s database.',
    (() => { const item = button('↻  Refresh data'); item.addEventListener('click', loadData); return item; })()));
  const grid = node('div', 'metric-grid');
  for (const [label, value, note] of [
    ['Rooms', rooms.length, `${rooms.filter(r => r.isActive).length} active`],
    ['Text hints', totalHints, 'Across all rooms'],
    ['Media records', totalMedia, 'Images, audio and video'],
    ['Active staff', activeStaff, `${staff.length} total account${staff.length === 1 ? '' : 's'}`]
  ]) {
    const card = node('div', 'metric-card');
    card.append(node('span', 'metric-label', label), node('strong', 'metric-value', String(value)), node('span', 'metric-note', note));
    grid.append(card);
  }
  content.append(grid);

  const columns = node('div', 'content-grid');
  const roomsPanel = panel('Room inventory', 'Configuration currently stored in Supabase');
  roomsPanel.head.append(link('admin.html?view=rooms', 'text-link', 'View all →'));
  const roomsBody = node('div', 'panel-body');
  if (!rooms.length) roomsBody.append(node('p', 'panel-empty', 'No rooms are configured.'));
  for (const room of rooms.slice(0, 4)) {
    const row = link(roomUrl(room), 'stack-row', '');
    row.append(image(room.thumbnail, '', 'mini-thumb'));
    const text = node('div', 'stack-row-main');
    text.append(node('strong', '', room.name), node('small', '', roomSummary(room)));
    row.append(text, statusPill(room.isActive), node('span', 'row-arrow', '›'));
    roomsBody.append(row);
  }
  roomsPanel.wrap.append(roomsBody);

  const staffPanel = panel('Staff access', 'Active roles and assignments');
  staffPanel.head.append(link('admin.html?view=staff', 'text-link', 'View all →'));
  const staffBody = node('div', 'panel-body');
  if (!staff.length) staffBody.append(node('p', 'panel-empty', 'No staff accounts are assigned.'));
  for (const person of staff.slice(0, 4)) {
    const row = node('div', 'stack-row');
    row.append(node('span', 'staff-identity-icon', (person.email || '?').slice(0,1).toUpperCase()));
    const text = node('div', 'stack-row-main');
    text.append(node('strong', '', person.email || 'Email unavailable'),
      node('small', '', person.role === 'admin' ? 'All rooms' :
        `${person.room_ids?.length || 0} room assignments`));
    row.append(text, rolePill(person.role));
    staffBody.append(row);
  }
  staffPanel.wrap.append(staffBody);
  columns.append(roomsPanel.wrap, staffPanel.wrap);
  content.append(columns);
}

function roomTile(room) {
  const tile = link(roomUrl(room), 'room-tile', '');
  const cover = node('div', 'room-tile-image');
  cover.append(image(room.thumbnail, `${room.name} thumbnail`, 'room-cover'), statusPill(room.isActive));
  const body = node('div', 'room-tile-body');
  body.append(node('h2', '', room.name), node('p', '', `Room ID: ${room.id}`));
  const meta = node('div', 'room-tile-meta');
  const hints = node('span'); hints.append(node('strong', '', String(room.hints.length)), ' hints');
  const media = node('span'); media.append(node('strong', '', String(room.mediaRecords.length)), ' media');
  const time = node('span'); time.append(node('strong', '', fmtDuration(room.defaultDuration)), ' timer');
  meta.append(hints, media, time);
  body.append(meta); tile.append(cover, body);
  return tile;
}
function renderRooms() {
  const rooms = state.data.rooms;
  content.append(heading('ROOM LIBRARY', 'Rooms', 'Browse current room configuration. Editing arrives in Phase 6.'));
  const filters = node('div', 'filterbar');
  const search = node('input'); search.type = 'search'; search.placeholder = 'Search rooms'; search.setAttribute('aria-label', 'Search rooms');
  const status = node('select'); status.setAttribute('aria-label','Filter room status');
  for (const [value,label] of [['all','All statuses'],['active','Active'],['inactive','Inactive']]) {
    const option = node('option', '', label); option.value = value; status.append(option);
  }
  filters.append(search,status); content.append(filters);
  const count = node('p','filter-count'); const grid = node('div','room-grid-admin');
  content.append(count,grid);
  function update() {
    const q = search.value.trim().toLocaleLowerCase();
    const visible = rooms.filter(room =>
      (status.value === 'all' || room.isActive === (status.value === 'active')) &&
      (!q || room.name.toLocaleLowerCase().includes(q) || room.id.toLocaleLowerCase().includes(q)));
    count.textContent = `${visible.length} of ${rooms.length} rooms`;
    grid.replaceChildren();
    if (!visible.length) {
      const empty = node('div','empty-box');
      empty.append(node('strong','','No matching rooms'),node('span','','Try another name or status.'));
      grid.append(empty);
    } else visible.forEach(room => grid.append(roomTile(room)));
  }
  search.addEventListener('input',update); status.addEventListener('change',update); update();
}

function detailField(label, value) {
  const box = node('div'); box.append(node('small','',label),node('strong','',value)); return box;
}
function renderRoom(roomId) {
  const room = state.data.rooms.find(item => item.id === roomId);
  if (!room) { renderNotFound('This room could not be found in the current database.'); return; }
  const back = link('admin.html?view=rooms','subtle-button','←  All rooms');
  content.append(heading('ROOM DETAILS',room.name,'Live configuration and content · Read only',back));
  const hero = node('section','room-hero');
  const cover = node('div','room-hero-image'); cover.append(image(room.backgroundImage,`${room.name} background`,'room-background'));
  const body = node('div','room-hero-body');
  const summary = node('div'); summary.append(statusPill(room.isActive),node('h2','',room.name),node('p','',`ID: ${room.id}`));
  const meta = node('div','detail-meta');
  meta.append(detailField('Default timer',fmtDuration(room.defaultDuration)),
    detailField('Text hints',String(room.hints.length)),
    detailField('Media records',String(room.mediaRecords.length)),
    detailField('Last updated',fmtDate(room.updatedAt)));
  body.append(summary,meta); hero.append(cover,body); content.append(hero);
  const columns = node('div','detail-columns');
  const hints = panel('Text hints',`${room.hints.length} configured`);
  const hintsList = node('ol','detail-list');
  if (!room.hints.length) hints.wrap.append(node('p','panel-empty','No text hints are configured.'));
  room.hints.forEach((hint,index) => {
    const item = node('li');
    const copy = node('span','detail-text',hint.text); copy.dir = 'auto';
    item.append(node('span','item-index',String(index+1).padStart(2,'0')),copy); hintsList.append(item);
  });
  if (room.hints.length) { const padding = node('div','panel-body'); padding.append(hintsList); hints.wrap.append(padding); }
  const media = panel('Media library',`${room.mediaRecords.length} configured`);
  if (!room.mediaRecords.length) media.wrap.append(node('p','panel-empty','No media records are configured.'));
  else {
    const list = node('ul','detail-list');
    for (const record of room.mediaRecords) {
      const item = node('li');
      const text = node('div','detail-text');
      text.append(node('span','media-kind',record.kind.replaceAll('_',' ')),
        node('span','',record.label || record.assetRef?.split('/').at(-1) || 'Untitled media'));
      item.append(text);
      const src = assetUrl(record.assetRef);
      if (src) { const open = link(src,'media-link','Open ↗'); open.target='_blank'; open.rel='noopener noreferrer'; item.append(open); }
      list.append(item);
    }
    const padding = node('div','panel-body'); padding.append(list); media.wrap.append(padding);
  }
  columns.append(hints.wrap,media.wrap); content.append(columns);
}

function renderStaff() {
  const staff = state.data.staff;
  const rooms = new Map(state.data.rooms.map(room => [room.id,room.name]));
  content.append(heading('PEOPLE & ACCESS','Staff','Current authorized roles and room assignments · Read only'));
  const panelData = panel('Staff directory',`${staff.length} account${staff.length===1?'':'s'}`);
  if (!staff.length) panelData.wrap.append(node('p','panel-empty','No staff accounts are assigned.'));
  else {
    const wrap = node('div','table-wrap'); const table = node('table','staff-table');
    const thead = node('thead'); const header = node('tr');
    for (const label of ['Account','Role','Room access','Status']) header.append(node('th','',label));
    thead.append(header); table.append(thead);
    const tbody = node('tbody');
    for (const person of staff) {
      const row = node('tr'); const accountCell=node('td'); const identity=node('div','staff-identity');
      identity.append(node('span','staff-identity-icon',(person.email||'?').slice(0,1).toUpperCase()));
      const copy=node('span');
      copy.append(node('strong','',person.email||'Email unavailable'),
        node('small','',person.email_confirmed?'Verified email':'Email not verified'));
      identity.append(copy); accountCell.append(identity); row.append(accountCell);
      const roleCell=node('td'); roleCell.append(rolePill(person.role)); row.append(roleCell);
      const assignments=node('td'); const chips=node('div','assignment-list');
      if(person.role==='admin') chips.append(node('span','assignment-chip','All rooms'));
      else if(!person.room_ids?.length) chips.append(node('span','','No rooms assigned'));
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
  content.append(heading('PERSONAL SETTINGS','Your account','Identity and sign-in controls for this Admin account.'));
  const grid=node('div','account-layout');
  const profile=node('section','panel account-card');
  profile.append(node('h2','','Account details'),
    detailAccount('Email address',access.user.email||'Unavailable'),
    detailAccount('Role','Admin'),
    detailAccount('Email status',access.user.email_confirmed_at?'Verified':'Verification pending'));
  const change=node('section','panel account-card');
  change.append(node('h2','','Change email address'));
  const form=node('form','account-form');form.id='admin-email-form';
  const label=node('label','','New email address');label.htmlFor='admin-new-email';
  const input=node('input');input.id='admin-new-email';input.type='email';input.autocomplete='email';input.required=true;
  const submit=button('Send verification link','button-dark');submit.type='submit';
  const message=node('p','form-message');message.hidden=true;message.setAttribute('role','status');
  form.append(label,input,submit,message);change.append(form,
    node('p','account-note','Supabase will verify the new inbox before the account email changes. Your Admin role stays with your identity.'));
  form.addEventListener('submit',async event=>{
    event.preventDefault();submit.disabled=true;message.hidden=true;
    try {
      const {error}=await supabase.auth.updateUser({email:input.value.trim()});
      if(error) throw error;
      message.classList.remove('error');
      message.textContent='Check the new inbox for the confirmation link.';
      input.value='';
    } catch {
      message.classList.add('error');message.textContent='Could not request the email change. Try again later.';
    } finally {message.hidden=false;submit.disabled=false;}
  });
  const security=node('section','panel account-card');
  security.append(node('h2','','Sign-in & security'));
  const list=node('ul','security-list');
  list.append(node('li','','Passwords are managed by Supabase Auth.'),
    node('li','','Your role is assigned in the database.'),
    node('li','','Password recovery uses a verified email link.'));
  security.append(list,link('recover.html','subtle-button','Password recovery ↗'));
  grid.append(profile,change,security);content.append(grid);
}
function detailAccount(label,value){const row=node('div','account-field');row.append(node('small','',label),node('strong','',value));return row;}
function renderNotFound(message){
  const error=node('div','error-panel');
  error.append(node('h2','','Page not found'),node('p','',message),link('admin.html?view=overview','subtle-button','Back to overview'));
  content.append(error);
}

function route(){
  const params=new URLSearchParams(location.search);
  return {view:params.get('view')||'overview',id:params.get('id')||''};
}
function setNavigation(view,id){
  const section=view==='room'?'rooms':view;
  document.querySelectorAll('[data-nav]').forEach(item=>{
    if(item.dataset.nav===section)item.setAttribute('aria-current','page');
    else item.removeAttribute('aria-current');
  });
  breadcrumbs.replaceChildren();
  const root=link('admin.html?view=overview','','Admin');breadcrumbs.append(root,node('span','','/'));
  const titles={overview:'Overview',rooms:'Rooms',staff:'Staff',account:'Account',room:'Room details'};
  if(view==='room'){
    breadcrumbs.append(link('admin.html?view=rooms','','Rooms'),node('span','','/'));
    breadcrumbs.append(node('strong','',state.data?.rooms.find(r=>r.id===id)?.name||'Room details'));
  } else breadcrumbs.append(node('strong','',titles[view]||'Not found'));
  document.title=`${titles[view]||'Not found'} · Ahaji Admin`;
}
function render(){
  const {view,id}=route();setNavigation(view,id);content.replaceChildren();
  if(state.error){
    const box=node('div','error-panel');
    box.append(node('h2','','Could not load the dashboard'),
      node('p','','The live database request failed. Check your connection, then retry.'));
    const retry=button('Try again','button-dark');retry.addEventListener('click',loadData);box.append(retry);content.append(box);
    return;
  }
  if(!state.data){content.append(node('div','loading-panel','Loading live dashboard data…'));return;}
  if(view==='overview')renderOverview();
  else if(view==='rooms')renderRooms();
  else if(view==='room')renderRoom(id);
  else if(view==='staff')renderStaff();
  else if(view==='account')renderAccount();
  else renderNotFound('This Admin page does not exist.');
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
  closeMenu();render();content.focus({preventScroll:true});window.scrollTo(0,0);
  verifyAccess();
});
window.addEventListener('popstate',()=>{closeMenu();render();verifyAccess();});

async function loadData(){
  if(state.loading)return;
  state.loading=true;state.error=false;state.data=null;render();
  try{state.data=await repository.load();render();}
  catch{
    state.error=true;render();
  } finally{state.loading=false;}
}
async function verifyAccess(){
  try{
    const access=await currentAccess();
    if(!access){location.replace(`login.html?next=${encodeURIComponent(location.pathname.slice(1)+location.search)}`);return false;}
    if(access.role!=='admin'){state.data=null;location.replace('unauthorized.html?reason=admin');return false;}
    state.access=access;
    document.getElementById('sidebar-email').textContent=access.user.email||'';
    gate.hidden=true;gateError.hidden=true;shell.hidden=false;
    return true;
  }catch{
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
if(await verifyAccess())await loadData();
