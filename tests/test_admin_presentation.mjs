import assert from 'node:assert/strict';
import test from 'node:test';
import { metricLabel, roomMetrics } from '../js/admin/room-metrics.mjs';
import { profileInitial, profileName } from '../js/admin/profile-avatar.mjs';

test('counts only supported media kinds and formats Arabic hint counts', () => {
  const metrics = roomMetrics({ hints: [{}, {}], mediaRecords: [
    { kind: 'gm_image' }, { kind: 'lose_video' }, { kind: 'hint_sound' },
    { kind: 'lose_sound' }, { kind: 'gm_sound' }, { kind: 'unknown' }
  ] });
  assert.deepEqual(metrics, { hints: 2, images: 1, videos: 1, audio: 3 });
  assert.equal(metricLabel('hints', 1), '1 تلميح');
  assert.equal(metricLabel('hints', 2), 'تلميحان');
  assert.equal(metricLabel('hints', 5), '5 تلميحات');
  assert.equal(metricLabel('hints', 50), '50 تلميحًا');
  assert.equal(metricLabel('images', 2), 'صورتان');
  assert.equal(metricLabel('videos', 0), '0 فيديوهات');
});

test('avatar initial prefers display name, then email, then neutral fallback', () => {
  assert.equal(profileInitial({ user_metadata: { display_name: '  عائشة' }, email: 'a@example.com' }), 'ع');
  assert.equal(profileInitial({ user_metadata: { full_name: 'Maya Lee' }, email: 'a@example.com' }), 'M');
  assert.equal(profileInitial({ email: '.rayan@example.com' }), 'R');
  assert.equal(profileInitial({}), '•');
  assert.equal(profileName({ user_metadata: { name: '  Sara  ' } }), 'Sara');
  assert.equal(profileName({ email: 'a@example.com' }), 'a@example.com');
  assert.equal(profileName({}), '');
});
