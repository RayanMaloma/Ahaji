const el=(tag,className='',content='')=>{const node=document.createElement(tag);
  node.className=className;node.textContent=content;return node;};
const clock=seconds=>{if(!Number.isFinite(seconds))return '0:00';
  const total=Math.max(0,Math.floor(seconds));return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;};

export function createAudioPlayer({src,label}) {
  const player=el('div','ahaji-audio-player');
  const audio=el('audio','sr-only');audio.preload='metadata';
  const name=el('strong','audio-name',label||'ملف صوتي');name.dir='auto';
  const control=el('div','audio-controls');
  const play=el('button','audio-play','▶');play.type='button';play.setAttribute('aria-label',`تشغيل ${label||'الصوت'}`);
  const elapsed=el('span','audio-time','0:00');
  const seek=el('input','audio-seek');seek.type='range';seek.min='0';seek.max='1000';seek.value='0';
  seek.disabled=true;seek.setAttribute('aria-label',`موضع تشغيل ${label||'الصوت'}`);
  const duration=el('span','audio-time','0:00');
  const mute=el('button','audio-mute','◖))');mute.type='button';mute.setAttribute('aria-label','كتم الصوت');
  const volume=el('input','audio-volume');volume.type='range';volume.min='0';volume.max='1';volume.step='0.05';volume.value='1';
  volume.setAttribute('aria-label',`مستوى صوت ${label||'الصوت'}`);
  const message=el('span','audio-message');message.setAttribute('role','status');
  control.append(play,elapsed,seek,duration,mute,volume);
  player.append(name,control,message,audio);
  function sync(){const length=audio.duration;
    const last=audio.seekable.length-1;
    seek.disabled=!Number.isFinite(length)||length<=0||last<0||
      audio.seekable.end(last)<=audio.seekable.start(0);
    seek.value=seek.disabled?'0':String(Math.round(audio.currentTime/length*1000));
    seek.style.setProperty('--audio-progress',`${Number(seek.value)/10}%`);
    elapsed.textContent=clock(audio.currentTime);duration.textContent=clock(length);
    play.textContent=audio.paused?'▶':'Ⅱ';
    play.setAttribute('aria-label',`${audio.paused?'تشغيل':'إيقاف مؤقت'} ${label||'الصوت'}`);
    mute.textContent=audio.muted||audio.volume===0?'◖':'◖))';
    mute.setAttribute('aria-label',audio.muted||audio.volume===0?'إلغاء كتم الصوت':'كتم الصوت');
  }
  if(src){audio.src=src;message.textContent='جارٍ تحميل الصوت…';}
  else{play.disabled=true;mute.disabled=true;volume.disabled=true;message.textContent='الملف الصوتي غير متاح.';}
  play.addEventListener('click',async()=>{
    if(!audio.paused){audio.pause();return;}
    message.textContent='جارٍ التشغيل…';
    try{await audio.play();message.textContent='';}
    catch{message.textContent='تعذّر تشغيل الصوت. تحقق من الملف أو إذن المتصفح.';sync();}
  });
  seek.addEventListener('input',()=>{if(!seek.disabled){try{audio.currentTime=Number(seek.value)/1000*audio.duration;}
    catch{message.textContent='لا يمكن الانتقال داخل هذا الملف.';}sync();}});
  mute.addEventListener('click',()=>{audio.muted=!audio.muted;sync();});
  volume.addEventListener('input',()=>{audio.volume=Number(volume.value);audio.muted=audio.volume===0;sync();});
  for(const event of ['loadedmetadata','durationchange','timeupdate','play','pause','volumechange','ended'])
    audio.addEventListener(event,()=>{if(event==='loadedmetadata')message.textContent='';sync();});
  audio.addEventListener('waiting',()=>{message.textContent='جارٍ التحميل…';});
  audio.addEventListener('canplay',()=>{message.textContent='';});
  audio.addEventListener('error',()=>{message.textContent='الملف الصوتي غير متاح أو صيغته غير مدعومة.';
    play.disabled=true;seek.disabled=true;});
  sync();return player;
}
