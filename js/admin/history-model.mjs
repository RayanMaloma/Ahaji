const terminal = new Set(['win','lose','timeout','expired','cancelled']);

// Only recorded gameplay intervals count. A countdown adjustment changes the
// clock display but never fabricates time played.
export function activeDuration(events, session, now = new Date()) {
  const ordered=[...events].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  let runningAt=null, seconds=0, sawStart=false, lastEnd=false;
  for(const event of ordered){
    const at=new Date(event.created_at).getTime();if(!Number.isFinite(at))continue;
    if(event.event_type==='start'||event.event_type==='resume'){
      if(runningAt===null)runningAt=at;
      sawStart=true;lastEnd=false;
    }else if(event.event_type==='pause'||terminal.has(event.event_type)){
      if(runningAt!==null){seconds+=Math.max(0,(at-runningAt)/1000);runningAt=null;}
      if(terminal.has(event.event_type))lastEnd=true;
    }
  }
  if(!sawStart)return {seconds:null,precise:false};
  if(runningAt!==null){
    const stop=session.ended_at ? new Date(session.ended_at).getTime() : new Date(now).getTime();
    if(Number.isFinite(stop))seconds+=Math.max(0,(stop-runningAt)/1000);
  }
  // A terminal event is preferred. Some legacy sessions have only ended_at;
  // their running interval is bounded but cannot be called precise.
  return {seconds:Math.round(seconds),precise:lastEnd||!session.ended_at};
}

export function dateKey(value, timeZone='Asia/Riyadh'){
  const date=new Date(value);if(Number.isNaN(date.getTime()))return '';
  return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'})
    .format(date);
}

export function groupLabel(key,timeZone='Asia/Riyadh',now=new Date()){
  const today=dateKey(now,timeZone);
  const yesterday=dateKey(new Date(now.getTime()-86400000),timeZone);
  if(key===today)return 'اليوم';
  if(key===yesterday)return 'أمس';
  return new Intl.DateTimeFormat('ar-SA',{timeZone,year:'numeric',month:'long',day:'numeric',
    numberingSystem:'latn'}).format(new Date(`${key}T12:00:00Z`));
}
