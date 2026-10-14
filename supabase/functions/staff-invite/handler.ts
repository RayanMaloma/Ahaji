// Staff invitation endpoint logic. Dependencies are injected so the same code
// runs in the Edge Function (index.ts) and in Node tests with fake clients.
// Database rules live in SQL (admin_*_staff_invitation); this layer only
// performs Auth Admin operations that need the server secret.

type Env = { url?: string; publishable?: string; secret?: string };
type Deps = { createClient: (url: string, key: string, options: unknown) => any; env: () => Env };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const respond = (status: number, data: Record<string, unknown>) =>
  new Response(JSON.stringify(data), { status, headers: cors });
const ROLE_LABELS: Record<string, string> = { admin: 'مدير', game_master: 'مدير لعبة' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROOM = /^[a-z][a-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validRedirect(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/activate.html' || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

export function cleanName(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const name = value.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return name.length <= 80 ? name : null;
}

function sqlError(error: { code?: string } | null) {
  if (!error) return null;
  if (error.code === '42501') return respond(403, { error: 'Admin access required' });
  if (error.code === '23505') return respond(409, { error: 'هذا البريد مرتبط بحساب فريق أو بدعوة قائمة.' });
  if (error.code === '55000') return respond(429, { error: 'انتظر دقيقة قبل إعادة إرسال الدعوة.' });
  if (error.code === 'P0002') return respond(404, { error: 'الدعوة غير متاحة لهذا الإجراء.' });
  return respond(400, { error: 'تعذّر حفظ الدعوة. راجع البيانات وحاول مجدداً.' });
}

function inviteFailure(error: { message?: string; status?: number } | null) {
  const message = error?.message || '';
  if (/email address not authorized/i.test(message))
    return respond(424, { error: 'خدمة البريد الحالية لا تسمح بدعوة هذا العنوان. يلزم إعداد مزوّد بريد قبل دعوة الفريق.' });
  if (error?.status === 429 || /rate limit/i.test(message))
    return respond(429, { error: 'تم بلوغ حد إرسال الرسائل مؤقتاً. حاول لاحقاً.' });
  return respond(502, { error: 'تعذّر إرسال رسالة الدعوة.' });
}

export function createHandler({ createClient, env }: Deps) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return respond(405, { error: 'Method not allowed' });
    const bearer = request.headers.get('Authorization');
    if (!bearer?.startsWith('Bearer ')) return respond(401, { error: 'Sign in required' });
    const { url, publishable, secret } = env();
    if (!url || !publishable || !secret) return respond(503, { error: 'Staff provisioning unavailable' });
    try {
      const caller = createClient(url, publishable, {
        global: { headers: { Authorization: bearer } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: identity, error: identityError } = await caller.auth.getUser();
      if (identityError || !identity?.user) return respond(401, { error: 'Invalid session' });
      const { data: staff, error: staffError } = await caller.from('staff_accounts')
        .select('role,active,account_type').eq('user_id', identity.user.id).single();
      if (staffError || staff?.role !== 'admin' || !staff.active || staff.account_type !== 'email' ||
        !identity.user.email_confirmed_at) return respond(403, { error: 'Verified Admin required' });

      let body: Record<string, unknown>;
      try { body = await request.json(); } catch { return respond(400, { error: 'Invalid request' }); }
      const action = String(body.action || 'invite');
      const privileged = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

      if (action === 'revoke') {
        if (!UUID.test(String(body.invitation_id || ''))) return respond(400, { error: 'Invalid invitation' });
        const { error } = await caller.rpc('admin_revoke_staff_invitation', { p_invitation_id: body.invitation_id });
        return sqlError(error) || respond(200, { status: 'revoked' });
      }

      const redirectTo = validRedirect(body.redirect_to);
      if (!redirectTo) return respond(400, { error: 'Invalid activation address' });

      // Issues the Auth invitation email; returns the identity it belongs to.
      async function sendInvite(email: string, name: string, role: string, replaceUserId: string | null) {
        if (replaceUserId) {
          const { error } = await privileged.auth.admin.deleteUser(replaceUserId);
          if (error) return { response: respond(500, { error: 'تعذّر تجديد الدعوة.' }) };
        }
        const { data, error } = await privileged.auth.admin.inviteUserByEmail(email, {
          redirectTo,
          // Display-only values for the email template. Authorization never reads metadata.
          data: { ahaji_display_name: name, ahaji_role_label: ROLE_LABELS[role] },
        });
        if (error || !data?.user) return { response: inviteFailure(error) };
        return { userId: data.user.id as string };
      }
      async function record(userId: string, email: string, name: string, role: string, roomIds: string[],
        created: boolean) {
        const { data, error } = await caller.rpc('admin_record_staff_invitation', {
          p_user_id: userId, p_email: email, p_display_name: name, p_role: role, p_room_ids: roomIds,
        });
        if (error) {
          // Never leave a mailed link for an identity without a pending invitation.
          if (created) await privileged.auth.admin.deleteUser(userId).catch(() => {});
          return { response: sqlError(error) as Response };
        }
        return { invitationId: data as string };
      }

      if (action === 'resend') {
        if (!UUID.test(String(body.invitation_id || ''))) return respond(400, { error: 'Invalid invitation' });
        const { data, error } = await caller.rpc('admin_refresh_staff_invitation', { p_invitation_id: body.invitation_id });
        if (error) return sqlError(error) as Response;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return respond(404, { error: 'الدعوة غير متاحة لهذا الإجراء.' });
        const recreate = row.mode === 'recreate';
        const sent = await sendInvite(row.email, row.display_name || '', row.role, recreate ? row.user_id : null);
        if (sent.response) return sent.response;
        if (recreate) {
          const saved = await record(sent.userId as string, row.email, row.display_name || '', row.role,
            row.room_ids || [], true);
          if (saved.response) return saved.response;
          return respond(200, { status: 'pending', invitation_id: saved.invitationId });
        }
        return respond(200, { status: 'pending', invitation_id: body.invitation_id });
      }

      if (action !== 'invite') return respond(400, { error: 'Invalid action' });
      const email = String(body.email || '').trim().toLowerCase();
      const name = cleanName(body.display_name);
      const role = String(body.role || '');
      const roomIds = body.room_ids;
      if (!EMAIL.test(email) || email.length > 254 || name === null || !ROLE_LABELS[role] ||
        !Array.isArray(roomIds) || roomIds.length > 100 ||
        roomIds.some(id => typeof id !== 'string' || !ROOM.test(id)) || new Set(roomIds).size !== roomIds.length)
        return respond(400, { error: 'بيانات الدعوة غير صالحة.' });
      const rooms = role === 'game_master' ? roomIds as string[] : [];

      const { data: prepared, error: prepareError } = await caller.rpc('admin_prepare_staff_invitation', { p_email: email });
      if (prepareError) return sqlError(prepareError) as Response;
      const plan = Array.isArray(prepared) ? prepared[0] : prepared;
      const sent = await sendInvite(email, name, role, plan?.mode === 'recreate' ? plan.user_id : null);
      if (sent.response) return sent.response;
      if (plan?.mode === 'reinvite' && plan.user_id !== sent.userId)
        return respond(409, { error: 'هذا البريد مرتبط بحساب آخر.' });
      const saved = await record(sent.userId as string, email, name, role, rooms, plan?.mode !== 'reinvite');
      if (saved.response) return saved.response;
      return respond(200, { status: 'pending', invitation_id: saved.invitationId, email });
    } catch {
      return respond(500, { error: 'Staff invitation failed' });
    }
  };
}
