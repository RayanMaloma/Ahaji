// Package and verify a full Ahaji application snapshot in ignored backups/.
// Usage: node scripts/full-backup.mjs package backups/full.json
//        node scripts/full-backup.mjs verify backups/full.json backups/restored.json
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const project='gbhleqizxcmxmutgcjon';
const tables={
  rooms:['id','name','thumbnail_ref','background_ref','default_duration_seconds','display_order','is_active','created_at','updated_at','description'],
  room_hints:['id','room_id','body','display_order','created_at','updated_at'],
  room_media:['id','room_id','kind','label','asset_ref','display_order','created_at','updated_at'],
  game_sessions:['id','room_id','gm_user_id','status','result','state','revision','started_at','ended_at','created_at','updated_at','remaining_seconds','ends_at','expires_at','cast_token_hash'],
  session_events:['id','session_id','room_id','actor_user_id','event_type','payload','created_at'],
  staff_accounts:['user_id','role','active','created_at','updated_at'],
  staff_room_access:['user_id','room_id','created_at'],
  admin_audit:['id','actor_user_id','action','entity_type','entity_id','before_record','after_record','created_at']
};
const jsonColumns=new Set(['state','payload','before_record','after_record','metadata']);
const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>
  item && !Array.isArray(item) && typeof item==='object'
    ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function validate(value){
  if(value?.format!=='ahaji-full-snapshot-v1'||value.project_ref!==project||
    !Array.isArray(value.migration_versions)||!Array.isArray(value.auth_identity_map)||
    !Array.isArray(value.storage_objects)||!value.tables||
    Object.keys(value.tables).sort().join()!==Object.keys(tables).sort().join())
    throw new Error('Incomplete or wrong-project snapshot.');
  for(const [name,columns] of Object.entries(tables)){
    if(!Array.isArray(value.tables[name]))throw new Error(`Missing ${name}.`);
    for(const row of value.tables[name])if(Object.keys(row).sort().join()!==[...columns].sort().join())
      throw new Error(`Unexpected ${name} columns.`);
  }
  if(value.platform_inventory.storage_objects!==value.storage_objects.length)
    throw new Error('Storage inventory is incomplete.');
  return value;
}
function sql(value,column){
  if(value===null)return 'null';
  if(typeof value==='boolean')return value?'true':'false';
  if(typeof value==='number')return String(value);
  const string=jsonColumns.has(column)?JSON.stringify(value):String(value);
  if(string.includes('\0'))throw new Error('NUL byte in snapshot.');
  return `'${string.replaceAll("'","''")}'${jsonColumns.has(column)?'::jsonb':''}`;
}
function insert(table,row){
  const names=tables[table];
  const override=['session_events','admin_audit'].includes(table)?' overriding system value':'';
  return `insert into public.${table} (${names.join(',')})${override} values (${names.map(k=>sql(row[k],k)).join(',')});`;
}
function restoreData(value){
  const lines=['-- Disposable PostgreSQL fixture only. Never apply directly to live Supabase.',
    'set standard_conforming_strings=on;','begin;'];
  for(const table of ['rooms','room_hints','room_media','staff_accounts','staff_room_access'])
    lines.push(`alter table public.${table} disable trigger user;`);
  for(const table of ['rooms','room_hints','room_media','staff_accounts','staff_room_access',
    'game_sessions','session_events','admin_audit'])
    for(const row of value.tables[table])lines.push(insert(table,row));
  for(const item of value.storage_objects){
    if(item.bucket_id!=='room-assets'||!/^[a-z][a-z0-9_-]{0,63}\/[A-Za-z0-9._-]+$/.test(item.name))
      throw new Error('Unsafe Storage object name.');
    lines.push(`insert into storage.objects(bucket_id,name,metadata) values ('room-assets',${sql(item.name)},${sql(item.metadata,'metadata')});`);
  }
  for(const table of ['rooms','room_hints','room_media','staff_accounts','staff_room_access'])
    lines.push(`alter table public.${table} enable trigger user;`);
  for(const table of ['session_events','admin_audit'])
    lines.push(`select setval(pg_get_serial_sequence('public.${table}','id'),
      greatest(1,coalesce((select max(id) from public.${table}),0)),
      (select count(*)>0 from public.${table}));`);
  lines.push('commit;');
  return lines.join('\n')+'\n';
}
function authFixture(value){
  return '-- Disposable local Auth fixture only. Never apply to hosted Supabase.\n'+
    value.auth_identity_map.map(user=>
      `insert into auth.users(id,email,email_confirmed_at,deleted_at) values (${sql(user.id)},${sql(user.email)},${user.confirmed?'now()':'null'},${user.deleted?'now()':'null'});`
    ).join('\n')+'\n';
}
const evidence=value=>Object.fromEntries(Object.keys(tables).map(name=>[name,{
  rows:value.tables[name].length,sha256:digest(canonical(value.tables[name]))
}]));
async function packageSnapshot(path){
  const raw=await readFile(path,'utf8');const value=validate(JSON.parse(raw));
  const dir=join(root,'supabase/migrations');const files=await readdir(dir);
  const sqlFiles=value.migration_versions.map(version=>{
    const matches=files.filter(file=>file.startsWith(`${version}_`)&&file.endsWith('.sql'));
    if(matches.length!==1)throw new Error(`Migration file missing or ambiguous: ${version}`);
    return join(dir,matches[0]);
  });
  const schema=(await Promise.all(sqlFiles.map(path=>readFile(path,'utf8')))).join('\n')+
    '\ninsert into supabase_migrations.schema_migrations(version) values '+
    value.migration_versions.map(version=>`(${sql(version)})`).join(',')+';\n';
  const data=restoreData(value);const auth=authFixture(value);
  const base=path.replace(/\.json$/i,'');if(base===path)throw new Error('Expected .json snapshot.');
  const manifest={format:'ahaji-full-backup-manifest-v1',project_ref:project,
    captured_at:value.captured_at,migration_versions:value.migration_versions,
    snapshot_sha256:digest(raw),schema_sha256:digest(schema),data_sha256:digest(data),
    auth_fixture_sha256:digest(auth),tables:evidence(value),
    storage_objects:value.storage_objects.length,
    note:'Auth passwords, tokens, sessions, MFA and Storage object bytes are separate.'};
  for(const [suffix,contents] of [['schema.sql',schema],['restore-data.sql',data],
    ['local-auth-fixture.sql',auth],['manifest.json',JSON.stringify(manifest,null,2)+'\n']])
    await writeFile(`${base}-${suffix}`,contents,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({result:'packaged',counts:Object.fromEntries(
    Object.entries(manifest.tables).map(([k,v])=>[k,v.rows]))}));
}
async function verify(sourcePath,restoredPath){
  const sourceRaw=await readFile(sourcePath,'utf8');
  const source=validate(JSON.parse(sourceRaw));
  const restored=validate(JSON.parse(await readFile(restoredPath,'utf8')));
  const base=sourcePath.replace(/\.json$/i,'');
  const manifest=JSON.parse(await readFile(`${base}-manifest.json`,'utf8'));
  if(manifest.project_ref!==project||manifest.snapshot_sha256!==digest(sourceRaw)||
    manifest.schema_sha256!==digest(await readFile(`${base}-schema.sql`,'utf8'))||
    manifest.data_sha256!==digest(await readFile(`${base}-restore-data.sql`,'utf8'))||
    manifest.auth_fixture_sha256!==digest(await readFile(`${base}-local-auth-fixture.sql`,'utf8'))||
    canonical(manifest.tables)!==canonical(evidence(source))||
    canonical(manifest.tables)!==canonical(evidence(restored))||
    canonical(source.auth_identity_map)!==canonical(restored.auth_identity_map)||
    canonical(source.storage_objects)!==canonical(restored.storage_objects))
    throw new Error('Restore or package digest mismatch.');
  console.log(JSON.stringify({result:'verified',counts:Object.fromEntries(
    Object.entries(manifest.tables).map(([k,v])=>[k,v.rows]))}));
}
const [command,...args]=process.argv.slice(2);
if(command==='package'&&args.length===1)await packageSnapshot(resolve(args[0]));
else if(command==='verify'&&args.length===2)await verify(resolve(args[0]),resolve(args[1]));
else throw new Error('Use package <snapshot.json> or verify <snapshot.json> <restored.json>.');
