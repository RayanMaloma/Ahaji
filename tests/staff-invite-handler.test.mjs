// Edge Function logic with fake clients (no network, no live Supabase).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, validRedirect, cleanName } from '../supabase/functions/staff-invite/handler.ts';

const ADMIN = { id: 'a0000000-0000-4000-8000-000000000001', email_confirmed_at: '2026-10-01T00:00:00Z' };
const INVITATION = '11111111-1111-4111-8111-111111111111';
const REDIRECT = 'http://127.0.0.1:8765/activate.html';

function setup({ staff = { role: 'admin', active: true, account_type: 'email' }, user = ADMIN, rpc = {}, invite } = {}) {
  const calls = { rpc: [], invite: [], deleted: [] };
  let created = 0;
  const createClient = (_url, key) => key === 'secret' ? {
    auth: { admin: {
      inviteUserByEmail: async (email, options) => {
        calls.invite.push({ email, options });
        if (invite) return invite(email);
        created += 1;
        return { data: { user: { id: `u000000${created}-0000-4000-8000-000000000000` } }, error: null };
      },
      deleteUser: async id => { calls.deleted.push(id); return { error: null }; },
    } },
  } : {
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'bad' } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: staff, error: null }) }) }) }),
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      const reply = rpc[name];
      return typeof reply === 'function' ? reply(args) : reply || { data: null, error: null };
    },
  };
  const handler = createHandler({ createClient, env: () => ({ url: 'https://x.supabase.co', publishable: 'pub', secret: 'secret' }) });
  const call = (body, auth = 'Bearer token') => handler(new Request('https://fn/staff-invite', {
    method: 'POST', headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body) }));
  return { calls, call };
}
const invite = (extra = {}) => ({ email: 'New.GM@Test.invalid', display_name: 'سارة', role: 'game_master',
  room_ids: ['anbar'], redirect_to: REDIRECT, ...extra });

test('admin invite creates an Auth invitation then a pending record with name, role and rooms', async () => {
  const { calls, call } = setup({ rpc: {
    admin_prepare_staff_invitation: { data: [{ user_id: null, mode: 'new' }], error: null },
    admin_record_staff_invitation: { data: INVITATION, error: null },
  } });
  const response = await call(invite());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'pending', invitation_id: INVITATION, email: 'new.gm@test.invalid' });
  assert.equal(calls.invite[0].email, 'new.gm@test.invalid');
  assert.equal(calls.invite[0].options.redirectTo, REDIRECT);
  assert.deepEqual(calls.invite[0].options.data, { ahaji_display_name: 'سارة', ahaji_role_label: 'مدير لعبة' });
  const recorded = calls.rpc.find(c => c.name === 'admin_record_staff_invitation').args;
  assert.deepEqual(recorded, { p_user_id: 'u0000001-0000-4000-8000-000000000000', p_email: 'new.gm@test.invalid',
    p_display_name: 'سارة', p_role: 'game_master', p_room_ids: ['anbar'] });
  assert.ok(!JSON.stringify(calls).match(/password/i), 'no password is generated or sent');
});

test('admin invitations carry no room assignments', async () => {
  const { calls, call } = setup({ rpc: {
    admin_prepare_staff_invitation: { data: [{ user_id: null, mode: 'new' }], error: null },
    admin_record_staff_invitation: { data: INVITATION, error: null } } });
  assert.equal((await call(invite({ role: 'admin' }))).status, 200);
  assert.deepEqual(calls.rpc.at(-1).args.p_room_ids, []);
  assert.equal(calls.invite[0].options.data.ahaji_role_label, 'مدير');
});

test('non-admin, unverified, operator, and anonymous callers are denied before any Auth action', async () => {
  for (const options of [{ staff: { role: 'game_master', active: true, account_type: 'email' } },
    { staff: { role: 'admin', active: false, account_type: 'email' } },
    { staff: { role: 'admin', active: true, account_type: 'operator' } },
    { user: { id: ADMIN.id, email_confirmed_at: null } }]) {
    const { calls, call } = setup(options);
    assert.equal((await call(invite())).status, 403);
    assert.equal(calls.invite.length, 0);
  }
  const { calls, call } = setup();
  assert.equal((await call(invite(), null)).status, 401);
  assert.equal(calls.invite.length, 0);
});

test('invalid details and unsafe activation addresses are rejected', async () => {
  const { calls, call } = setup();
  for (const body of [invite({ email: 'nope' }), invite({ role: 'owner' }), invite({ room_ids: ['Bad Room'] }),
    invite({ room_ids: ['anbar', 'anbar'] }), invite({ display_name: 'x'.repeat(81) }),
    invite({ redirect_to: 'https://evil.example/phish' }), invite({ redirect_to: 'javascript:alert(1)' }),
    invite({ redirect_to: 'https://user:pw@127.0.0.1/activate.html' })])
    assert.equal((await call(body)).status, 400, JSON.stringify(body));
  assert.equal(calls.invite.length, 0);
  assert.equal(validRedirect('http://192.168.1.5:8765/activate.html'), 'http://192.168.1.5:8765/activate.html');
  assert.equal(cleanName('  <b>Ali</b>\n  '), 'bAli/b');
});

test('duplicates are refused before any email is sent', async () => {
  const { calls, call } = setup({ rpc: { admin_prepare_staff_invitation: { data: null, error: { code: '23505' } } } });
  const response = await call(invite());
  assert.equal(response.status, 409);
  assert.equal(calls.invite.length, 0);
});

test('a failed record removes a newly created identity so no orphan link remains', async () => {
  const { calls, call } = setup({ rpc: {
    admin_prepare_staff_invitation: { data: [{ user_id: null, mode: 'new' }], error: null },
    admin_record_staff_invitation: { data: null, error: { code: '22023' } } } });
  assert.equal((await call(invite())).status, 400);
  assert.deepEqual(calls.deleted, ['u0000001-0000-4000-8000-000000000000']);
});

test('provider restrictions are reported, never treated as success', async () => {
  const { call } = setup({ rpc: { admin_prepare_staff_invitation: { data: [{ user_id: null, mode: 'new' }], error: null } },
    invite: () => ({ data: null, error: { message: 'Email address not authorized' } }) });
  assert.equal((await call(invite())).status, 424);
});

test('resend reuses an unconfirmed identity and replaces a confirmed passwordless one', async () => {
  const unconfirmed = setup({ rpc: { admin_refresh_staff_invitation: { data: [{ user_id: 'old', email: 'a@test.invalid',
    display_name: 'A', role: 'game_master', room_ids: ['anbar'], mode: 'reinvite' }], error: null } } });
  const first = await unconfirmed.call({ action: 'resend', invitation_id: INVITATION, redirect_to: REDIRECT });
  assert.equal(first.status, 200);
  assert.equal(unconfirmed.calls.deleted.length, 0);
  assert.equal(unconfirmed.calls.invite.length, 1);

  const confirmed = setup({ rpc: {
    admin_refresh_staff_invitation: { data: [{ user_id: 'old', email: 'a@test.invalid', display_name: 'A',
      role: 'game_master', room_ids: ['anbar'], mode: 'recreate' }], error: null },
    admin_record_staff_invitation: { data: '22222222-2222-4222-8222-222222222222', error: null } } });
  const second = await confirmed.call({ action: 'resend', invitation_id: INVITATION, redirect_to: REDIRECT });
  assert.equal(second.status, 200);
  assert.deepEqual(confirmed.calls.deleted, ['old']);
  assert.deepEqual(confirmed.calls.rpc.at(-1).args.p_room_ids, ['anbar']);
});

test('resend cooldown and revocation map to clear responses', async () => {
  const cooldown = setup({ rpc: { admin_refresh_staff_invitation: { data: null, error: { code: '55000' } } } });
  assert.equal((await cooldown.call({ action: 'resend', invitation_id: INVITATION, redirect_to: REDIRECT })).status, 429);
  assert.equal(cooldown.calls.invite.length, 0);
  const revoke = setup();
  const response = await revoke.call({ action: 'revoke', invitation_id: INVITATION });
  assert.equal(response.status, 200);
  assert.deepEqual(revoke.calls.rpc[0], { name: 'admin_revoke_staff_invitation', args: { p_invitation_id: INVITATION } });
  assert.equal((await revoke.call({ action: 'revoke', invitation_id: 'x' })).status, 400);
});
