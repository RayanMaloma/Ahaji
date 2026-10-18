// Non-destructive trim editor: picks start/end points over the original file.
// The file is never cut; Cast and GM play only the chosen range.
const el=(tag,className='',content)=>{const node=document.createElement(tag);
  if(className)node.className=className;if(content!==undefined)node.textContent=content;return node;};
const MIN_LENGTH_MS=200;

export function formatTrimTime(ms){
  if(!Number.isFinite(ms)||ms<0)ms=0;
  const tenths=Math.round(ms/100);
  const minutes=Math.floor(tenths/600),seconds=Math.floor(tenths/10)%60;
  return `${minutes}:${String(seconds).padStart(2,'0')}.${tenths%10}`;
}

// Converts slider positions to stored values. An end at (or within 50 ms of)
// the file's end is stored as null, meaning "play to the end".
export function trimValue(startMs,endMs,durationMs){
  const start=Math.max(0,Math.round(startMs));
  let end=Math.round(endMs);
  if(!Number.isFinite(durationMs)||end>=durationMs-50)end=null;
  if(end!==null&&end-start<MIN_LENGTH_MS)throw new Error('المقطع المحدد قصير جداً. اختر جزءاً أطول.');
  if(end===null&&Number.isFinite(durationMs)&&durationMs-start<MIN_LENGTH_MS)
    throw new Error('المقطع المحدد قصير جداً. اختر جزءاً أطول.');
  return {trimStartMs:start,trimEndMs:end};
}

export function createTrimEditor({src='',trimStartMs=0,trimEndMs=null}={}){
  const wrap=el('section','trim-editor');
  const head=el('div','trim-editor-head');
  head.append(el('strong','','قص الصوت'),
    el('small','','يبقى الملف الأصلي كما هو، ويُشغَّل الجزء المحدد فقط.'));
  const audio=el('audio');audio.preload='metadata';
  const slider=(label)=>{const input=el('input','trim-range');input.type='range';
    input.min='0';input.step='100';input.disabled=true;input.setAttribute('aria-label',label);return input;};
  const startInput=slider('بداية المقطع'),endInput=slider('نهاية المقطع');
  const startTime=el('output','trim-time','0:00.0'),endTime=el('output','trim-time','0:00.0');
  const row=(label,input,time)=>{const line=el('label','trim-row');
    line.append(el('span','trim-label',label),input,time);return line;};
  const summary=el('p','trim-summary');summary.setAttribute('role','status');
  const actions=el('div','trim-actions');
  const play=el('button','mini-action','تشغيل الجزء المحدد');play.type='button';play.disabled=true;
  const reset=el('button','mini-action','استخدام الملف كاملاً');reset.type='button';reset.disabled=true;
  actions.append(play,reset);
  wrap.append(head,row('البداية',startInput,startTime),row('النهاية',endInput,endTime),summary,actions,audio);

  let durationMs=NaN,pending={trimStartMs,trimEndMs},stopTimer=null;
  const stop=()=>{audio.pause();clearInterval(stopTimer);stopTimer=null;play.textContent='تشغيل الجزء المحدد';};
  function sync(){
    const start=Number(startInput.value),end=Number(endInput.value);
    startTime.textContent=formatTrimTime(start);endTime.textContent=formatTrimTime(end);
    if(!Number.isFinite(durationMs)){summary.textContent=src?'جارٍ تحميل الصوت…':'اختر ملفاً صوتياً أولاً.';return;}
    const length=end-start;
    summary.textContent=length<MIN_LENGTH_MS?'المقطع المحدد قصير جداً.'
      :`المدة المحددة ${formatTrimTime(length)} من أصل ${formatTrimTime(durationMs)}`;
    summary.classList.toggle('error',length<MIN_LENGTH_MS);
  }
  function load(nextSrc){
    stop();durationMs=NaN;src=nextSrc||'';
    for(const control of [startInput,endInput,play,reset])control.disabled=true;
    if(src)audio.src=src;else audio.removeAttribute('src');
    sync();
  }
  audio.addEventListener('loadedmetadata',()=>{
    durationMs=Math.floor(audio.duration*1000);
    if(!Number.isFinite(durationMs)||durationMs<=0){summary.textContent='تعذّر قراءة مدة الملف؛ سيُشغَّل كاملاً.';return;}
    for(const input of [startInput,endInput])input.max=String(durationMs);
    const start=Math.min(pending.trimStartMs||0,durationMs);
    const end=pending.trimEndMs==null?durationMs:Math.min(pending.trimEndMs,durationMs);
    startInput.value=String(start);endInput.value=String(Math.max(end,start));
    for(const control of [startInput,endInput,play,reset])control.disabled=false;
    sync();
  });
  audio.addEventListener('error',()=>{if(src)summary.textContent='تعذّر تحميل الصوت للمعاينة.';});
  // Keep the handles from crossing.
  startInput.addEventListener('input',()=>{if(Number(startInput.value)>Number(endInput.value))
    endInput.value=startInput.value;stop();sync();});
  endInput.addEventListener('input',()=>{if(Number(endInput.value)<Number(startInput.value))
    startInput.value=endInput.value;stop();sync();});
  play.addEventListener('click',async()=>{
    if(!audio.paused){stop();return;}
    const end=Number(endInput.value)/1000;
    audio.currentTime=Number(startInput.value)/1000;
    try{await audio.play();}catch{summary.textContent='تعذّر تشغيل الصوت للمعاينة.';return;}
    play.textContent='إيقاف';
    stopTimer=setInterval(()=>{if(audio.currentTime>=end||audio.ended)stop();},40);
  });
  reset.addEventListener('click',()=>{stop();startInput.value='0';endInput.value=String(durationMs);sync();});
  load(src);

  return {
    element:wrap,
    // A new file starts untrimmed; the old points belonged to the old file.
    setSource(nextSrc){pending={trimStartMs:0,trimEndMs:null};load(nextSrc);},
    value(){
      if(!Number.isFinite(durationMs))return {trimStartMs:pending.trimStartMs||0,trimEndMs:pending.trimEndMs??null};
      return trimValue(Number(startInput.value),Number(endInput.value),durationMs);
    },
    dispose(){stop();audio.removeAttribute('src');audio.load();}
  };
}
