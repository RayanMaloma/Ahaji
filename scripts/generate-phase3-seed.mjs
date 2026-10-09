// Rebuild the Phase 3 seed from the approved static room configuration.
// Later room migration phases should replace this one-time bridge.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const context = vm.createContext({});
vm.runInContext(readFileSync(join(root, 'js/app.js'), 'utf8'), context);
const rooms = vm.runInContext('getRooms()', context);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

const lines = [
  '-- Phase 3 seed from the approved local room configuration and hint files.',
  '-- Re-running it only inserts missing positions; it does not overwrite edits.',
  '-- Apply after the foundation migration; credentials stay outside this file.',
  ''
];

for (const [index, room] of rooms.entries()) {
  lines.push(
    'insert into public.rooms (id, name, thumbnail_ref, background_ref, default_duration_seconds, display_order)',
    `values (${quote(room.id)}, ${quote(room.name)}, ${quote(room.thumbnail)}, ${quote(room.backgroundImage)}, ${room.defaultDuration}, ${index})`,
    'on conflict (id) do nothing;',
    ''
  );
  const hintText = room.hints.source
    ? readFileSync(join(root, room.hints.source), 'utf8')
    : '';
  const hints = hintText.split('\n').map(line => line.trim()).filter(Boolean);
  hints.forEach((body, order) => lines.push(
    'insert into public.room_hints (room_id, body, display_order)',
    `values (${quote(room.id)}, ${quote(body)}, ${order})`,
    'on conflict (room_id, display_order) do nothing;'
  ));
  lines.push('');

  const media = [
    ['hint_sound', room.media.hintSound, null],
    ['lose_sound', room.media.loseSound, null],
    ['lose_video', room.media.loseVideo, null],
    ...room.media.gmImages.map(item => ['gm_image', item.src, item.label]),
    ...room.media.gmSounds.map(item => ['gm_sound', item.src, item.label])
  ].filter(([, assetRef]) => assetRef);
  const positionByKind = new Map();
  media.forEach(([kind, assetRef, label]) => {
    const order = positionByKind.get(kind) || 0;
    positionByKind.set(kind, order + 1);
    lines.push(
      'insert into public.room_media (room_id, kind, label, asset_ref, display_order)',
      `values (${quote(room.id)}, ${quote(kind)}, ${label === null ? 'null' : quote(label)}, ${quote(assetRef)}, ${order})`,
      'on conflict (room_id, kind, display_order) do nothing;'
    );
  });
  lines.push('');
}

const destination = join(root, 'supabase/seed.sql');
while (lines.at(-1) === '') lines.pop();
writeFileSync(destination, lines.join('\n') + '\n', 'utf8');
console.log(`Wrote ${destination}: ${rooms.length} rooms.`);
