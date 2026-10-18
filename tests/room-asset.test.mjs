import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// app.js is a classic browser script; load it into a sandbox to reach its globals.
const context = vm.createContext({ window: {}, document: undefined, crypto: globalThis.crypto });
vm.runInContext(`${readFileSync(new URL('../js/app.js', import.meta.url), 'utf8')}
;globalThis.resolveRoomAsset = resolveRoomAsset;`, context);
const { resolveRoomAsset } = context;
const base = 'https://gbhleqizxcmxmutgcjon.supabase.co/storage/v1/object/public/room-assets/';

test('room assets resolve once and stay stable when resolved again', () => {
  const url = resolveRoomAsset('storage://room-assets/room-1c0392f/map.png');
  assert.equal(url, `${base}room-1c0392f/map.png`);
  assert.equal(resolveRoomAsset(url), url);
  assert.equal(resolveRoomAsset('images/ahajilogo.svg'), 'images/ahajilogo.svg');
});

test('unknown hosts and unsafe paths are still rejected', () => {
  assert.equal(resolveRoomAsset('https://example.com/room-assets/a/b.png'), null);
  assert.equal(resolveRoomAsset(`${base}room/../secret.png`), null);
  assert.equal(resolveRoomAsset('images/../x'), null);
  assert.equal(resolveRoomAsset(null), null);
});
