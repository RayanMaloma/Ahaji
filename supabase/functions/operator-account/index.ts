import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const respond = (status: number, data: Record<string, unknown>) =>
  new Response(JSON.stringify(data), { status, headers });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed' });
  const bearer = request.headers.get('Authorization');
  if (!bearer?.startsWith('Bearer ')) return respond(401, { error: 'Sign in required' });
  const url = Deno.env.get('SUPABASE_URL');
  const publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}').default ||
    Deno.env.get('SUPABASE_ANON_KEY');
  const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default ||
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publishable || !secret) return respond(503, { error: 'Provisioning unavailable' });
  try {
    const caller = createClient(url, publishable, {
      global: { headers: { Authorization: bearer } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: identity, error: identityError } = await caller.auth.getUser();
    if (identityError || !identity.user) return respond(401, { error: 'Invalid session' });
    const { data: staff, error: staffError } = await caller.from('staff_accounts')
      .select('role,active,account_type').eq('user_id', identity.user.id).single();
    if (staffError || staff?.role !== 'admin' || !staff.active || staff.account_type !== 'email' ||
      !identity.user.email_confirmed_at) return respond(403, { error: 'Verified Admin required' });

    const body = await request.json();
    const action = String(body.action || 'create');
    const privileged = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const password = Array.from(bytes, byte => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[byte % 62]).join('') + '!9';

    if (action === 'create') {
      const login = String(body.username || '').trim().toLowerCase().replace(/@ahaji\.com$/, '');
      const roomIds = body.room_ids;
      if (!/^[a-z][a-z0-9._-]{2,63}$/.test(login) || !Array.isArray(roomIds) ||
        roomIds.length > 100 || new Set(roomIds).size !== roomIds.length ||
        roomIds.some((id: unknown) => typeof id !== 'string' ||
          !/^[a-z][a-z0-9_-]{0,63}$/.test(id)))
        return respond(400, { error: 'Invalid username or rooms' });
      const { data: existing, error: existingError } = await privileged.from('staff_accounts')
        .select('user_id').eq('login_name', login).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return respond(409, { error: 'Username already exists' });
      if (roomIds.length) {
        const { data: rooms, error: roomError } = await caller.from('rooms')
          .select('id,is_active').in('id', roomIds);
        if (roomError || rooms?.length !== roomIds.length || rooms.some(room => !room.is_active))
          return respond(400, { error: 'A room is unavailable' });
      }
      const internalEmail = `operator-${crypto.randomUUID()}@operators.ahaji.invalid`;
      // Confirmation here enables Auth's password transport. It is never used
      // as evidence of email ownership: SQL permanently bars this type from Admin.
      const { data: created, error: createError } = await privileged.auth.admin.createUser({
        email: internalEmail, password, email_confirm: true,
      });
      if (createError || !created.user) return respond(500, { error: 'Could not create Auth identity' });
      const userId = created.user.id;
      const { error: insertError } = await privileged.from('staff_accounts').insert({
        user_id: userId, role: 'game_master', active: false,
        account_type: 'operator', login_name: login,
      });
      if (insertError) {
        await privileged.auth.admin.deleteUser(userId).catch(() => {});
        return respond(409, { error: 'Could not reserve username' });
      }
      const { error: assignError } = await caller.rpc('admin_manage_staff', {
        p_user_id: userId, p_role: 'game_master', p_active: true, p_room_ids: roomIds,
      });
      if (assignError) return respond(500, { error: 'Identity created inactive; room assignment failed' });
      return respond(200, { username: `${login}@ahaji.com`, password, user_id: userId });
    }

    if (action === 'reset') {
      const userId = String(body.user_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return respond(400, { error: 'Invalid account' });
      const { data: target, error: targetError } = await privileged.from('staff_accounts')
        .select('account_type').eq('user_id', userId).single();
      if (targetError || target?.account_type !== 'operator')
        return respond(404, { error: 'Operator account not found' });
      const { error: revokeError } = await caller.rpc('admin_revoke_operator_sessions', { p_user_id: userId });
      if (revokeError) return respond(500, { error: 'Could not revoke existing sessions' });
      const { error: resetError } = await privileged.auth.admin.updateUserById(userId, { password });
      if (resetError) return respond(500, { error: 'Password reset failed' });
      return respond(200, { password });
    }
    return respond(400, { error: 'Invalid action' });
  } catch {
    return respond(500, { error: 'Operator account request failed' });
  }
});
