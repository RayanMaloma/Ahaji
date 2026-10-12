import { supabase } from '../auth/client.mjs';

const roomTabs = [
  ['settings','الإعدادات العامة'], ['hints','التلميحات'],
  ['images','الصور'], ['videos','المقاطع'], ['audio','الأصوات']
];
const mime = {
  image:'image/jpeg,image/png,image/webp,image/gif',
  video:'video/mp4,video/webm', audio:'audio/mpeg,audio/ogg,audio/wav,audio/mp4'
};
const defaults = { cover:'images/ahajilogo.svg', background:'images/ahajilogo.svg' };
const $ = (tag, className='', text) => {
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(text!==undefined)element.textContent=text;
  return element;
};
const btn=(text,className='subtle-button')=>{const element=$('button',className,text);element.type='button';return element;};
const fileName=ref=>ref?.split('/').at(-1)||'ملف';
function assetUrl(ref){
  if(typeof ref!=='string')return '';
  if(ref.startsWith('storage://room-assets/')){
    const path=ref.slice('storage://room-assets/'.length);
    if(!/^[a-z][a-z0-9_-]{0,63}\/[A-Za-z0-9._-]+$/.test(path))return '';
    return supabase.storage.from('room-assets').getPublicUrl(path).data.publicUrl;
  }
  if(!/^(images|source)\//.test(ref)||ref.includes('..'))return '';
  return new URL(ref,location.origin+'/').href;
}
function labelled(label,control,note){
  const wrap=$('label','form-field');wrap.append($('span','',label),control);
  if(note)wrap.append($('small','field-note',note));
  return wrap;
}
function formMessage(parent,message,error=true){
  let box=parent.querySelector('[data-form-status]');
  if(!box){box=$('p','form-message');box.dataset.formStatus='';box.setAttribute('role','status');parent.append(box);}
  box.classList.toggle('error',error);box.textContent=message;
}
function input(type,value='',maxLength){
  const element=$('input','admin-input');element.type=type;element.value=value;
  if(maxLength)element.maxLength=maxLength;
  return element;
}
function range(value,min,max,step){
  const element=input('range');element.min=String(min);element.max=String(max);
  element.step=String(step);element.value=String(value);return element;
}
function select(options,value){
  const element=$('select','admin-select');
  for(const [key,label] of options){const option=$('option','',label);option.value=key;element.append(option);}
  element.value=value;return element;
}
function makeDialog(title,build){
  const dialog=$('dialog','admin-dialog');const form=$('form','admin-dialog-form');
  const header=$('div','admin-dialog-head');header.append($('h2','',title));
  const close=btn('×','mini-action');close.setAttribute('aria-label','إغلاق');
  close.addEventListener('click',()=>dialog.close());header.append(close);form.append(header);
  build(form,dialog);dialog.append(form);document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
}

function uploadControl({label,kind,currentRef='',required=false}){
  const wrap=$('div','upload-control');
  const heading=$('div','upload-heading');heading.append($('strong','',label),
    $('small','',`${kind==='image'?'JPG، PNG، WebP، GIF':kind==='video'?'MP4، WebM':'MP3، OGG، WAV، M4A'} · حتى 10 ميغابايت`));
  const inputFile=$('input','upload-native');inputFile.type='file';inputFile.accept=mime[kind];
  inputFile.tabIndex=-1;inputFile.setAttribute('aria-hidden','true');
  const choose=btn(currentRef?'استبدال الملف':'اختيار ملف','upload-choose');
  choose.addEventListener('click',()=>inputFile.click());
  const remove=btn('إزالة','mini-action danger');remove.hidden=!currentRef;
  const controls=$('div','upload-actions');controls.append(choose,remove,inputFile);
  const fileText=$('span','upload-filename',currentRef?fileName(currentRef):'لم يُحدد ملف');
  fileText.dir='auto';
  const preview=$('div','upload-preview');
  const progress=$('div','upload-progress');progress.hidden=true;
  const progressBar=$('progress');progressBar.removeAttribute('value');
  progressBar.setAttribute('aria-label',`رفع ${label}`);progress.append(progressBar,$('span','','جارٍ رفع الملف…'));
  let localUrl=null,removed=false;
  function draw(){
    preview.replaceChildren();
    const source=inputFile.files?.[0] ? localUrl : removed ? '' : assetUrl(currentRef);
    if(!source)return;
    const media=$(kind==='image'?'img':kind==='video'?'video':'audio');media.src=source;
    if(kind!=='image'){media.controls=true;media.preload='metadata';}
    if(kind==='image')media.alt=`معاينة ${label}`;
    preview.append(media);
  }
  inputFile.addEventListener('change',()=>{
    if(localUrl)URL.revokeObjectURL(localUrl);
    const file=inputFile.files?.[0];localUrl=file?URL.createObjectURL(file):null;
    removed=false;remove.hidden=!file&&!currentRef;
    fileText.textContent=file?file.name:currentRef?fileName(currentRef):'لم يُحدد ملف';
    draw();
  });
  remove.addEventListener('click',()=>{
    inputFile.value='';if(localUrl)URL.revokeObjectURL(localUrl);localUrl=null;
    removed=true;remove.hidden=true;fileText.textContent='سيُزال الملف عند الحفظ';draw();
  });
  wrap.append(heading,controls,fileText,preview,progress);draw();
  return {element:wrap,get file(){return inputFile.files?.[0]||null;},get removed(){return removed;},
    setBusy(value){progress.hidden=!value;choose.disabled=value;remove.disabled=value;},
    validate(){const file=inputFile.files?.[0];if(required&&!file)throw new Error(`اختر ${label}.`);
      if(file){if(!mime[kind].split(',').includes(file.type))throw new Error(`نوع ${label} غير مدعوم.`);
        if(file.size>10*1024*1024)throw new Error(`${label} يتجاوز 10 ميغابايت.`);}},
    dispose(){if(localUrl)URL.revokeObjectURL(localUrl);}}
}

function makePreview(form,room,backgroundUpload,controls){
  const wrap=$('section','cast-preview-panel');
  const title=$('div','cast-preview-heading');title.append($('h2','','معاينة شاشة العرض'),
    $('p','','تظهر التعديلات هنا قبل الحفظ دون تغيير الجلسات الجارية.'));
  const modes=$('div','preview-modes');let mode='hint';
  const iframe=$('iframe','cast-preview-frame');iframe.src='cast-preview.html';
  iframe.title='معاينة مباشرة لشاشة العرض';iframe.setAttribute('loading','lazy');
  function update(){
    if(!iframe.contentWindow)return;
    const presentation=readPresentation(controls);
    const name=form.querySelector('[name=room-name]')?.value.trim()||room?.name||'غرفة أحاجي';
    const file=backgroundUpload.file;
    let backgroundPreview='';
    if(file){const img=backgroundUpload.element.querySelector('.upload-preview img');backgroundPreview=img?.src||'';}
    iframe.contentWindow.postMessage({type:'ahaji-cast-preview',name,
      background:backgroundUpload.removed?defaults.background:room?.backgroundImage||defaults.background,
      backgroundPreview,presentation,mode},location.origin);
  }
  for(const [value,label] of [['timer','المؤقت'],['hint','التلميح'],['win','الفوز'],['lose','الخسارة']]){
    const action=btn(label,'preview-mode');action.setAttribute('aria-pressed',String(value===mode));
    action.addEventListener('click',()=>{mode=value;
      for(const item of modes.children)item.setAttribute('aria-pressed',String(item===action));update();});
    modes.append(action);
  }
  iframe.addEventListener('load',update);
  addEventListener('message',event=>{if(event.origin===location.origin&&
    event.source===iframe.contentWindow&&event.data?.type==='ahaji-cast-preview-ready')update();});
  form.addEventListener('input',update);form.addEventListener('change',update);
  backgroundUpload.element.addEventListener('change',update);
  backgroundUpload.element.addEventListener('click',()=>setTimeout(update,100));
  wrap.append(title,modes,iframe);return wrap;
}

function readPresentation(c){return window.normalizePresentationSettings({
  timerScale:Number(c.timerScale.value),timerPosition:c.timerPosition.value,
  timerColor:c.timerColor.value,timerFont:c.timerFont.value,
  hintScale:Number(c.hintScale.value),hintPosition:c.hintPosition.value,
  hintDurationSeconds:Number(c.hintDuration.value),imageFit:c.imageFit.value,
  videoFit:c.videoFit.value,winMessage:c.winMessage.value.trim(),
  loseMessage:c.loseMessage.value.trim()
});}

export function renderRoomWorkspace({room=null,container,repository,navigate,refresh}){
  const creating=!room;
  const tab=new URLSearchParams(location.search).get('tab')||'settings';
  const currentTab=roomTabs.some(([key])=>key===tab)?tab:'settings';
  const back=$('a','subtle-button room-back','→ جميع الغرف');back.href='admin.html?view=rooms';back.dataset.adminLink='';
  const header=$('div','room-workspace-head');
  header.append($('h1','',creating?'إضافة غرفة':'تعديل الغرفة'));
  if(room)header.append($('span','room-workspace-name',room.name));
  container.append(back,header);
  if(!creating){
    const tabs=$('nav','room-workspace-tabs');tabs.setAttribute('aria-label','أقسام إدارة الغرفة');
    for(const [key,label] of roomTabs){const a=$('a','room-workspace-tab',label);
      a.href=`admin.html?view=room&id=${encodeURIComponent(room.id)}&tab=${key}`;
      a.dataset.adminLink='';if(currentTab===key)a.setAttribute('aria-current','page');tabs.append(a);}
    container.append(tabs);
  }
  if(currentTab==='settings'||creating)renderSettings({room,container,repository,navigate,refresh});
  else if(currentTab==='hints')renderHints({room,container,repository,refresh});
  else renderMediaTab({room,container,repository,refresh,tab:currentTab});
}

function settingsGroup(title,description){
  const section=$('section','panel settings-section');
  const head=$('div','settings-section-head');head.append($('h2','',title));
  if(description)head.append($('p','',description));section.append(head);return section;
}
function renderSettings({room,container,repository,navigate,refresh}){
  const creating=!room, p=window.normalizePresentationSettings(room?.presentation);
  const form=$('form','room-settings-form');
  const main=settingsGroup('بيانات الغرفة');
  const name=input('text',room?.name||'',120);name.required=true;name.name='room-name';
  const description=$('textarea','admin-textarea');description.maxLength=2000;
  description.rows=3;description.value=room?.description||'';
  const id=input('text',room?.id||'',64);id.required=true;id.pattern='[a-z][a-z0-9_-]{0,63}';
  id.dir='ltr';id.disabled=!creating;
  const duration=input('number',String(Math.round((room?.defaultDuration||3600)/60)));
  duration.min='1';duration.max='99';duration.required=true;
  const active=input('checkbox');active.checked=room?.isActive??true;active.className='status-toggle-input';
  active.setAttribute('role','switch');active.setAttribute('aria-label','حالة الغرفة');
  const activeText=$('strong','status-toggle-text');
  const syncActive=()=>{activeText.textContent=active.checked?'نشطة':'غير نشطة';active.setAttribute('aria-checked',String(active.checked));};
  active.addEventListener('change',syncActive);syncActive();
  const status=$('label','status-toggle-row');status.append($('span','','حالة الغرفة'),active,$('span','status-toggle-track'),activeText);
  const base=$('div','settings-fields');base.append(labelled('اسم الغرفة',name),labelled('الوصف',description),
    labelled('المعرّف الداخلي',id,'معرّف تقني ثابت لا يتغير بعد إنشاء الغرفة.'),
    labelled('مدة اللعبة الافتراضية بالدقائق',duration),status);main.append(base);
  const appearance=settingsGroup('الهوية والخلفية');
  const cover=uploadControl({label:'صورة الغلاف',kind:'image',currentRef:room?.thumbnail});
  const background=uploadControl({label:'خلفية شاشة العرض',kind:'image',currentRef:room?.backgroundImage});
  appearance.append(cover.element,background.element);
  const display=settingsGroup('العرض أثناء اللعب');
  const timerScale=range(p.timerScale,0.7,1.3,0.05);
  const timerPosition=select([['top','أعلى الشاشة'],['center','وسط الشاشة'],['bottom','أسفل الشاشة']],p.timerPosition);
  const timerColor=input('color',p.timerColor);
  const timerFont=select([['mono','أرقام واضحة'],['serif','خط أحاجي']],p.timerFont);
  const hintScale=range(p.hintScale,0.75,1.5,0.05);
  const hintPosition=select([['top','أعلى الشاشة'],['bottom','أسفل الشاشة']],p.hintPosition);
  const hintDuration=input('number',String(p.hintDurationSeconds));hintDuration.min='0';hintDuration.max='120';
  const imageFit=select([['contain','إظهار الصورة كاملة'],['cover','ملء المساحة']],p.imageFit);
  const videoFit=select([['contain','إظهار المقطع كاملاً'],['cover','ملء المساحة']],p.videoFit);
  const winMessage=input('text',p.winMessage,80),loseMessage=input('text',p.loseMessage,80);
  winMessage.required=true;loseMessage.required=true;
  const controls={timerScale,timerPosition,timerColor,timerFont,hintScale,hintPosition,
    hintDuration,imageFit,videoFit,winMessage,loseMessage};
  const fields=$('div','settings-fields');fields.append(
    labelled('حجم المؤقت',timerScale),labelled('موضع المؤقت',timerPosition),
    labelled('لون المؤقت',timerColor),labelled('خط المؤقت',timerFont),
    labelled('حجم التلميح',hintScale),labelled('موضع التلميح',hintPosition),
    labelled('مدة ظهور التلميح بالثواني',hintDuration,'صفر يعني إبقاء التلميح حتى الحدث التالي.'),
    labelled('طريقة عرض الصور',imageFit),labelled('طريقة عرض المقاطع',videoFit),
    labelled('رسالة الفوز',winMessage),labelled('رسالة الخسارة',loseMessage));
  display.append(fields);
  const preview=makePreview(form,room,background,controls);
  form.append(main,appearance,display,preview);
  if(room){
    const systems=settingsGroup('وسائط النظام');
    systems.append($('p','account-note','يمكن ضبط صوت التلميح وصوت الخسارة ومقطع الخسارة من تبويبي الأصوات والمقاطع.'));
    form.append(systems);
  }
  const actions=$('div','form-buttons');const save=btn(creating?'إنشاء الغرفة':'حفظ التغييرات','button-dark');save.type='submit';
  actions.append(save);form.append(actions);container.append(form);
  form.addEventListener('submit',async event=>{
    event.preventDefault();save.disabled=true;cover.setBusy(true);background.setBusy(true);
    const roomId=id.value.trim(), uploaded=[];let created=false;
    try{
      cover.validate();background.validate();
      const values={name:name.value.trim(),description:description.value.trim(),
        default_duration_seconds:Number(duration.value)*60,is_active:active.checked,
        presentation_settings:readPresentation(controls)};
      if(!values.name)throw new Error('اكتب اسم الغرفة.');
      if(creating){await repository.createRoom({id:roomId,...values,is_active:false,
        thumbnail_ref:defaults.cover,background_ref:defaults.background});created=true;}
      if(cover.file){values.thumbnail_ref=await repository.uploadAsset(roomId,cover.file);uploaded.push(values.thumbnail_ref);}
      else if(cover.removed)values.thumbnail_ref=defaults.cover;
      if(background.file){values.background_ref=await repository.uploadAsset(roomId,background.file);uploaded.push(values.background_ref);}
      else if(background.removed)values.background_ref=defaults.background;
      await repository.updateRoom(roomId,values);
      for(const ref of [values.thumbnail_ref&&room?.thumbnail,values.background_ref&&room?.backgroundImage])
        if(ref)await repository.removeAsset(ref).catch(()=>{});
      cover.dispose();background.dispose();
      navigate(`admin.html?view=room&id=${encodeURIComponent(roomId)}&tab=settings`);
      await refresh();
    }catch(error){
      for(const ref of uploaded)await repository.removeAsset(ref).catch(()=>{});
      if(created)await repository.deleteNewRoom(roomId).catch(()=>{});
      formMessage(form,error.message||'تعذّر حفظ الغرفة.');
      save.disabled=false;cover.setBusy(false);background.setBusy(false);
    }
  });
}

function renderHints({room,container,repository,refresh}){
  const panel=settingsGroup('التلميحات');
  const add=btn('＋ إضافة تلميح','button-dark');panel.querySelector('.settings-section-head').append(add);
  add.addEventListener('click',()=>editHint(null));
  const list=$('ol','workspace-list');
  if(!room.hints.length)panel.append($('p','panel-empty','لا توجد تلميحات لهذه الغرفة.'));
  room.hints.forEach((hint,index)=>{
    const item=$('li','workspace-row');item.append($('span','item-index',String(index+1).padStart(2,'0')));
    const copy=$('p','workspace-row-text',hint.text);copy.dir='auto';item.append(copy);
    const actions=$('div','item-actions');
    const edit=btn('تعديل','mini-action');edit.addEventListener('click',()=>editHint(hint));
    const remove=btn('حذف','mini-action danger');remove.addEventListener('click',async()=>{
      if(!confirm('حذف هذا التلميح؟'))return;
      try{await repository.deleteHint(room.id,hint.id);await refresh();}
      catch(error){alert(error.message||'تعذّر حذف التلميح.');}
    });actions.append(edit,remove);
    for(const [direction,label,allowed] of [[-1,'رفع',index>0],[1,'خفض',index<room.hints.length-1]]){
      if(!allowed)continue;const move=btn(direction<0?'↑':'↓','mini-action');move.setAttribute('aria-label',`${label} التلميح`);
      move.addEventListener('click',async()=>{const ids=room.hints.map(x=>x.id);
        [ids[index],ids[index+direction]]=[ids[index+direction],ids[index]];
        try{await repository.reorderHints(room.id,ids);await refresh();}
        catch(error){alert(error.message||'تعذّر ترتيب التلميحات.');}});actions.append(move);
    }
    item.append(actions);list.append(item);
  });panel.append(list);container.append(panel);
  function editHint(hint){makeDialog(hint?'تعديل التلميح':'إضافة تلميح',(form,dialog)=>{
    const content=$('textarea','admin-textarea');content.rows=5;content.maxLength=2000;
    content.required=true;content.value=hint?.text||'';form.append(labelled('نص التلميح',content));
    const save=btn('حفظ التلميح','button-dark');save.type='submit';form.append(save);
    form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;
      try{await repository.saveHint(room.id,{id:hint?.id,text:content.value.trim(),
        displayOrder:Math.max(-1,...room.hints.map(x=>x.displayOrder))+1});
        dialog.close();await refresh();}
      catch(error){formMessage(form,error.message||'تعذّر حفظ التلميح.');save.disabled=false;}});
  });}
}

function renderMediaTab({room,container,repository,refresh,tab}){
  const config={images:{kind:'gm_image',type:'image',title:'مكتبة الصور',action:'إضافة صورة'},
    videos:{kind:'gm_video',type:'video',title:'مكتبة المقاطع',action:'إضافة مقطع'},
    audio:{kind:'gm_sound',type:'audio',title:'مكتبة الأصوات',action:'إضافة صوت'}}[tab];
  const panel=settingsGroup(config.title);
  const add=btn(`＋ ${config.action}`,'button-dark');panel.querySelector('.settings-section-head').append(add);
  add.addEventListener('click',()=>editMedia(null,config.kind,config.type));
  const records=room.mediaRecords.filter(x=>x.kind===config.kind);
  const grid=$('div','workspace-media-grid');
  if(!records.length)panel.append($('p','panel-empty','لا توجد ملفات في هذه المكتبة.'));
  for(const record of records){
    const card=$('article','workspace-media-card');
    const url=assetUrl(record.assetRef);
    if(url){const media=$(config.type==='image'?'img':config.type==='video'?'video':'audio');
      media.src=url;if(config.type==='image')media.alt=record.label||'صورة الغرفة';
      else{media.controls=true;media.preload='metadata';}card.append(media);}
    card.append($('strong','',record.label||fileName(record.assetRef)));
    const actions=$('div','item-actions');
    const replace=btn('استبدال','mini-action');replace.addEventListener('click',()=>editMedia(record,record.kind,config.type));
    const remove=btn('حذف','mini-action danger');remove.addEventListener('click',async()=>{
      if(!confirm('حذف هذا الملف من مكتبة الغرفة؟'))return;
      try{await repository.deleteMedia(room.id,record.id);
        await repository.removeAsset(record.assetRef).catch(()=>{});await refresh();}
      catch(error){alert(error.message||'تعذّر حذف الملف.');}});
    actions.append(replace,remove);card.append(actions);grid.append(card);
  }
  panel.append(grid);
  if(tab==='videos')systemMedia('lose_video','مقطع الخسارة','video');
  if(tab==='audio'){
    systemMedia('hint_sound','صوت إشعار التلميح','audio');
    systemMedia('lose_sound','صوت الخسارة','audio');
  }
  container.append(panel);
  function systemMedia(kind,title,type){
    const existing=room.mediaRecords.find(x=>x.kind===kind);
    const row=$('div','system-media-row');row.append($('div','',title));
    if(existing){const url=assetUrl(existing.assetRef),media=$(type);media.src=url;
      media.controls=true;media.preload='metadata';row.append(media);}
    const manage=btn(existing?'استبدال':'تعيين','mini-action');
    manage.addEventListener('click',()=>editMedia(existing||null,kind,type));row.append(manage);
    if(existing){const clear=btn('إزالة','mini-action danger');clear.addEventListener('click',async()=>{
      if(!confirm(`إزالة ${title}؟`))return;
      try{await repository.deleteMedia(room.id,existing.id);
        await repository.removeAsset(existing.assetRef).catch(()=>{});await refresh();}
      catch(error){alert(error.message||'تعذّر إزالة الملف.');}});row.append(clear);}
    panel.append(row);
  }
  function editMedia(record,kind,type){makeDialog(record?'استبدال الملف':'إضافة ملف',(form,dialog)=>{
    const label=input('text',record?.label||'',120);label.required=true;
    const upload=uploadControl({label:'الملف',kind:type,currentRef:record?.assetRef,required:true});
    form.append(labelled('اسم الملف',label),upload.element);
    const save=btn(record?'استبدال وحفظ':'رفع وحفظ','button-dark');save.type='submit';form.append(save);
    form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;upload.setBusy(true);let ref=null;
      try{upload.validate();ref=await repository.uploadAsset(room.id,upload.file);
        const order=record?.displayOrder??Math.max(-1,...room.mediaRecords.filter(x=>x.kind===kind).map(x=>x.displayOrder))+1;
        await repository.saveMedia(room.id,{id:record?.id,kind,label:label.value.trim(),assetRef:ref,displayOrder:order});
        dialog.close();upload.dispose();if(record)await repository.removeAsset(record.assetRef).catch(()=>{});
        await refresh();}
      catch(error){if(ref)await repository.removeAsset(ref).catch(()=>{});
        formMessage(form,error.message||'تعذّر رفع الملف.');save.disabled=false;upload.setBusy(false);}});
  });}
}
