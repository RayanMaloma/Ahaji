// A room draft owns every unsaved setting and content edit. File objects stay
// in memory; refresh/close warns instead of claiming they can be restored.
const clone=value=>structuredClone(value);
const initial=room=>({
  general:{
    name:room?.name||'',description:room?.description||'',
    durationSeconds:room?.defaultDuration||3600,active:room?.isActive??true,
    presentation:clone(room?.presentation||{}),
    imageRef:room?.backgroundImage||'images/ahajilogo.svg'
  },
  imageStage:null,
  hints:(room?.hints||[]).map(h=>({id:h.id,text:h.text})),
  media:(room?.mediaRecords||[]).map(m=>({
    id:m.id,kind:m.kind,label:m.label||'',assetRef:m.assetRef,
    file:null,url:null
  }))
});
const signature=state=>JSON.stringify({
  general:state.general,
  image:state.imageStage&&{
    removed:state.imageStage.removed,
    token:state.imageStage.token||null
  },
  hints:state.hints.map(({id,text})=>({id,text})),
  media:state.media.map(({id,kind,label,assetRef,token})=>({
    id,kind,label,assetRef,token:token||null
  }))
});
const groupSignature=(state,group)=>JSON.stringify(group==='hints'
  ?state.hints.map(({id,text})=>({id,text}))
  :state.media.map(({id,kind,label,assetRef,token})=>({
    id,kind,label,assetRef,token:token||null
  })));
const release=stage=>{if(stage?.url)URL.revokeObjectURL(stage.url);};

export function createRoomDraft(room=null){
  let baseline=initial(room),state=initial(room),revision=room?.contentRevision??0;
  let saving=false,locked=false,status='',statusError=false;
  const listeners=new Set();
  const emit=()=>listeners.forEach(listener=>listener());
  const change=fn=>{if(saving||locked)return;fn();status='';statusError=false;emit();};
  return {
    roomId:room?.id||null,
    get general(){return state.general;},
    get imageStage(){return state.imageStage;},
    get hints(){return state.hints;},
    get media(){return state.media;},
    get revision(){return revision;},
    get saving(){return saving;},
    get locked(){return locked;},
    get status(){return status;},
    get statusError(){return statusError;},
    isDirty(){return !locked&&signature(state)!==signature(baseline);},
    groupDirty(group){return groupSignature(state,group)!==groupSignature(baseline,group);},
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    setGeneral(patch){change(()=>Object.assign(state.general,patch));},
    setPresentation(presentation){change(()=>{state.general.presentation=clone(presentation);});},
    stageImage(file,url){change(()=>{
      release(state.imageStage);
      state.imageStage=file?{file,url,token:crypto.randomUUID(),removed:false}
        :{file:null,url:null,removed:true};
    });},
    upsertHint(hint){change(()=>{
      const id=hint.id||`draft-${crypto.randomUUID()}`;
      const index=state.hints.findIndex(item=>item.id===id);
      if(index<0)state.hints.push({id,text:hint.text});
      else state.hints[index]={id,text:hint.text};
    });},
    removeHint(id){change(()=>{state.hints=state.hints.filter(item=>item.id!==id);});},
    reorderHints(ids){change(()=>{
      if(ids.length!==state.hints.length||
        new Set(ids).size!==ids.length||
        ids.some(id=>!state.hints.some(h=>h.id===id)))
        throw new Error('ترتيب التلميحات غير صالح.');
      const byId=new Map(state.hints.map(h=>[h.id,h]));
      state.hints=ids.map(id=>byId.get(id));
    });},
    upsertMedia(record){change(()=>{
      const id=record.id||`draft-${crypto.randomUUID()}`;
      const index=state.media.findIndex(item=>item.id===id);
      const old=index<0?null:state.media[index];
      if(old?.url&&old.url!==record.url)release(old);
      const next={id,kind:record.kind,label:record.label||'',
        assetRef:record.assetRef||old?.assetRef||'',
        file:record.file||null,url:record.url||null,
        token:record.file?crypto.randomUUID():null};
      if(index<0)state.media.push(next);else state.media[index]=next;
    });},
    removeMedia(id){change(()=>{
      const item=state.media.find(m=>m.id===id);release(item);
      state.media=state.media.filter(m=>m.id!==id);
    });},
    uploadEntries(){
      const entries=[];
      if(state.imageStage?.file)entries.push({kind:'image',file:state.imageStage.file});
      for(const item of state.media)if(item.file)entries.push({kind:'media',id:item.id,file:item.file});
      return entries;
    },
    payload(uploaded=new Map()){
      const imageRef=state.imageStage?.removed?'images/ahajilogo.svg':
        uploaded.get('image')||state.general.imageRef;
      const roomValues={name:state.general.name.trim(),
        description:state.general.description.trim(),
        durationSeconds:Number(state.general.durationSeconds),
        active:state.general.active,
        imageRef,presentation:clone(state.general.presentation)};
      const hints=this.groupDirty('hints')?state.hints.map(h=>({
        id:h.id.startsWith('draft-')?null:h.id,text:h.text.trim()
      })):null;
      const media=this.groupDirty('media')?state.media.map(m=>({
        id:m.id.startsWith('draft-')?null:m.id,
        kind:m.kind,label:m.label.trim()||null,
        assetRef:uploaded.get(m.id)||m.assetRef
      })):null;
      return {room:roomValues,hints,media};
    },
    setSaving(value){saving=value;status=value?'جارٍ حفظ التغييرات…':status;emit();},
    setStatus(message,error=false){status=message;statusError=error;emit();},
    markCommitted(newRevision){
      saving=false;locked=true;revision=newRevision;status='حُفظت التغييرات. جارٍ تحديث البيانات…';
      statusError=false;emit();
    },
    resetFrom(savedRoom){
      release(state.imageStage);state.media.forEach(release);
      baseline=initial(savedRoom);state=initial(savedRoom);
      revision=savedRoom.contentRevision??revision;
      saving=false;locked=false;status='حُفظت جميع التغييرات.';statusError=false;emit();
    },
    discard(){
      release(state.imageStage);state.media.forEach(release);
      state=clone(baseline);saving=false;locked=false;status='';statusError=false;emit();
    }
  };
}
