import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomDraft } from '../js/admin/room-draft.mjs';

const room=()=>({
  id:'anbar',name:'السجن',description:'',defaultDuration:3600,isActive:true,
  backgroundImage:'images/prison.jpg',contentRevision:7,
  presentation:{timerScale:1,timerColor:'#ffffff'},
  hints:[{id:'h1',text:'الأول'},{id:'h2',text:'الثاني'}],
  mediaRecords:[{id:'m1',kind:'gm_sound',label:'صوت',assetRef:'source/sound.mp3'}]
});

test('one draft keeps settings, hint order, and staged media across views',()=>{
  const draft=createRoomDraft(room());
  assert.equal(draft.isDirty(),false);
  draft.setPresentation({timerScale:1.3,timerColor:'#ffee22'});
  draft.reorderHints(['h2','h1']);
  const file=new File(['audio'],'cue.mp3',{type:'audio/mpeg'});
  draft.upsertMedia({kind:'gm_sound',label:'جرس',file,url:'blob:test'});
  assert.equal(draft.isDirty(),true);
  assert.deepEqual(draft.hints.map(h=>h.id),['h2','h1']);
  assert.equal(draft.general.presentation.timerColor,'#ffee22');
  assert.equal(draft.uploadEntries().length,1);
  assert.equal(draft.payload().media.length,2);
  assert.equal(draft.payload().hints[0].id,'h2');
  assert.equal(draft.revision,7);
  draft.discard();
  assert.equal(draft.isDirty(),false);
  assert.equal(draft.general.presentation.timerScale,1);
  assert.deepEqual(draft.hints.map(h=>h.id),['h1','h2']);
});

test('failed save leaves draft editable and committed save rebases revision',()=>{
  const draft=createRoomDraft(room());
  draft.setGeneral({name:'السجن الجديد'});
  draft.setSaving(true);
  draft.setSaving(false);
  draft.setStatus('فشل الحفظ',true);
  assert.equal(draft.isDirty(),true);
  assert.equal(draft.general.name,'السجن الجديد');
  draft.markCommitted(10);
  assert.equal(draft.isDirty(),false);
  assert.equal(draft.locked,true);
  draft.resetFrom({...room(),name:'السجن الجديد',contentRevision:10});
  assert.equal(draft.locked,false);
  assert.equal(draft.revision,10);
  assert.equal(draft.isDirty(),false);
});
