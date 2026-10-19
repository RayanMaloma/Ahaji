// staff-account-delete Edge Function logic with fake clients (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/staff-account-delete/handler.ts';

const TARGET = '11111111-1111-4111-8111-111111111111';

function setup({ prepare = { data: { already_prepared: false }, error: null }, deleteError = null, files = [] } = {}) {
  const calls = { rpc: [], deleted: [], removed: [] };
  const createClient = (_url, key) => key === 'secret' ? {
    auth: { admin: { deleteUser: async id => { calls.deleted.push(id); return { error: deleteError }; } } },
    storage: { from: bucket => ({
      list: async prefix => { assert.equal(bucket, 'profile-assets'); assert.equal(prefix, TARGET); return { data: files }; },
      remove: async paths => { calls.removed.push(...paths); return { error: null }; },
    }) },
  } : {
    auth: { getUser: async () => ({ data: { user: { id: 'caller' } }, error: null }) },
    rpc: async (name, args) => { calls.rpc.push({ name, args }); return prepare; },
  };
  const handler = createHandler({ createClient, env: () => ({ url: 'https://x', publishable: 'pub', secret: 'secret' }) });
  const call = (body, auth = 'Bearer t') => handler(new Request('https://fn', {
    method: 'POST', headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body) }));
  return { calls, call };
}

test('prepares through SQL as the caller, then deletes the Auth identity and avatar files', async () => {
  const { calls, call } = setup({ files: [{ name: 'a.png' }] });
  const response = await call({ user_id: TARGET });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'deleted', user_id: TARGET, retried: false });
  assert.deepEqual(calls.rpc, [{ name: 'admin_prepare_staff_deletion', args: { p_user_id: TARGET } }]);
  assert.deepEqual(calls.deleted, [TARGET]);
  assert.deepEqual(calls.removed, [`${TARGET}/a.png`]);
});

test('SQL refusals stop before any privileged action, with clear Arabic messages', async () => {
  const cases = [
    [{ code: '42501', message: 'Super Admin required' }, 403, 'الرئيسي فقط'],
    [{ code: '42501', message: 'You cannot delete your own account' }, 403, 'حسابك'],
    [{ code: '42501', message: 'Reserved operational accounts cannot be deleted' }, 403, 'محجوزة'],
    [{ code: '42501', message: 'At least one active Admin is required' }, 409, 'آخر مدير'],
    [{ code: 'P0002', message: 'Staff account not found' }, 404, 'غير موجود'],
  ];
  for (const [error, status, text] of cases) {
    const { calls, call } = setup({ prepare: { data: null, error } });
    const response = await call({ user_id: TARGET });
    assert.equal(response.status, status, error.message);
    assert.match((await response.json()).error, new RegExp(text));
    assert.equal(calls.deleted.length, 0);
  }
});

test('Auth deletion failure is reported as a partial result, never as success', async () => {
  const { call } = setup({ deleteError: { message: 'Database error deleting user' } });
  const response = await call({ user_id: TARGET });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.status, 'access_revoked');
  assert.match(body.error, /أعد المحاولة/);
});

test('a retry after the identity is already gone completes cleanly', async () => {
  const { call } = setup({ prepare: { data: { already_prepared: true }, error: null },
    deleteError: { message: 'User not found' } });
  const response = await call({ user_id: TARGET });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).retried, true);
});

test('unauthenticated or malformed requests are rejected', async () => {
  const { calls, call } = setup();
  assert.equal((await call({ user_id: TARGET }, null)).status, 401);
  assert.equal((await call({ user_id: 'not-a-uuid' })).status, 400);
  assert.equal(calls.rpc.length, 0);
});
