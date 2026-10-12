import test from 'node:test';
import assert from 'node:assert/strict';
import {activeDuration,dateKey,groupLabel} from '../js/admin/history-model.mjs';

const event=(event_type,minute)=>({event_type,
  created_at:new Date(Date.UTC(2026,9,12,8,minute)).toISOString()});

test('active duration excludes pauses and countdown adjustments',()=>{
  const events=[event('created',0),event('start',1),event('adjust',5),
    event('pause',11),event('resume',30),event('win',45)];
  assert.deepEqual(activeDuration(events,{ended_at:event('win',45).created_at}),
    {seconds:25*60,precise:true});
});
test('short sessions and missing events stay distinguishable',()=>{
  assert.deepEqual(activeDuration([event('start',0),event('lose',19)],
    {ended_at:event('lose',19).created_at}),{seconds:19*60,precise:true});
  assert.deepEqual(activeDuration([],{ended_at:event('lose',19).created_at}),
    {seconds:null,precise:false});
});
test('operational date follows Riyadh rather than UTC',()=>{
  assert.equal(dateKey('2026-10-11T22:30:00Z','Asia/Riyadh'),'2026-10-12');
  assert.equal(groupLabel('2026-10-12','Asia/Riyadh',new Date('2026-10-12T09:00:00Z')),'اليوم');
});
