// Download and verify the bytes of Ahaji's public room-assets bucket.
// Usage: node scripts/backup-room-assets.mjs backup backups/full.json
//        node scripts/backup-room-assets.mjs verify backups/full.json
//        node scripts/backup-room-assets.mjs restore-disposable backups/full.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = 'gbhleqizxcmxmutgcjon';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safeName = name => typeof name === 'string' &&
  /^[a-z][a-z0-9_-]{0,63}\/[A-Za-z0-9._-]+$/.test(name) && !name.includes('..');
const targetDir = file => resolve(file.replace(/\.json$/i, '') + '-assets');
const run = promisify(execFile);
async function download(url, destination) {
  // Windows' configured proxy and certificate store can work when Node fetch
  // cannot. Invoke the OS downloader with separate arguments, never a shell
  // command assembled from Storage paths.
  if (process.platform === 'win32') {
    const helper = fileURLToPath(new URL('./download-room-asset.ps1', import.meta.url));
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', helper,
      '-Uri', url, '-Destination', destination], { timeout: 90000 });
    return readFile(destination);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Storage download failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
async function snapshot(file) {
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (value.format !== 'ahaji-full-snapshot-v1' || value.project_ref !== project ||
      !Array.isArray(value.storage_objects)) throw new Error('Wrong backup format or project.');
  for (const item of value.storage_objects) {
    if (item.bucket_id !== 'room-assets' || !safeName(item.name))
      throw new Error('Unsafe Storage object path.');
  }
  return value;
}
async function backup(file) {
  const value = await snapshot(file);
  const folder = targetDir(file);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const objects = [];
  for (const item of value.storage_objects) {
    const url = `https://${project}.supabase.co/storage/v1/object/public/room-assets/` +
      item.name.split('/').map(encodeURIComponent).join('/');
    const destination = resolve(folder, item.name);
    if (!destination.startsWith(folder + sep)) throw new Error('Path escaped backup directory.');
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const bytes = await download(url, destination);
    if (bytes.length > 10 * 1024 * 1024) throw new Error(`Object exceeds 10 MB: ${item.name}`);
    if (process.platform !== 'win32')
      await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    objects.push({ name: item.name, bytes: bytes.length, sha256: hash(bytes) });
  }
  const manifest = { format: 'ahaji-room-assets-manifest-v1', project_ref: project,
    snapshot_sha256: hash(await readFile(file)), objects };
  await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ result: 'backed-up', objects: objects.length }));
}
async function verify(file) {
  const value = await snapshot(file);
  const folder = targetDir(file);
  const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  if (manifest.project_ref !== project || manifest.snapshot_sha256 !== hash(await readFile(file)) ||
      manifest.objects.length !== value.storage_objects.length)
    throw new Error('Storage backup manifest does not match snapshot.');
  for (const item of manifest.objects) {
    if (!safeName(item.name)) throw new Error('Unsafe manifest path.');
    const bytes = await readFile(resolve(folder, item.name));
    if (bytes.length !== item.bytes || hash(bytes) !== item.sha256)
      throw new Error(`Object digest mismatch: ${item.name}`);
  }
  console.log(JSON.stringify({ result: 'verified', objects: manifest.objects.length }));
}
async function restoreDisposable(file) {
  await verify(file);
  const source = targetDir(file);
  const destinationRoot = source + '-restored';
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  await mkdir(destinationRoot, { recursive: false, mode: 0o700 });
  for (const item of manifest.objects) {
    if (!safeName(item.name)) throw new Error('Unsafe manifest path.');
    const destination = resolve(destinationRoot, item.name);
    if (!destination.startsWith(destinationRoot + sep)) throw new Error('Path escaped restore directory.');
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const bytes = await readFile(resolve(source, item.name));
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    const restored = await readFile(destination);
    if (restored.length !== item.bytes || hash(restored) !== item.sha256)
      throw new Error(`Restored object digest mismatch: ${item.name}`);
  }
  console.log(JSON.stringify({ result: 'restored-disposable', objects: manifest.objects.length }));
}
const [command, path] = process.argv.slice(2);
if (!path || !['backup', 'verify', 'restore-disposable'].includes(command))
  throw new Error('Use backup|verify|restore-disposable <snapshot.json>.');
if (command === 'backup') await backup(resolve(path));
else if (command === 'verify') await verify(resolve(path));
else await restoreDisposable(resolve(path));
