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
  const trim = item => ({ trimStartMs: item?.trim_start_ms ?? 0, trimEndMs: item?.trim_end_ms ?? null });
  const theme = roomMedia.find(item => item.kind === 'theme_sound');
  const list = kind => roomMedia
    .filter(item => item.kind === kind)
    .sort((a, b) => a.display_order - b.display_order)
    .map(item => ({ id: item.id, label: item.label, src: item.asset_ref,
      ...(kind === 'gm_sound' ? trim(item) : {}) }));

  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    displayOrder: row.display_order,
    thumbnail: row.background_ref,
    backgroundImage: row.background_ref,
    defaultDuration: row.default_duration_seconds,
    presentation: row.presentation_settings,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contentRevision: row.content_revision ?? 0,
    hints: hints.filter(item => item.room_id === row.id)
      .sort((a, b) => a.display_order - b.display_order)
      .map(item => ({ id: item.id, text: item.body, displayOrder: item.display_order })),
    mediaRecords: roomMedia.sort((a, b) => a.display_order - b.display_order)
      .map(item => ({ id: item.id, kind: item.kind, label: item.label,
        assetRef: item.asset_ref, displayOrder: item.display_order, ...trim(item) })),
    media: {
      hintSound: first('hint_sound'),
      hintSoundTrim: trim(roomMedia.find(item => item.kind === 'hint_sound')),
      loseSound: first('lose_sound'),
      loseSoundTrim: trim(roomMedia.find(item => item.kind === 'lose_sound')),
      loseVideo: first('lose_video'),
      themeSound: theme ? { src: theme.asset_ref, ...trim(theme) } : null,
      gmImages: list('gm_image'),
      gmSounds: list('gm_sound'),
      gmVideos: list('gm_video')
    }
  };
}

export function createRoomRepository(client) {
  assertClient(client);

  async function listRooms({ includeInactive = false } = {}) {
    let query = client.from('rooms').select(
      'id,name,description,thumbnail_ref,background_ref,default_duration_seconds,presentation_settings,display_order,is_active,created_at,updated_at,content_revision'
    );
    if (!includeInactive) query = query.eq('is_active', true);
    const rooms = await read(query.order('display_order').order('id'));
    if (rooms.length === 0) return [];

    const ids = rooms.map(room => room.id);
    const [hints, media] = await Promise.all([
      read(client.from('room_hints').select('id,room_id,body,display_order').in('room_id', ids)),
      read(client.from('room_media').select('id,room_id,kind,label,asset_ref,display_order,trim_start_ms,trim_end_ms').in('room_id', ids))
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
