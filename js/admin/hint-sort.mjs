// Pointer Events cover mouse, pen, and touch. The list is only persisted on
// drop (or keyboard confirmation), never while the pointer is moving.
export function installHintSorting({list,roomId,repository,onSaved,onError}) {
  const rows=()=>Array.from(list.querySelectorAll(':scope > li[data-hint-id]'));
  const ids=()=>rows().map(row=>row.dataset.hintId);
  const status=document.createElement('p');status.className='sr-only';status.id='hint-sort-status';
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const instructions=document.createElement('p');instructions.className='hint-sort-instructions';
  instructions.id='hint-sort-instructions';
  instructions.textContent='اسحب المقبض لترتيب التلميحات، أو اضغط مسافة ثم الأسهم أو Home و End، ثم Enter للحفظ. Escape للإلغاء.';
  list.before(instructions);list.after(status);
  let drag=null,saving=false,frame=0;
  function renumber(){rows().forEach((row,index)=>{
    row.querySelector('.item-index').textContent=String(index+1).padStart(2,'0');
    row.querySelector('[data-drag-handle]').setAttribute('aria-label',`ترتيب التلميح ${index+1} من ${rows().length}`);
  });}
  function restore(original){const byId=new Map(rows().map(row=>[row.dataset.hintId,row]));
    original.forEach(id=>list.append(byId.get(id)));renumber();}
  function finish(){cancelAnimationFrame(frame);frame=0;
    if(drag?.row){drag.row.classList.remove('is-dragging');drag.handle?.setAttribute('aria-pressed','false');}
    list.classList.remove('is-sorting');drag=null;}
  async function persist(original){const next=ids();finish();
    if(next.every((id,index)=>id===original[index])){status.textContent='لم يتغير ترتيب التلميحات.';return;}
    saving=true;list.classList.add('is-saving');
    try{await repository.reorderHints(roomId,next);status.textContent='حُفظ ترتيب التلميحات.';await onSaved();}
    catch(error){restore(original);status.textContent='تعذّر حفظ الترتيب. عاد الترتيب السابق.';
      onError(error.message||'تعذّر حفظ ترتيب التلميحات.');}
    finally{saving=false;list.classList.remove('is-saving');}
  }
  function moveAt(y){if(!drag)return;
    const target=document.elementFromPoint(drag.x,y)?.closest('li[data-hint-id]');
    if(!target||target.parentElement!==list||target===drag.row)return;
    const middle=target.getBoundingClientRect().top+target.getBoundingClientRect().height/2;
    if(y<middle)list.insertBefore(drag.row,target);
    else list.insertBefore(drag.row,target.nextSibling);
    renumber();status.textContent=`التلميح في الموضع ${rows().indexOf(drag.row)+1}.`;
  }
  function autoscroll(){if(!drag||drag.keyboard)return;
    const scroller=list.closest('.admin-main')||document.scrollingElement;
    const bounds=scroller===document.scrollingElement?{top:0,bottom:innerHeight}:scroller.getBoundingClientRect();
    const delta=drag.y<bounds.top+68?-18:drag.y>bounds.bottom-68?18:0;
    if(delta){scroller.scrollBy(0,delta);moveAt(drag.y);}
    frame=requestAnimationFrame(autoscroll);
  }
  list.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-drag-handle]');
    if(!handle||saving||event.button!==0)return;
    const row=handle.closest('li[data-hint-id]');
    drag={row,handle,original:ids(),x:event.clientX,y:event.clientY,startY:event.clientY,
      pointerId:event.pointerId,keyboard:false,started:false};
    handle.setPointerCapture(event.pointerId);event.preventDefault();
  });
  list.addEventListener('pointermove',event=>{
    if(!drag||drag.keyboard||event.pointerId!==drag.pointerId)return;
    drag.x=event.clientX;drag.y=event.clientY;
    if(!drag.started && Math.abs(event.clientY-drag.startY)>5){
      drag.started=true;drag.row.classList.add('is-dragging');list.classList.add('is-sorting');
      status.textContent='اسحب التلميح إلى موضعه الجديد.';frame=requestAnimationFrame(autoscroll);
    }
    if(drag.started)moveAt(event.clientY);
  });
  list.addEventListener('pointerup',event=>{
    if(!drag||drag.keyboard||event.pointerId!==drag.pointerId)return;
    const original=drag.original;drag.started?persist(original):finish();
  });
  list.addEventListener('pointercancel',()=>{if(drag&&!drag.keyboard){restore(drag.original);finish();}});
  list.addEventListener('keydown',event=>{
    const handle=event.target.closest('[data-drag-handle]');if(!handle||saving)return;
    const row=handle.closest('li[data-hint-id]');
    if(!drag && (event.key===' '||event.key==='Enter')){
      event.preventDefault();drag={row,handle,original:ids(),keyboard:true};
      row.classList.add('is-dragging');list.classList.add('is-sorting');
      handle.setAttribute('aria-pressed','true');status.textContent='التلميح جاهز للنقل. استخدم الأسهم ثم Enter للحفظ.';return;
    }
    if(!drag?.keyboard||drag.row!==row)return;
    if(event.key==='Escape'){event.preventDefault();restore(drag.original);finish();status.textContent='أُلغي تغيير الترتيب.';return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();persist(drag.original);return;}
    const all=rows(),index=all.indexOf(row);
    if(event.key==='ArrowUp'&&index>0)list.insertBefore(row,all[index-1]);
    else if(event.key==='ArrowDown'&&index<all.length-1)list.insertBefore(all[index+1],row);
    else if(event.key==='Home')list.prepend(row);
    else if(event.key==='End')list.append(row);
    else return;
    event.preventDefault();renumber();status.textContent=`التلميح في الموضع ${rows().indexOf(row)+1}.`;
  });
  renumber();
}
