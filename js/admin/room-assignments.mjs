// ربط الغرف: which operational account each room belongs to. The server
// (admin_room_assignments / admin_set_room_assignment) is the authority; this
// module only renders its answer and asks it for changes.
import { withImageSkeleton } from '../loader.mjs?v=loader-2';

export const ACCOUNTS = Object.freeze([
  // Order is visual order in RTL: the first column sits on the right.
  { slot: 'events', label: 'حساب الفعاليات' },
  { slot: 'venue', label: 'حساب محل أحاجي' },
]);
export const accountLabel = slot => ACCOUNTS.find(a => a.slot === slot)?.label || '';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function roomCard(room, imageUrl, onOpen) {
  const card = el('button', 'assign-card');
  card.type = 'button';
  card.dataset.roomId = room.room_id;
  card.setAttribute('aria-haspopup', 'dialog');
  card.setAttribute('aria-label', `خيارات غرفة ${room.name}`);
  const media = el('span', 'assign-card-media');
  const src = imageUrl(room.image_ref);
  if (src) {
    const img = el('img');
    img.src = src; img.alt = ''; img.decoding = 'async'; img.loading = 'eager';
    media.append(img);
    withImageSkeleton(img, media);
  }
  const menu = el('span', 'assign-card-menu');
  menu.setAttribute('aria-hidden', 'true');
  menu.append(el('i'), el('i'), el('i'));
  card.append(media, el('span', 'assign-card-shade'), el('span', 'assign-card-name', room.name), menu);
  card.addEventListener('click', () => onOpen(room, card));
  return card;
}

function grid(rooms, imageUrl, onOpen, emptyText) {
  const list = el('div', 'assign-grid');
  if (!rooms.length) list.append(el('p', 'assign-empty', emptyText));
  for (const room of rooms) list.append(roomCard(room, imageUrl, onOpen));
  return list;
}

export function renderRoomAssignments(data, { imageUrl, onOpen }) {
  const page = el('div', 'assign-page');
  const board = el('div', 'assign-board');
  for (const { slot, label } of ACCOUNTS) {
    const column = el('section', `assign-column assign-column-${slot}`);
    const headingId = `assign-heading-${slot}`;
    column.setAttribute('aria-labelledby', headingId);
    const heading = el('h2', 'assign-column-title', label);
    heading.id = headingId;
    column.append(heading);
    const account = data.accounts.find(a => a.slot === slot);
    if (!account) {
      const missing = el('p', 'assign-empty');
      missing.append('لم يُحدَّد هذا الحساب بعد. حدّده من ');
      const link = el('a', 'assign-inline-link', 'فريق العمل');
      link.href = 'admin.html?view=staff'; link.dataset.adminLink = '';
      missing.append(link, '.');
      column.append(missing);
    } else {
      column.append(grid(data.rooms.filter(r => r.slot === slot), imageUrl, onOpen, 'لا توجد غرف مرتبطة.'));
    }
    board.append(column);
  }
  const unassigned = el('section', 'assign-unassigned');
  unassigned.setAttribute('aria-labelledby', 'assign-heading-none');
  const title = el('h2', 'assign-column-title', 'الغرف غير المرتبطة');
  title.id = 'assign-heading-none';
  unassigned.append(title, grid(data.rooms.filter(r => !r.slot), imageUrl, onOpen,
    'كل الغرف مرتبطة بحساب.'));
  page.append(board, unassigned);
  return page;
}
