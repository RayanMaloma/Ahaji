// Protected room catalog read boundary for later admin and room migrations.
// Inject a Supabase-compatible client from a trusted caller; this module
// creates no client and contains no credentials. Phase 3 does not load it in
// the current browser pages, which still use the approved static room data.

function assertClient(client) {
  if (!client || typeof client.from !== 'function') {
    throw new TypeError('A database client with from() is required.');
  }
}

async function read(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Room catalog query failed.');
  return data || [];
}

function normalizeRoom(row, hints, media) {
  const roomMedia = media.filter(item => item.room_id === row.id);
  const first = kind => roomMedia.find(item => item.kind === kind)?.asset_ref || null;
  const list = kind => roomMedia
    .filter(item => item.kind === kind)
    .sort((a, b) => a.display_order - b.display_order)
    .map(item => ({ id: item.id, label: item.label, src: item.asset_ref }));

  return {
    id: row.id,
    name: row.name,
    thumbnail: row.thumbnail_ref,
    backgroundImage: row.background_ref,
    defaultDuration: row.default_duration_seconds,
    isActive: row.is_active,
    hints: hints.filter(item => item.room_id === row.id)
      .sort((a, b) => a.display_order - b.display_order)
      .map(item => ({ id: item.id, text: item.body })),
    media: {
      hintSound: first('hint_sound'),
      loseSound: first('lose_sound'),
      loseVideo: first('lose_video'),
      gmImages: list('gm_image'),
      gmSounds: list('gm_sound')
    }
  };
}

export function createRoomRepository(client) {
  assertClient(client);

  async function listRooms({ includeInactive = false } = {}) {
    let query = client.from('rooms').select(
      'id,name,thumbnail_ref,background_ref,default_duration_seconds,display_order,is_active'
    );
    if (!includeInactive) query = query.eq('is_active', true);
    const rooms = await read(query.order('display_order').order('id'));
    if (rooms.length === 0) return [];

    const ids = rooms.map(room => room.id);
    const [hints, media] = await Promise.all([
      read(client.from('room_hints').select('id,room_id,body,display_order').in('room_id', ids)),
      read(client.from('room_media').select('id,room_id,kind,label,asset_ref,display_order').in('room_id', ids))
    ]);
    return rooms.map(room => normalizeRoom(room, hints, media));
  }

  async function getRoom(roomId, options) {
    if (typeof roomId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(roomId)) {
      return null;
    }
    const rooms = await listRooms(options);
    return rooms.find(room => room.id === roomId) || null;
  }

  return Object.freeze({ listRooms, getRoom });
}
