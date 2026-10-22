import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminRepository } from '../js/data/admin-repository.mjs';

const rpcClient=result=>{
  const calls=[];
  return {calls,client:{storage:{from:()=>({})},
    from(){throw new Error('rooms must not be deleted through table access');},
    rpc(name,args){calls.push([name,args]);return Promise.resolve(result);}}};
};

test('deleteRoom goes through admin_delete_room with the typed confirmation',async()=>{
  const summary={roomId:'anbar',sessions:7,events:40,hints:50,media:4,assignments:1};
  const {calls,client}=rpcClient({data:summary,error:null});
  assert.deepEqual(await createAdminRepository(client).deleteRoom('anbar','عنبر 23'),summary);
  assert.deepEqual(calls,[['admin_delete_room',{p_room_id:'anbar',p_confirm_name:'عنبر 23'}]]);
});

test('deleteRoom keeps backend refusal codes for the dialog',async()=>{
  for(const code of ['55006','22023','42501','P0002']){
    const {client}=rpcClient({data:null,error:{code,message:'refused'}});
    await assert.rejects(createAdminRepository(client).deleteRoom('anbar','عنبر 23'),{code});
  }
});

test('a failed new-room save rolls back through the same function',async()=>{
  const {calls,client}=rpcClient({data:{roomId:'room-x'},error:null});
  await createAdminRepository(client).deleteNewRoom('room-x','غرفة جديدة');
  assert.deepEqual(calls,[['admin_delete_room',{p_room_id:'room-x',p_confirm_name:'غرفة جديدة'}]]);
});
