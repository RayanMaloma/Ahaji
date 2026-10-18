import { createRoomRepository } from './room-repository.mjs?v=theme-1';
import { roomIdBase,roomIdCandidate } from './room-id.mjs';

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

  function listRooms() { return rooms.listRooms({ includeInactive: true }); }
  // `roomRead` lets the caller reuse a room read already in flight.
  async function load({ roomRead } = {}) {
    // Only the session list depends on settlement; rooms and staff load meanwhile.
    const [roomRows, directory, sessions] = await Promise.all([
      roomRead || listRooms(),
      client.rpc('admin_staff_directory'),
      checked(client.rpc('admin_settle_sessions')).then(() => client.from('game_sessions')
        .select('id,room_id,gm_user_id,status,result,started_at,ended_at,created_at,updated_at,remaining_seconds,revision')
        .order('created_at',{ascending:false}).limit(100))
    ]);
    if (directory.error) throw new Error(directory.error.message || 'Staff directory request failed.');
    if (sessions.error) throw new Error(sessions.error.message || 'Session history request failed.');
    return { rooms: roomRows, staff: directory.data || [], sessions:sessions.data||[] };
  }
  async function listEvents(sessionId){
    return checked(client.from('session_events').select('id,event_type,payload,created_at,actor_user_id')
      .eq('session_id',sessionId).order('id'));
  }
  async function loadHistory(){
    const sessions=[];
    for(let offset=0;;offset+=500){
      const page=await checked(client.from('game_sessions')
        .select('id,room_id,gm_user_id,status,result,started_at,ended_at,created_at,updated_at,remaining_seconds,revision')
        .order('created_at',{ascending:false}).range(offset,offset+499));
      sessions.push(...page);if(page.length<500)break;
    }
    const eventMap=new Map(sessions.map(s=>[s.id,[]]));
    for(let index=0;index<sessions.length;index+=25){
      const ids=sessions.slice(index,index+25).map(s=>s.id);
      for(let offset=0;;offset+=500){
        const events=await checked(client.from('session_events')
          .select('session_id,event_type,created_at,id').in('session_id',ids)
          .order('id').range(offset,offset+499));
        for(const event of events)eventMap.get(event.session_id)?.push(event);
        if(events.length<500)break;
      }
    }
    return {sessions,eventMap};
  }

  async function createRoom(values) {
    return checked(client.from('rooms').insert(values).select('id').single());
  }
  async function createRoomForName(values) {
    const base=roomIdBase(values.name);
    for(let attempt=0;attempt<100;attempt++){
      const id=roomIdCandidate(base,attempt);
      try{await createRoom({...values,id});return id;}
      catch(error){if(error.code!=='23505')throw error;}
    }
    throw new Error('تعذّر إنشاء معرّف فريد للغرفة. حاول اسماً آخر.');
  }
  async function updateRoom(id, values) {
    return checked(client.from('rooms').update(values).eq('id', id).select('id').single());
  }
  async function getRoom(id){return rooms.getRoom(id,{includeInactive:true});}
  async function saveRoomDraft(id,revision,payload){
    return checked(client.rpc('admin_save_room_draft',{
      p_room_id:id,p_expected_revision:revision,p_room:payload.room,
      p_hints:payload.hints,p_media:payload.media
    }));
  }
  async function deleteNewRoom(id) {
    return checked(client.from('rooms').delete().eq('id', id));
  }
  // Sessions reference rooms with ON DELETE RESTRICT, so a played room fails
  // with 23503 and stays intact. Hints, media rows and room access cascade.
  async function deleteRoom(id) {
    const rows = await checked(client.from('rooms').delete().eq('id', id).select('id'));
    if (!rows?.length) throw new Error('لم تُحذف الغرفة. ربما حُذفت مسبقاً أو لا تملك الصلاحية.');
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

  return Object.freeze({ load,listRooms,loadHistory,listEvents,createRoom,createRoomForName,updateRoom,
    getRoom,saveRoomDraft,deleteNewRoom,deleteRoom,saveHint,
    deleteHint,reorderHints,saveMedia,deleteMedia,uploadAsset,removeAsset });
}
