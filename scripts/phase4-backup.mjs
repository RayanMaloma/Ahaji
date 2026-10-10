// Phase 4/5 application backup. Auth credentials/tokens are intentionally absent.
// Usage: node scripts/phase4-backup.mjs package backups/<snapshot>.json
//        node scripts/phase4-backup.mjs verify backups/<snapshot>.json backups/<restored>.json
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = 'gbhleqizxcmxmutgcjon';
const migrations = [
  ['20261009232032', 'phase3_foundation'],
  ['20261010113916', 'phase4_auth_roles'],
  ['20261010115013', 'phase4_inactive_room_guard'],
  ['20261010120931', 'phase5_admin_staff_directory']
];
function acceptedVersions(snapshot) {
  const versions = snapshot?.migration_versions;
  if (!Array.isArray(versions) || ![3,4].includes(versions.length) ||
      canonical(versions) !== canonical(migrations.slice(0,versions.length).map(item=>item[0]))) {
    throw new Error('Unexpected migration versions.');
  }
  return versions;
}
const columns = {
  rooms: ['id','name','thumbnail_ref','background_ref','default_duration_seconds','display_order','is_active','created_at','updated_at'],
  room_hints: ['id','room_id','body','display_order','created_at','updated_at'],
  room_media: ['id','room_id','kind','label','asset_ref','display_order','created_at','updated_at'],
  game_sessions: ['id','room_id','gm_user_id','status','result','state','revision','started_at','ended_at','created_at','updated_at'],
  staff_accounts: ['user_id','role','active','created_at','updated_at'],
  staff_room_access: ['user_id','room_id','created_at']
};
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_k, item) =>
  item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k,item[k]])) : item);

function validate(snapshot) {
  if (snapshot?.format !== 'ahaji-phase4-snapshot-v1' || snapshot.project_ref !== project) {
    throw new Error('Wrong snapshot project, format, or migration versions.');
  }
  acceptedVersions(snapshot);
  const inventory = snapshot.platform_inventory;
  if (!inventory || inventory.storage_buckets !== 0 || inventory.storage_objects !== 0 ||
      !Array.isArray(snapshot.auth_identity_map) || inventory.auth_users !== snapshot.auth_identity_map.length) {
    throw new Error('Storage or Auth inventory is incomplete for this backup format.');
  }
  const identities = new Set();
  const emails = new Set();
  for (const identity of snapshot.auth_identity_map) {
    if (!identity.id || !identity.email || typeof identity.confirmed !== 'boolean' ||
        typeof identity.deleted !== 'boolean' || identity.deleted ||
        identities.has(identity.id) || emails.has(identity.email.toLowerCase())) {
      throw new Error('Auth identity map contains deleted, duplicate, or incomplete records.');
    }
    identities.add(identity.id);
    emails.add(identity.email.toLowerCase());
  }
  if (!snapshot.tables || Object.keys(snapshot.tables).sort().join() !== Object.keys(columns).sort().join()) {
    throw new Error('Snapshot must contain all six Phase 4 application tables.');
  }
  for (const [table,names] of Object.entries(columns)) {
    if (!Array.isArray(snapshot.tables[table])) throw new Error(`${table} is not an array.`);
    for (const row of snapshot.tables[table]) {
      if (!row || Object.keys(row).sort().join() !== [...names].sort().join())
        throw new Error(`${table} row columns do not match the schema.`);
    }
  }
  if (snapshot.tables.game_sessions.length) {
    throw new Error('Session identity remapping is not supported until Phase 8.');
  }
  if (snapshot.tables.staff_accounts.some(row => !identities.has(row.user_id))) {
    throw new Error('Staff role references an identity missing from the backup.');
  }
  return snapshot;
}

function sql(value, column) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const string = column === 'state' ? JSON.stringify(value) : String(value);
  if (string.includes('\0')) throw new Error('NUL in backup data.');
  return `'${string.replaceAll("'", "''")}'${column === 'state' ? '::jsonb' : ''}`;
}

function restoreData(snapshot) {
  const lines = ['-- Restore into an empty replacement with Auth users re-invited and confirmed first.',
    'set standard_conforming_strings = on;', 'begin;'];
  for (const table of ['rooms','room_hints','room_media','game_sessions']) {
    const names = columns[table];
    for (const row of snapshot.tables[table]) {
      lines.push(`insert into public.${table} (${names.join(', ')}) values (${names.map(k => sql(row[k],k)).join(', ')});`);
    }
  }
  const emailFor = id => snapshot.auth_identity_map.find(user => user.id === id)?.email;
  for (const row of snapshot.tables.staff_accounts) {
    const email = emailFor(row.user_id);
    if (!snapshot.auth_identity_map.find(user => user.id === row.user_id).confirmed)
      throw new Error(`Staff role belongs to an unconfirmed identity: ${email}`);
    const lookup = `select id from auth.users where lower(email)=lower(${sql(email)}) and email_confirmed_at is not null and deleted_at is null`;
    lines.push(`do $$ begin if (select count(*) from (${lookup}) u) <> 1 then raise exception 'Verified Auth identity missing for staff restore'; end if; end $$;`);
    lines.push(`insert into public.staff_accounts (user_id,role,active,created_at,updated_at)
      select id,${sql(row.role)},${sql(row.active)},${sql(row.created_at)},${sql(row.updated_at)} from (${lookup}) u;`);
  }
  for (const row of snapshot.tables.staff_room_access) {
    const lookup = `select id from auth.users where lower(email)=lower(${sql(emailFor(row.user_id))}) and email_confirmed_at is not null and deleted_at is null`;
    lines.push(`insert into public.staff_room_access (user_id,room_id,created_at)
      select id,${sql(row.room_id)},${sql(row.created_at)} from (${lookup}) u;`);
  }
  lines.push('commit;');
  return lines.join('\n') + '\n';
}

function localAuthFixture(snapshot) {
  return '-- Disposable local PostgreSQL fixture only. Never apply to hosted Supabase.\n' +
    snapshot.auth_identity_map.map(user =>
      `insert into auth.users (id,email,email_confirmed_at,deleted_at) values (${sql(user.id)},${sql(user.email)},${user.confirmed ? 'now()' : 'null'},null);`
    ).join('\n') + '\n';
}

function evidence(snapshot) {
  return Object.fromEntries(Object.keys(columns).map(table => [table, {
    rows: snapshot.tables[table].length, sha256: sha(canonical(snapshot.tables[table]))
  }]));
}

async function packageBackup(path) {
  const raw = await readFile(path,'utf8');
  const snapshot = validate(JSON.parse(raw));
  const versions = acceptedVersions(snapshot);
  const base = path.replace(/\.json$/i,'');
  if (base === path) throw new Error('Snapshot path must end in .json.');
  const schemas = await Promise.all(migrations.slice(0,versions.length).map(async ([version,name]) => {
    return readFile(join(root,'supabase/migrations',`${version}_${name}.sql`),'utf8');
  }));
  const schema = schemas.join('\n');
  const data = restoreData(snapshot);
  const fixture = localAuthFixture(snapshot);
  const manifest = {
    format: 'ahaji-phase4-backup-manifest-v1', project_ref: project,
    captured_at: snapshot.captured_at, migration_versions: versions,
    auth_identity_count: snapshot.auth_identity_map.length,
    note: 'Auth passwords, sessions, tokens and provider settings are not backed up. Re-invite identities.',
    snapshot_sha256: sha(raw), schema_sha256: sha(schema), data_sha256: sha(data),
    local_auth_fixture_sha256: sha(fixture), tables: evidence(snapshot)
  };
  for (const [suffix,contents] of [['schema.sql',schema],['restore-data.sql',data],
    ['local-auth-fixture.sql',fixture],['manifest.json',JSON.stringify(manifest,null,2)+'\n']]) {
    await writeFile(`${base}-${suffix}`,contents,{flag:'wx',mode:0o600});
  }
  console.log(JSON.stringify({result:'packaged',counts:Object.fromEntries(Object.entries(manifest.tables).map(([k,v])=>[k,v.rows]))}));
}

async function verify(sourcePath,restoredPath) {
  const sourceRaw = await readFile(sourcePath,'utf8');
  const source = validate(JSON.parse(sourceRaw));
  const restored = validate(JSON.parse(await readFile(restoredPath,'utf8')));
  const base = sourcePath.replace(/\.json$/i,'');
  const manifest = JSON.parse(await readFile(`${base}-manifest.json`,'utf8'));
  if (manifest.project_ref !== project || manifest.snapshot_sha256 !== sha(sourceRaw) ||
      canonical(manifest.migration_versions) !== canonical(source.migration_versions) ||
      manifest.schema_sha256 !== sha(await readFile(`${base}-schema.sql`,'utf8')) ||
      manifest.data_sha256 !== sha(await readFile(`${base}-restore-data.sql`,'utf8')) ||
      manifest.local_auth_fixture_sha256 !== sha(await readFile(`${base}-local-auth-fixture.sql`,'utf8')) ||
      canonical(evidence(source)) !== canonical(manifest.tables) ||
      canonical(evidence(restored)) !== canonical(manifest.tables) ||
      canonical(source.auth_identity_map) !== canonical(restored.auth_identity_map)) {
    throw new Error('Restored data or backup files differ from the live snapshot.');
  }
  console.log(JSON.stringify({result:'verified',counts:Object.fromEntries(Object.entries(manifest.tables).map(([k,v])=>[k,v.rows]))}));
}

const [command,...args] = process.argv.slice(2);
if (command === 'package' && args.length === 1) await packageBackup(resolve(args[0]));
else if (command === 'verify' && args.length === 2) await verify(resolve(args[0]),resolve(args[1]));
else throw new Error('Use package <snapshot.json> or verify <snapshot.json> <restored.json>.');
