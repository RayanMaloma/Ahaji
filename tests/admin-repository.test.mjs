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

const cleanupClient=({pending,removeError=null,removeThrows=false})=>{
  const calls=[];
  const bucket={remove(names){calls.push(['remove',names]);
    if(removeThrows)return Promise.reject(new Error('network down'));
    return Promise.resolve({data:[],error:removeError});}};
  return {calls,client:{storage:{from:name=>{calls.push(['bucket',name]);return bucket;}},
    from(){throw new Error('no table access expected');},
    rpc(name,args){calls.push([name,args]);
      if(name==='admin_room_asset_cleanup_pending')return Promise.resolve({data:pending,error:null});
      return Promise.resolve({data:{removed:1,failed:0},error:null});}}};
};

test('storage cleanup removes only server-queued names and reports each result',async()=>{
  const {calls,client}=cleanupClient({pending:[{object_name:'room-x/a.png',room_id:'room-x',attempts:0},
    {object_name:'room-x/b.mp3',room_id:'room-x',attempts:2}]});
  await createAdminRepository(client).cleanupDeletedRoomAssets();
  assert.deepEqual(calls.filter(call=>call[0]!=='bucket'),[
    ['admin_room_asset_cleanup_pending',undefined],
    ['remove',['room-x/a.png','room-x/b.mp3']],
    ['admin_record_room_asset_cleanup',{p_results:[{name:'room-x/a.png',error:null},{name:'room-x/b.mp3',error:null}]}]]);
});

test('storage cleanup with nothing queued makes no Storage call',async()=>{
  const {calls,client}=cleanupClient({pending:[]});
  assert.deepEqual(await createAdminRepository(client).cleanupDeletedRoomAssets(),{removed:0,failed:0});
  assert.ok(!calls.some(call=>call[0]==='remove'||call[0]==='admin_record_room_asset_cleanup'));
});

test('storage failures are reported so the server keeps the files queued',async()=>{
  for(const options of [{removeError:{message:'quota'}},{removeThrows:true}]){
    const {calls,client}=cleanupClient({pending:[{object_name:'room-x/a.png',room_id:'room-x',attempts:0}],...options});
    await createAdminRepository(client).cleanupDeletedRoomAssets();
    const record=calls.find(call=>call[0]==='admin_record_room_asset_cleanup');
    assert.equal(record[1].p_results[0].name,'room-x/a.png');
    assert.ok(record[1].p_results[0].error,'error must be reported');
  }
});
