// Package a live MCP SQL snapshot, then compare a disposable PostgreSQL restore.
// Usage: node scripts/phase3-backup.mjs package backups/<live>.json
//        node scripts/phase3-backup.mjs verify backups/<live>.json backups/<restored>.json backups/<native>.dump
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationVersion = '20261009232032';
const migrationPath = join(root, 'supabase/migrations', `${migrationVersion}_phase3_foundation.sql`);
const projectRef = 'gbhleqizxcmxmutgcjon';
const columns = {
  rooms: ['id', 'name', 'thumbnail_ref', 'background_ref', 'default_duration_seconds', 'display_order', 'is_active', 'created_at', 'updated_at'],
  room_hints: ['id', 'room_id', 'body', 'display_order', 'created_at', 'updated_at'],
  room_media: ['id', 'room_id', 'kind', 'label', 'asset_ref', 'display_order', 'created_at', 'updated_at'],
  game_sessions: ['id', 'room_id', 'gm_user_id', 'status', 'result', 'state', 'revision', 'started_at', 'ended_at', 'created_at', 'updated_at']
};

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => {
  if (!item || Array.isArray(item) || typeof item !== 'object') return item;
  return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
});

function validate(snapshot) {
  if (snapshot?.format !== 'ahaji-phase3-snapshot-v1' ||
      snapshot.project_ref !== projectRef ||
      snapshot.migration_version !== migrationVersion) {
    throw new Error('Snapshot format, project, or migration version does not match Phase 3.');
  }
  const inventory = snapshot.platform_inventory;
  if (!inventory || ['auth_users', 'storage_buckets', 'storage_objects']
    .some(key => inventory[key] !== 0)) {
    throw new Error('Auth or Storage data exists; this Phase 3 exporter would be incomplete.');
  }
  if (!snapshot.tables || Object.keys(snapshot.tables).sort().join() !== Object.keys(columns).sort().join()) {
    throw new Error('Snapshot must contain exactly the four Phase 3 tables.');
  }
  for (const [table, names] of Object.entries(columns)) {
    if (!Array.isArray(snapshot.tables[table])) throw new Error(`${table} is not an array.`);
    for (const row of snapshot.tables[table]) {
      if (!row || Object.keys(row).sort().join() !== [...names].sort().join()) {
        throw new Error(`${table} row columns do not match the migration.`);
      }
    }
  }
  return snapshot;
}

function sqlValue(value, column) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numeric value in snapshot.');
    return String(value);
  }
  const text = column === 'state' ? JSON.stringify(value) : String(value);
  if (text.includes('\0')) throw new Error('NUL byte in snapshot string.');
  return `'${text.replaceAll("'", "''")}'${column === 'state' ? '::jsonb' : ''}`;
}

function dataSql(snapshot) {
  const lines = [
    '-- Generated from a live read-only Supabase snapshot. Restore into an empty database only.',
    'set standard_conforming_strings = on;',
    'begin;'
  ];
  for (const [table, names] of Object.entries(columns)) {
    for (const row of snapshot.tables[table]) {
      lines.push(`insert into public.${table} (${names.join(', ')}) values (${names.map(name => sqlValue(row[name], name)).join(', ')});`);
    }
  }
  lines.push('commit;');
  return lines.join('\n') + '\n';
}

function tableEvidence(snapshot) {
  return Object.fromEntries(Object.keys(columns).map(table => [table, {
    rows: snapshot.tables[table].length,
    sha256: hash(canonical(snapshot.tables[table]))
  }]));
}

async function packageSnapshot(path) {
  const raw = await readFile(path, 'utf8');
  const snapshot = validate(JSON.parse(raw));
  const schema = await readFile(migrationPath, 'utf8');
  const base = path.replace(/\.json$/i, '');
  if (base === path) throw new Error('Snapshot path must end in .json.');
  const sql = dataSql(snapshot);
  const manifest = {
    format: 'ahaji-phase3-backup-manifest-v1',
    project_ref: projectRef,
    captured_at: snapshot.captured_at,
    migration_version: migrationVersion,
    platform_inventory: snapshot.platform_inventory,
    source_snapshot_sha256: hash(raw),
    schema_sha256: hash(schema),
    restore_data_sha256: hash(sql),
    tables: tableEvidence(snapshot)
  };
  await writeFile(`${base}-schema.sql`, schema, { flag: 'wx', mode: 0o600 });
  await writeFile(`${base}-restore-data.sql`, sql, { flag: 'wx', mode: 0o600 });
  await writeFile(`${base}-manifest.json`, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ base, tables: Object.fromEntries(Object.entries(manifest.tables).map(([table, evidence]) => [table, evidence.rows])) }));
}

async function verifyRestore(sourcePath, restoredPath, nativePath) {
  const sourceRaw = await readFile(sourcePath, 'utf8');
  const source = validate(JSON.parse(sourceRaw));
  const restored = validate(JSON.parse(await readFile(restoredPath, 'utf8')));
  const base = sourcePath.replace(/\.json$/i, '');
  const manifest = JSON.parse(await readFile(`${base}-manifest.json`, 'utf8'));
  const schema = await readFile(`${base}-schema.sql`, 'utf8');
  const restoreData = await readFile(`${base}-restore-data.sql`, 'utf8');
  if (manifest.format !== 'ahaji-phase3-backup-manifest-v1' ||
      manifest.project_ref !== projectRef ||
      manifest.migration_version !== migrationVersion ||
      manifest.captured_at !== source.captured_at ||
      hash(sourceRaw) !== manifest.source_snapshot_sha256 ||
      hash(schema) !== manifest.schema_sha256 ||
      hash(restoreData) !== manifest.restore_data_sha256 ||
      schema !== await readFile(migrationPath, 'utf8') ||
      restoreData !== dataSql(source)) {
    throw new Error('Backup files or manifest do not match the live snapshot and migration.');
  }
  const expected = tableEvidence(source);
  const actual = tableEvidence(restored);
  if (canonical(expected) !== canonical(actual) || canonical(expected) !== canonical(manifest.tables)) {
    throw new Error('Restored table counts or row hashes differ from the live export.');
  }
  const nativeDump = await readFile(nativePath);
  if (nativeDump.length === 0) throw new Error('Native PostgreSQL dump is empty.');
  const verification = {
    result: 'verified',
    project_ref: projectRef,
    migration_version: migrationVersion,
    restored_tables: actual,
    native_dump_bytes: nativeDump.length,
    native_dump_sha256: hash(nativeDump)
  };
  await writeFile(`${base}-verification.json`, JSON.stringify(verification, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ result: verification.result, counts: Object.fromEntries(Object.entries(actual).map(([table, evidence]) => [table, evidence.rows])), native_dump_bytes: nativeDump.length }));
}

const [command, ...args] = process.argv.slice(2);
if (command === 'package' && args.length === 1) await packageSnapshot(resolve(args[0]));
else if (command === 'verify' && args.length === 3) await verifyRestore(...args.map(path => resolve(path)));
else throw new Error('Use package <live.json> or verify <live.json> <restored.json> <native.dump>.');
