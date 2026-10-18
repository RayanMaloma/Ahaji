import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { formatTrimTime, trimValue } from '../js/admin/audio-trim-editor.mjs';
import { createRoomDraft } from '../js/admin/room-draft.mjs';

const context = vm.createContext({ window: {}, document: undefined, crypto: globalThis.crypto });
vm.runInContext(`${readFileSync(new URL('../js/app.js', import.meta.url), 'utf8')}
;Object.assign(globalThis,{normalizeAudioTrim,isThemeEnabled,setRoomCatalog,getRoomMedia});`, context);
const { normalizeAudioTrim, isThemeEnabled, setRoomCatalog, getRoomMedia } = context;
const plain = value => JSON.parse(JSON.stringify(value));

test('malformed trims fall back to full playback', () => {
  assert.deepEqual(plain(normalizeAudioTrim({ trimStartMs: 1200, trimEndMs: 5000 })), { trimStartMs: 1200, trimEndMs: 5000 });
  assert.deepEqual(plain(normalizeAudioTrim(null)), { trimStartMs: 0, trimEndMs: null });
  assert.deepEqual(plain(normalizeAudioTrim({ trimStartMs: -5, trimEndMs: 'x' })), { trimStartMs: 0, trimEndMs: null });
  assert.deepEqual(plain(normalizeAudioTrim({ trimStartMs: 4000, trimEndMs: 3000 })), { trimStartMs: 4000, trimEndMs: null });
});

test('theme toggle defaults on only when the room has a theme', () => {
  const theme = { themeSound: { src: 'x.mp3' } };
  assert.equal(isThemeEnabled({}, theme), true);
  assert.equal(isThemeEnabled({ themeEnabled: false }, theme), false);
  assert.equal(isThemeEnabled({ themeEnabled: true }, { themeSound: null }), false);
});

test('room config carries theme and sound trims, resolved to Storage URLs', () => {
  setRoomCatalog([{ id: 'alfaw', name: 'الفاو', media: {
    hintSound: 'storage://room-assets/alfaw/hint.mp3', hintSoundTrim: { trimStartMs: 300, trimEndMs: 900 },
    themeSound: { src: 'storage://room-assets/alfaw/theme.mp3', trimStartMs: 1000, trimEndMs: null },
    gmSounds: [{ id: 's1', label: 'جرس', src: 'storage://room-assets/alfaw/bell.mp3', trimStartMs: 50, trimEndMs: 700 }]
  } }]);
  const media = getRoomMedia('alfaw');
  assert.match(media.themeSound.src, /room-assets\/alfaw\/theme\.mp3$/);
  assert.equal(media.themeSound.trimStartMs, 1000);
  assert.equal(media.hintSoundTrim.trimEndMs, 900);
  assert.equal(media.gmSounds[0].trimEndMs, 700);
  assert.equal(media.loseSoundTrim.trimStartMs, 0);
});

test('editor values store an end at the file end as null and reject tiny ranges', () => {
  assert.deepEqual(trimValue(1500.4, 9000, 20000), { trimStartMs: 1500, trimEndMs: 9000 });
  assert.deepEqual(trimValue(0, 19980, 20000), { trimStartMs: 0, trimEndMs: null });
  assert.throws(() => trimValue(5000, 5100, 20000), /قصير/);
  assert.equal(formatTrimTime(83450), '1:23.5');
});

test('draft trims mark media dirty and reach the save payload', () => {
  const draft = createRoomDraft({ id: 'alfaw', name: 'الفاو', contentRevision: 3,
    mediaRecords: [{ id: 'm1', kind: 'theme_sound', label: 'موسيقى الثيم',
      assetRef: 'storage://room-assets/alfaw/theme.mp3', trimStartMs: 0, trimEndMs: null }] });
  assert.equal(draft.isDirty(), false);
  draft.upsertMedia({ id: 'm1', kind: 'theme_sound', label: 'موسيقى الثيم',
    assetRef: 'storage://room-assets/alfaw/theme.mp3', trimStartMs: 2000, trimEndMs: 60000 });
  assert.equal(draft.groupDirty('media'), true);
  assert.deepEqual(draft.payload().media[0], { id: 'm1', kind: 'theme_sound', label: 'موسيقى الثيم',
    assetRef: 'storage://room-assets/alfaw/theme.mp3', trimStartMs: 2000, trimEndMs: 60000 });
});
