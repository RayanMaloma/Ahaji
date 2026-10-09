import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoomRepository } from '../js/data/room-repository.mjs';

function clientFor(tables, failureTable = null) {
  return {
    from(table) {
      let rows = tables[table] || [];
      const orders = [];
      return {
        select() { return this; },
        eq(column, value) { rows = rows.filter(row => row[column] === value); return this; },
        in(column, values) { rows = rows.filter(row => values.includes(row[column])); return this; },
        order(column) { orders.push(column); return this; },
        then(resolve) {
          rows = [...rows].sort((a, b) => {
            for (const column of orders) {
              if (a[column] < b[column]) return -1;
              if (a[column] > b[column]) return 1;
            }
            return 0;
          });
          return Promise.resolve(resolve(failureTable === table
            ? { data: null, error: { message: 'denied' } }
            : { data: rows, error: null }));
        }
      };
    }
  };
}

const tables = {
  rooms: [
    { id: 'anbar', name: 'Prison', thumbnail_ref: 'images/prison.jpg',
      background_ref: 'source/prison/background.jpg', default_duration_seconds: 3600,
      display_order: 0, is_active: true },
    { id: 'aaa', name: 'Another', thumbnail_ref: 'another.jpg',
      background_ref: 'another-bg.jpg', default_duration_seconds: 100,
      display_order: 2, is_active: true },
    { id: 'hidden', name: 'Hidden', thumbnail_ref: 'hidden.jpg',
      background_ref: 'hidden-bg.jpg', default_duration_seconds: 100,
      display_order: 1, is_active: false }
  ],
  room_hints: [
    { id: '2', room_id: 'anbar', body: 'Second', display_order: 1 },
    { id: '1', room_id: 'anbar', body: 'First', display_order: 0 }
  ],
  room_media: [
    { id: 'image', room_id: 'anbar', kind: 'gm_image', label: 'Map',
      asset_ref: 'map.png', display_order: 0 },
    { id: 'sound', room_id: 'anbar', kind: 'hint_sound', label: null,
      asset_ref: 'hint.mp3', display_order: 0 }
  ]
};

test('normalizes active rooms, ordered hints, and media', async () => {
  const repository = createRoomRepository(clientFor(tables));
  const rooms = await repository.listRooms();
  assert.deepEqual(rooms.map(room => room.id), ['anbar', 'aaa']);
  assert.deepEqual(rooms[0].hints.map(hint => hint.text), ['First', 'Second']);
  assert.equal(rooms[0].media.hintSound, 'hint.mp3');
  assert.deepEqual(rooms[0].media.gmImages.map(image => image.src), ['map.png']);
  assert.equal((await repository.getRoom('hidden')), null);
  assert.equal((await repository.getRoom('hidden', { includeInactive: true })).name, 'Hidden');
});

test('rejects invalid IDs and propagates authorization errors', async () => {
  const repository = createRoomRepository(clientFor(tables, 'room_hints'));
  assert.equal(await repository.getRoom('../anbar'), null);
  await assert.rejects(repository.listRooms(), /denied/);
});
