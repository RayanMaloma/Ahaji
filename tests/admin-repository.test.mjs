import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminRepository } from '../js/data/admin-repository.mjs';

const fakeClient=result=>{
  const calls=[];
  const query={
    delete(){calls.push('delete');return query;},
    eq(column,value){calls.push(['eq',column,value]);return query;},
    select(columns){calls.push(['select',columns]);return Promise.resolve(result);}
  };
  return {calls,client:{storage:{from:()=>({})},from(table){calls.push(['from',table]);return query;}}};
};

test('deleteRoom removes exactly the requested room',async()=>{
  const {calls,client}=fakeClient({data:[{id:'anbar'}],error:null});
  await createAdminRepository(client).deleteRoom('anbar');
  assert.deepEqual(calls,[['from','rooms'],'delete',['eq','id','anbar'],['select','id']]);
});

test('deleteRoom surfaces the session restriction and silent no-ops',async()=>{
  const restricted=fakeClient({data:null,error:{code:'23503',message:'violates foreign key'}});
  await assert.rejects(createAdminRepository(restricted.client).deleteRoom('anbar'),{code:'23503'});
  const missing=fakeClient({data:[],error:null});
  await assert.rejects(createAdminRepository(missing.client).deleteRoom('anbar'),/لم تُحذف الغرفة/);
});
