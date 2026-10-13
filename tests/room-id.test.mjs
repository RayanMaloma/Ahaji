import assert from 'node:assert/strict';
import {test} from 'node:test';
import {roomIdBase,roomIdCandidate} from '../js/data/room-id.mjs';

test('room IDs derive from names and remain valid for Arabic and Latin names',()=>{
  assert.equal(roomIdBase('The Lost Room'),'the-lost-room');
  assert.match(roomIdBase('غرفة الألغاز'),/^room-[a-z0-9]+$/);
  assert.equal(roomIdBase('غرفة الألغاز'),roomIdBase('غرفة الألغاز'));
  for(const name of ['غرفة الألغاز','The Lost Room','123',''])
    assert.match(roomIdBase(name),/^[a-z][a-z0-9_-]{0,63}$/);
});

test('collisions get distinct valid suffixes without mutating the base',()=>{
  const base=roomIdBase('غرفة الألغاز');
  assert.equal(roomIdCandidate(base,0),base);
  assert.equal(roomIdCandidate(base,1),`${base}-2`);
  assert.equal(roomIdCandidate('a'.repeat(64),2).length,64);
});
