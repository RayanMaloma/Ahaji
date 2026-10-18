import { supabase } from '../auth/client.mjs';
import { installHintSorting } from './hint-sort.mjs';
import { createAudioPlayer } from './audio-player.mjs';
import { withImageSkeleton } from '../loader.mjs?v=loader-2';

const roomTabs = [
  ['settings','الإعدادات العامة'], ['hints','التلميحات'],
  ['images','الصور'], ['videos','المقاطع'], ['audio','الأصوات']
];
const mime = {
  image:'image/jpeg,image/png,image/webp,image/gif',
  video:'video/mp4,video/webm', audio:'audio/mpeg,audio/ogg,audio/wav,audio/mp4'
};
const defaultRoomImage='images/ahajilogo.svg';
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
  const titleId=`room-dialog-${crypto.randomUUID()}`;
  dialog.setAttribute('aria-labelledby',titleId);
  const header=$('div','admin-dialog-head');const titleNode=$('h2','',title);
  titleNode.id=titleId;header.append(titleNode);
  const close=btn('×','mini-action');close.setAttribute('aria-label','إغلاق');
  close.addEventListener('click',()=>dialog.close());header.append(close);form.append(header);
  build(form,dialog);dialog.append(form);document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
}

function uploadControl({label,kind,currentRef='',staged=null,required=false,onChange=null,allowRemove=true}){
  const wrap=$('div','upload-control');
  const heading=$('div','upload-heading');heading.append($('strong','',label),
    $('small','',`${kind==='image'?'JPG، PNG، WebP، GIF':kind==='video'?'MP4، WebM':'MP3، OGG، WAV، M4A'} · حتى 10 ميغابايت`));
  const inputFile=$('input','upload-native');inputFile.type='file';inputFile.accept=mime[kind];
  inputFile.tabIndex=-1;inputFile.setAttribute('aria-hidden','true');
  const choose=btn(currentRef?'استبدال الملف':'اختيار ملف','upload-choose');
  choose.addEventListener('click',()=>inputFile.click());
  const remove=btn('إزالة','mini-action danger');remove.hidden=!allowRemove||(!currentRef&&!staged);
  const controls=$('div','upload-actions');controls.append(choose,remove,inputFile);
  const fileText=$('span','upload-filename',staged?.file?.name||
    (staged?.removed?'ستعود الصورة الافتراضية عند الحفظ':currentRef?fileName(currentRef):'لم يُحدد ملف'));
  fileText.dir='auto';
  const preview=$('div','upload-preview');
  const progress=$('div','upload-progress');progress.hidden=true;
  const progressBar=$('progress');progressBar.removeAttribute('value');
  progressBar.setAttribute('aria-label',`رفع ${label}`);progress.append(progressBar,$('span','','جارٍ رفع الملف…'));
  let selected=staged?.file||null,localUrl=staged?.url||null;
  let removed=Boolean(staged?.removed),ownsUrl=false;
  function draw(){
    preview.replaceChildren();
    const source=selected?localUrl:removed?'':assetUrl(currentRef);
    if(!source)return;
    const media=kind==='audio'?createAudioPlayer({src:source,label:`معاينة ${label}`}):
      $(kind==='image'?'img':'video');
    if(kind!=='audio')media.src=source;
    if(kind==='video'){media.controls=true;media.preload='metadata';}
    if(kind==='image'){media.alt=`معاينة ${label}`;media.decoding='async';}
    preview.append(media);
    if(kind==='image')withImageSkeleton(media,preview);
  }
  inputFile.addEventListener('change',()=>{
    if(ownsUrl&&localUrl)URL.revokeObjectURL(localUrl);
    selected=inputFile.files?.[0]||null;
    localUrl=selected?URL.createObjectURL(selected):null;
    ownsUrl=Boolean(selected);removed=false;remove.hidden=!allowRemove||(!selected&&!currentRef);
    fileText.textContent=selected?selected.name:currentRef?fileName(currentRef):'لم يُحدد ملف';
    if(onChange){onChange(selected,localUrl);ownsUrl=false;}
    draw();
  });
  remove.addEventListener('click',()=>{
    inputFile.value='';if(ownsUrl&&localUrl)URL.revokeObjectURL(localUrl);
    selected=null;localUrl=null;ownsUrl=false;
    removed=true;remove.hidden=true;fileText.textContent='سيُزال الملف عند الحفظ';
    if(onChange)onChange(null,null);draw();
  });
  wrap.append(heading,controls,fileText,preview,progress);draw();
  return {element:wrap,get file(){return selected;},get url(){return localUrl;},
    get removed(){return removed;},
    take(){ownsUrl=false;return {file:selected,url:localUrl,removed};},
    setBusy(value){progress.hidden=!value;choose.disabled=value;remove.disabled=value;},
    validate(){const file=selected;if(required&&!file)throw new Error(`اختر ${label}.`);
      if(file){if(!mime[kind].split(',').includes(file.type))throw new Error(`نوع ${label} غير مدعوم.`);
        if(file.size>10*1024*1024)throw new Error(`${label} يتجاوز 10 ميغابايت.`);}},
    dispose(){if(ownsUrl&&localUrl)URL.revokeObjectURL(localUrl);}}
}

function makePreview(form,room,imageUpload,controls){
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
    const file=imageUpload.file;
    let backgroundPreview='';
    if(file){const img=imageUpload.element.querySelector('.upload-preview img');backgroundPreview=img?.src||'';}
    iframe.contentWindow.postMessage({type:'ahaji-cast-preview',name,
      background:imageUpload.removed?defaultRoomImage:room?.backgroundImage||defaultRoomImage,
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
  imageUpload.element.addEventListener('change',update);
  imageUpload.element.addEventListener('click',()=>setTimeout(update,100));
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

export function renderRoomWorkspace({draft,container,onSave,onDiscard,onDelete,rerender}){
  const creating=!draft.roomId;
  const requested=new URLSearchParams(location.search).get('tab')||'settings';
  const currentTab=roomTabs.some(([key])=>key===requested)?requested:'settings';
  const back=$('a','subtle-button room-back','→ جميع الغرف');
  back.href='admin.html?view=rooms';back.dataset.adminLink='';
  const header=$('div','room-workspace-head');
  header.append($('h1','',creating?'إضافة غرفة':'تعديل الغرفة'));
  if(!creating)header.append($('span','room-workspace-name',draft.general.name));
  container.append(back,header);
  if(!creating){
    const tabs=$('nav','room-workspace-tabs');tabs.setAttribute('aria-label','أقسام إدارة الغرفة');
    for(const [key,label] of roomTabs){
      const link=$('a','room-workspace-tab',label);
      link.href=`admin.html?view=room&id=${encodeURIComponent(draft.roomId)}&tab=${key}`;
      link.dataset.adminLink='';
      if(currentTab===key)link.setAttribute('aria-current','page');
      tabs.append(link);
    }
    container.append(tabs);
  }
  const bar=$('div','room-savebar');
  const state=$('span','room-draft-status');state.setAttribute('role','status');
  state.setAttribute('aria-live','polite');
  const actions=$('div','room-savebar-actions');
  const discard=btn('تجاهل التغييرات','mini-action');
  discard.addEventListener('click',()=>onDiscard());
  const save=btn(creating?'إنشاء الغرفة':'حفظ جميع التغييرات','button-dark');
  save.addEventListener('click',()=>onSave());
  actions.append(discard,save);bar.append(state,actions);container.append(bar);
  function sync(){
    const dirty=draft.isDirty();
    bar.classList.toggle('is-dirty',dirty);
    state.classList.toggle('error',draft.statusError);
    state.textContent=draft.status||(dirty?'تغييرات غير محفوظة':'جميع التغييرات محفوظة');
    save.disabled=draft.saving||draft.locked||!dirty;
    discard.hidden=!dirty||draft.saving||draft.locked;
  }
  const unsubscribe=draft.subscribe(sync);sync();
  if(currentTab==='settings'||creating){
    renderSettings({draft,container,onSave});
    if(!creating&&onDelete)renderDeleteRoom({container,onDelete});
  }
  else if(currentTab==='hints')renderHints({draft,container,rerender});
  else renderMediaTab({draft,container,tab:currentTab,rerender});
  return unsubscribe;
}

function settingsGroup(title,description){
  const section=$('section','panel settings-section');
  const head=$('div','settings-section-head');
  head.append($('h2','',title));
  if(description)head.append($('p','',description));
  section.append(head);return section;
}

function renderSettings({draft,container,onSave}){
  const g=draft.general,p=window.normalizePresentationSettings(g.presentation);
  const form=$('form','room-settings-form');
  const main=settingsGroup('بيانات الغرفة');
  const name=input('text',g.name,120);name.required=true;name.name='room-name';
  const description=$('textarea','admin-textarea');description.maxLength=2000;
  description.rows=3;description.value=g.description;
  const duration=input('number',String(Math.round(g.durationSeconds/60)));
  duration.min='1';duration.max='99';duration.required=true;
  const active=input('checkbox');active.checked=g.active;active.className='status-toggle-input';
  active.setAttribute('role','switch');active.setAttribute('aria-label','حالة الغرفة');
  const activeText=$('strong','status-toggle-text');
  const syncActive=()=>{activeText.textContent=active.checked?'نشطة':'غير نشطة';
    active.setAttribute('aria-checked',String(active.checked));};
  active.addEventListener('change',syncActive);syncActive();
  const status=$('label','status-toggle-row');
  status.append($('span','','حالة الغرفة'),active,$('span','status-toggle-track'),activeText);
  const base=$('div','settings-fields');
  base.append(labelled('اسم الغرفة',name),labelled('الوصف',description),
    labelled('مدة اللعبة الافتراضية بالدقائق',duration),status);main.append(base);
  const appearance=settingsGroup('الهوية والخلفية');
  const roomImage=uploadControl({label:'صورة الغرفة',kind:'image',
    currentRef:g.imageRef,staged:draft.imageStage,
    onChange:(file,url)=>draft.stageImage(file,url)});
  appearance.append(roomImage.element);
  const display=settingsGroup('العرض أثناء اللعب');
  const timerScale=range(p.timerScale,0.7,1.3,0.05);
  const timerPosition=select([['top','أعلى الشاشة'],['center','وسط الشاشة'],['bottom','أسفل الشاشة']],p.timerPosition);
  const timerColor=input('color',p.timerColor);
  const timerFont=select([['mono','أرقام واضحة'],['serif','خط أحاجي']],p.timerFont);
  const hintScale=range(p.hintScale,0.75,1.5,0.05);
  const hintPosition=select([['top','أعلى الشاشة'],['bottom','أسفل الشاشة']],p.hintPosition);
  const hintDuration=input('number',String(p.hintDurationSeconds));
  hintDuration.min='0';hintDuration.max='120';
  const imageFit=select([['contain','إظهار الصورة كاملة'],['cover','ملء المساحة']],p.imageFit);
  const videoFit=select([['contain','إظهار المقطع كاملاً'],['cover','ملء المساحة']],p.videoFit);
  const winMessage=input('text',p.winMessage,80),loseMessage=input('text',p.loseMessage,80);
  winMessage.required=true;loseMessage.required=true;
  const controls={timerScale,timerPosition,timerColor,timerFont,hintScale,hintPosition,
    hintDuration,imageFit,videoFit,winMessage,loseMessage};
  const hintDurationField=labelled('مدة ظهور التلميح بالثواني',hintDuration,
    'صفر يعني إبقاء التلميح حتى الحدث التالي.');
  hintDurationField.classList.add('wide-field');
  const fields=$('div','settings-fields');
  fields.append(labelled('حجم المؤقت',timerScale),labelled('موضع المؤقت',timerPosition),
    labelled('لون المؤقت',timerColor),labelled('خط المؤقت',timerFont),
    labelled('حجم التلميح',hintScale),labelled('موضع التلميح',hintPosition),
    hintDurationField,labelled('طريقة عرض الصور',imageFit),
    labelled('طريقة عرض المقاطع',videoFit),
    labelled('رسالة الفوز',winMessage),labelled('رسالة الخسارة',loseMessage));
  display.append(fields);
  const preview=makePreview(form,{name:g.name,backgroundImage:g.imageRef},roomImage,controls);
  form.append(main,appearance,display,preview);container.append(form);
  const syncGeneral=()=>draft.setGeneral({name:name.value,description:description.value,
    durationSeconds:Number(duration.value)*60,active:active.checked});
  for(const control of [name,description,duration,active]){
    control.addEventListener('input',syncGeneral);
    control.addEventListener('change',syncGeneral);
  }
  const syncPresentation=()=>draft.setPresentation(readPresentation(controls));
  for(const control of Object.values(controls)){
    control.addEventListener('input',syncPresentation);
    control.addEventListener('change',syncPresentation);
  }
  form.addEventListener('submit',event=>{event.preventDefault();onSave();});
}

function renderDeleteRoom({container,onDelete}){
  const section=settingsGroup('حذف الغرفة',
    'يُحذف نهائياً مع تلميحاتها ووسائطها. الغرفة التي لُعبت فيها جلسات لا تُحذف؛ أوقفها بدلاً من ذلك.');
  section.classList.add('room-delete-section');
  const remove=btn('حذف الغرفة نهائياً','mini-action danger room-delete-button');
  remove.addEventListener('click',()=>onDelete());
  section.querySelector('.settings-section-head').append(remove);
  container.append(section);
}

function renderHints({draft,container,rerender}){
  const panel=settingsGroup('التلميحات','رتّب التلميحات هنا، ثم احفظ جميع التغييرات لتظهر لمدير اللعبة.');
  const add=btn('＋ إضافة تلميح','button-dark');
  panel.querySelector('.settings-section-head').append(add);
  add.addEventListener('click',()=>editHint(null));
  const list=$('ol','workspace-list');
  if(!draft.hints.length)panel.append($('p','panel-empty','لا توجد تلميحات لهذه الغرفة.'));
  draft.hints.forEach((hint,index)=>{
    const item=$('li','workspace-row');item.dataset.hintId=hint.id;
    const handle=btn('⠿','hint-drag-handle');handle.dataset.dragHandle='';
    handle.setAttribute('aria-describedby','hint-sort-instructions');
    handle.setAttribute('aria-pressed','false');
    item.append(handle,$('span','item-index',String(index+1).padStart(2,'0')));
    const copy=$('p','workspace-row-text',hint.text);copy.dir='auto';item.append(copy);
    const actions=$('div','item-actions');
    const edit=btn('تعديل','mini-action');edit.addEventListener('click',()=>editHint(hint));
    const remove=btn('حذف','mini-action danger');
    remove.addEventListener('click',()=>{draft.removeHint(hint.id);rerender();});
    actions.append(edit,remove);item.append(actions);list.append(item);
  });
  panel.append(list);container.append(panel);
  if(draft.hints.length)installHintSorting({list,onReorder:ids=>draft.reorderHints(ids),
    onSaved:rerender,onError:message=>formMessage(panel,message)});
  function editHint(hint){
    makeDialog(hint?'تعديل التلميح':'إضافة تلميح',(form,dialog)=>{
      const content=$('textarea','admin-textarea');
      content.rows=5;content.maxLength=2000;content.required=true;
      content.value=hint?.text||'';
      form.append(labelled('نص التلميح',content));
      const stage=btn('إضافة إلى المسودة','button-dark');stage.type='submit';form.append(stage);
      form.addEventListener('submit',event=>{
        event.preventDefault();
        const text=content.value.trim();
        if(!text){formMessage(form,'اكتب نص التلميح.');return;}
        draft.upsertHint({id:hint?.id,text});dialog.close();rerender();
      });
    });
  }
}

function renderMediaTab({draft,container,tab,rerender}){
  const config={
    images:{kind:'gm_image',type:'image',title:'مكتبة الصور',
      description:'صور يختارها مدير اللعبة ويعرضها أثناء الجلسة.',action:'إضافة صورة'},
    videos:{kind:'gm_video',type:'video',title:'مكتبة مقاطع مدير اللعبة',
      description:'مقاطع يختارها مدير اللعبة ويعرضها يدوياً على شاشة العرض.',action:'إضافة مقطع'},
    audio:{kind:'gm_sound',type:'audio',title:'مكتبة أصوات مدير اللعبة',
      description:'أصوات يختارها مدير اللعبة ويشغّلها يدوياً أثناء اللعب.',action:'إضافة صوت'}
  }[tab];
  const library=settingsGroup(config.title,config.description);
  library.classList.add('media-library-section');
  const add=btn(`＋ ${config.action}`,'button-dark');
  library.querySelector('.settings-section-head').append(add);
  add.addEventListener('click',()=>editMedia(null,config.kind,config.type,config.action));
  const records=draft.media.filter(item=>item.kind===config.kind);
  const grid=$('div',`workspace-media-grid media-grid-${config.type}`);
  if(!records.length)library.append($('p','panel-empty','المكتبة فارغة. أضف ملفاً ليصبح متاحاً لمدير اللعبة بعد الحفظ.'));
  for(const record of records){
    const card=$('article','workspace-media-card room-media-card');
    const url=record.url||assetUrl(record.assetRef);
    if(config.type==='audio')card.append(createAudioPlayer({src:url,label:record.label||fileName(record.assetRef)}));
    else if(url){
      const media=$(config.type==='image'?'img':'video');media.src=url;
      if(config.type==='image'){
        media.alt=record.label||'صورة الغرفة';media.decoding='async';
        const frame=$('div','media-image-frame');frame.append(media);card.append(frame);
        withImageSkeleton(media,frame);
      }else{media.controls=true;media.preload='metadata';card.append(media);}
    }
    const text=$('div','media-card-copy');
    text.append($('strong','',record.label||'ملف بلا اسم'),
      $('small','',record.file?.name||fileName(record.assetRef)));
    card.append(text);
    const actions=$('div','item-actions');
    const replace=btn('تغيير الملف أو الاسم','mini-action');
    replace.addEventListener('click',()=>editMedia(record,record.kind,config.type,config.action));
    const remove=btn('حذف من المكتبة','mini-action danger');
    remove.addEventListener('click',()=>{draft.removeMedia(record.id);rerender();});
    actions.append(replace,remove);card.append(actions);grid.append(card);
  }
  library.append(grid);container.append(library);
  if(tab==='videos'){
    const automatic=settingsGroup('مقاطع أحداث اللعبة',
      'مقطع مستقل يعمل تلقائياً عند انتهاء الجلسة بالخسارة. لا يظهر في مكتبة مدير اللعبة.');
    automatic.append(systemCard('lose_video','مقطع الخسارة','video',
      'يُعرض على شاشة العرض عندما ينهي مدير اللعبة الجلسة بنتيجة خسارة.'));
    container.append(automatic);
  }
  if(tab==='audio'){
    const automatic=settingsGroup('أصوات أحداث اللعبة',
      'أصوات مستقلة يشغّلها النظام تلقائياً؛ لا تظهر في مكتبة مدير اللعبة.');
    automatic.append(systemCard('hint_sound','صوت إشعار التلميح','audio',
      'يعمل عندما يصل تلميح إلى شاشة العرض.'));
    automatic.append(systemCard('lose_sound','صوت الخسارة','audio',
      'يعمل عندما تنتهي الجلسة بنتيجة خسارة.'));
    container.append(automatic);
  }
  function systemCard(kind,title,type,explanation){
    const record=draft.media.find(item=>item.kind===kind);
    const card=$('article','automatic-media-card');
    const heading=$('div','automatic-media-head');
    const copy=$('div','automatic-media-copy');
    copy.append($('h3','',title),$('p','',explanation));
    heading.append(copy,$('span',`automatic-media-state ${record?'assigned':''}`,
      record?'مُعد':'اختياري · غير مُعد'));
    card.append(heading);
    if(record){
      const url=record.url||assetUrl(record.assetRef);
      const preview=$('div','automatic-media-preview');
      if(type==='audio')preview.append(createAudioPlayer({src:url,label:title}));
      else if(url){const video=$('video');video.src=url;video.controls=true;
        video.preload='metadata';preview.append(video);}
      preview.append($('small','',record.file?.name||fileName(record.assetRef)));
      card.append(preview);
    }else card.append($('p','automatic-media-empty','لم يُختر ملف لهذا الحدث.'));
    const actions=$('div','item-actions automatic-media-actions');
    const manage=btn(record?`تغيير ${title}`:`إضافة ${title}`,'mini-action');
    manage.addEventListener('click',()=>editMedia(record||null,kind,type,title));
    actions.append(manage);
    if(record){const remove=btn(`إزالة ${title}`,'mini-action danger');
      remove.addEventListener('click',()=>{draft.removeMedia(record.id);rerender();});
      actions.append(remove);}
    card.append(actions);return card;
  }
  function editMedia(record,kind,type,title){
    makeDialog(record?`تغيير ${title}`:title,(form,dialog)=>{
      const label=kind.startsWith('gm_')?input('text',record?.label||'',120):null;
      if(label){label.required=true;form.append(labelled('اسم الملف',label));}
      const upload=uploadControl({label:'الملف',kind:type,
        currentRef:record?.assetRef||'',staged:record?.file?record:null,
        required:!record?.assetRef,allowRemove:false});
      form.append(upload.element);
      const stage=btn('إضافة إلى المسودة','button-dark');stage.type='submit';form.append(stage);
      dialog.addEventListener('close',()=>upload.dispose(),{once:true});
      form.addEventListener('submit',event=>{
        event.preventDefault();
        try{
          upload.validate();
          if(label&&!label.value.trim())throw new Error('اكتب اسم الملف.');
          const selected=upload.take();
          draft.upsertMedia({id:record?.id,kind,
            label:label?label.value.trim():title,
            assetRef:record?.assetRef||'',
            file:selected.file,url:selected.url});
          dialog.close();rerender();
        }catch(error){formMessage(form,error.message||'تعذّر إضافة الملف إلى المسودة.');}
      });
    });
  }
}
