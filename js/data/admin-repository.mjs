import { createRoomRepository } from './room-repository.mjs';

// The database remains the authority. This module has no credentials and
// never substitutes static room configuration for a failed network read.
export function createAdminRepository(client) {
  const rooms = createRoomRepository(client);
  const bucket = client.storage.from('room-assets');
  const allowedMime = new Set(['image/jpeg','image/png','image/webp','image/gif',
    'audio/mpeg','audio/ogg','audio/wav','audio/mp4','video/mp4','video/webm']);
  const extensions = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp',
    'image/gif':'gif','audio/mpeg':'mp3','audio/ogg':'ogg','audio/wav':'wav',
    'audio/mp4':'m4a','video/mp4':'mp4','video/webm':'webm'};
  const managedRef = ref => typeof ref === 'string' && ref.startsWith('storage://room-assets/')
    ? ref.slice('storage://room-assets/'.length) : null;
  async function checked(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async function load() {
    const [roomRows, directory] = await Promise.all([
      rooms.listRooms({ includeInactive: true }),
      client.rpc('admin_staff_directory')
    ]);
    if (directory.error) throw new Error(directory.error.message || 'Staff directory request failed.');
    return { rooms: roomRows, staff: directory.data || [] };
  }

  async function createRoom(values) {
    return checked(client.from('rooms').insert(values).select('id').single());
  }
  async function updateRoom(id, values) {
    return checked(client.from('rooms').update(values).eq('id', id).select('id').single());
  }
  async function deleteNewRoom(id) {
    return checked(client.from('rooms').delete().eq('id', id));
  }
  async function saveHint(roomId, hint) {
    if (hint.id) return checked(client.from('room_hints').update({body:hint.text})
      .eq('id',hint.id).eq('room_id',roomId).select('id').single());
    return checked(client.from('room_hints').insert({room_id:roomId,body:hint.text,
      display_order:hint.displayOrder}).select('id').single());
  }
  async function deleteHint(roomId, id) {
    return checked(client.from('room_hints').delete().eq('id',id).eq('room_id',roomId));
  }
  async function reorderHints(roomId, ids) {
    return checked(client.rpc('admin_reorder_hints',{p_room_id:roomId,p_ids:ids}));
  }
  async function saveMedia(roomId, record) {
    const values={kind:record.kind,label:record.label||null,asset_ref:record.assetRef,
      display_order:record.displayOrder};
    if(record.id) return checked(client.from('room_media').update(values)
      .eq('id',record.id).eq('room_id',roomId).select('id').single());
    return checked(client.from('room_media').insert({...values,room_id:roomId})
      .select('id').single());
  }
  async function deleteMedia(roomId,id) {
    return checked(client.from('room_media').delete().eq('id',id).eq('room_id',roomId));
  }
  async function uploadAsset(roomId,file) {
    if(!file || !allowedMime.has(file.type)) throw new Error('نوع الملف غير مدعوم.');
    if(file.size > 10*1024*1024) throw new Error('الحد الأقصى لكل ملف 10 ميغابايت.');
    const path=`${roomId}/${crypto.randomUUID()}.${extensions[file.type]}`;
    const {error}=await bucket.upload(path,file,{contentType:file.type,upsert:false});
    if(error) throw error;
    return `storage://room-assets/${path}`;
  }
  async function removeAsset(ref) {
    const path=managedRef(ref);
    if(!path) return;
    const {error}=await bucket.remove([path]);
    if(error) throw error;
  }

  return Object.freeze({ load,createRoom,updateRoom,deleteNewRoom,saveHint,
    deleteHint,reorderHints,saveMedia,deleteMedia,uploadAsset,removeAsset });
}
