import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const respond = (status: number, data: Record<string, unknown>) =>
  new Response(JSON.stringify(data), { status, headers: cors });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed' });
  const bearer = request.headers.get('Authorization');
  if (!bearer?.startsWith('Bearer ')) return respond(401, { error: 'Sign in required' });
  const url = Deno.env.get('SUPABASE_URL');
  const publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}').default ||
    Deno.env.get('SUPABASE_ANON_KEY');
  const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default ||
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publishable || !secret) return respond(503, { error: 'Staff provisioning unavailable' });

  try {
    const caller = createClient(url, publishable, {
      global: { headers: { Authorization: bearer } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: identity, error: identityError } = await caller.auth.getUser();
    if (identityError || !identity.user) return respond(401, { error: 'Invalid session' });
    const { data: account, error: roleError } = await caller.from('staff_accounts')
      .select('role,active').eq('user_id', identity.user.id).single();
    if (roleError || account?.role !== 'admin' || !account.active)
      return respond(403, { error: 'Admin access required' });

    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    const role = body.role;
    const roomIds = body.room_ids;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      !['admin', 'game_master'].includes(role) || !Array.isArray(roomIds) ||
      roomIds.length > 100 || roomIds.some((id: unknown) =>
        typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(id)) ||
      new Set(roomIds).size !== roomIds.length)
      return respond(400, { error: 'Invalid invitation details' });
    if (role === 'game_master' && roomIds.length) {
      const { data: rooms, error: roomsError } = await caller.from('rooms')
        .select('id,is_active').in('id', roomIds);
      if (roomsError || rooms?.length !== roomIds.length || rooms.some((r) => !r.is_active))
        return respond(400, { error: 'An assigned room is unavailable' });
    }

    const privileged = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: invited, error: inviteError } = await privileged.auth.admin.inviteUserByEmail(email);
    if (inviteError || !invited.user) {
      if (/email address not authorized/i.test(inviteError?.message || ''))
        return respond(424, { error: 'خدمة البريد الحالية لا تسمح بدعوة هذا العنوان. يلزم إعداد SMTP قبل دعوة الفريق.' });
      return respond(409, { error: inviteError?.message || 'Invitation could not be sent' });
    }
    // Provision new identities without access until the validated, atomic
    // assignment RPC succeeds. Existing records are left unchanged here.
    const { error: staffError } = await privileged.from('staff_accounts').upsert({
      user_id: invited.user.id, role: 'game_master', active: false,
    }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (staffError) return respond(500, { error: 'Invitation sent but staff access could not be saved' });
    const { error: assignmentError } = await caller.rpc('admin_manage_staff', {
      p_user_id: invited.user.id, p_role: role, p_active: true, p_room_ids: roomIds,
    });
    if (assignmentError) return respond(500, { error: 'Invitation sent but staff access could not be saved' });
    return respond(200, { user_id: invited.user.id, email, status: 'invited' });
  } catch {
    return respond(500, { error: 'Staff invitation failed' });
  }
});
