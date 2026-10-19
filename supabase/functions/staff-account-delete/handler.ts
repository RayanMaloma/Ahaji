// Permanent staff deletion. Every rule (Super Admin caller, not self, not a
// Super Admin, not a reserved operational account, not the last Admin) is
// enforced by admin_prepare_staff_deletion(), which runs as the caller and
// also revokes sessions and access. Only then does this function use the
// server secret to delete the Auth identity and the account's avatar files.

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function prepareFailure(error: { code?: string; message?: string }) {
  const message = error.message || '';
  if (/own account/i.test(message)) return respond(403, { error: 'لا يمكنك حذف حسابك.' });
  if (/Super Admin account/i.test(message)) return respond(403, { error: 'لا يمكن حذف حساب المدير الرئيسي من التطبيق.' });
  if (/Reserved operational/i.test(message)) return respond(403, { error: 'الحسابات التشغيلية محجوزة ولا تُحذف.' });
  if (/active Admin/i.test(message)) return respond(409, { error: 'لا يمكن حذف آخر مدير نشط.' });
  if (error.code === '42501') return respond(403, { error: 'حذف الحسابات متاح للمدير الرئيسي فقط.' });
  if (error.code === 'P0002') return respond(404, { error: 'الحساب غير موجود.' });
  return respond(400, { error: 'تعذّر تجهيز حذف الحساب.' });
}

export function createHandler({ createClient, env }: Deps) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return respond(405, { error: 'Method not allowed' });
    const bearer = request.headers.get('Authorization');
    if (!bearer?.startsWith('Bearer ')) return respond(401, { error: 'Sign in required' });
    const { url, publishable, secret } = env();
    if (!url || !publishable || !secret) return respond(503, { error: 'Account deletion unavailable' });
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return respond(400, { error: 'Invalid request' }); }
    const userId = String(body.user_id || '');
    if (!UUID.test(userId)) return respond(400, { error: 'Invalid account' });
    try {
      const caller = createClient(url, publishable, {
        global: { headers: { Authorization: bearer } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: identity, error: identityError } = await caller.auth.getUser();
      if (identityError || !identity?.user) return respond(401, { error: 'Invalid session' });
      const { data: prepared, error: prepareError } = await caller.rpc('admin_prepare_staff_deletion', { p_user_id: userId });
      if (prepareError) return prepareFailure(prepareError);

      const privileged = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
      // Personal avatar files go with the identity; room media is never touched.
      const avatars = privileged.storage.from('profile-assets');
      const { data: files } = await avatars.list(userId, { limit: 100 });
      if (files?.length) await avatars.remove(files.map((f: { name: string }) => `${userId}/${f.name}`)).catch(() => {});
      const { error: deleteError } = await privileged.auth.admin.deleteUser(userId);
      if (deleteError && !/not.?found/i.test(deleteError.message || '')) {
        return respond(502, { status: 'access_revoked', error:
          'أُزيلت صلاحيات الحساب وأُغلقت جلساته، لكن تعذّر حذف هوية الدخول. أعد المحاولة لإكمال الحذف.' });
      }
      return respond(200, { status: 'deleted', user_id: userId, retried: Boolean(prepared?.already_prepared) });
    } catch {
      return respond(500, { error: 'تعذّر حذف الحساب.' });
    }
  };
}
