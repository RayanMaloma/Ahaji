import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const respond = (status: number, data: Record<string, unknown>) =>
  new Response(JSON.stringify(data), { status, headers });
const invalid = () => respond(401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed' });
  const url = Deno.env.get('SUPABASE_URL');
  const publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}').default ||
    Deno.env.get('SUPABASE_ANON_KEY');
  const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default ||
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publishable || !secret) return respond(503, { error: 'Sign-in unavailable' });
  try {
    const body = await request.json();
    const login = String(body.username || '').trim().toLowerCase().replace(/@ahaji\.com$/, '');
    const password = String(body.password || '');
    if (!/^[a-z][a-z0-9._-]{2,63}$/.test(login) || password.length > 256 ||
      !password) return invalid();
    const privileged = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: account, error: lookupError } = await privileged.from('staff_accounts')
      .select('user_id,active,role,account_type').eq('login_name', login).maybeSingle();
    if (lookupError || !account || !account.active || account.role !== 'game_master' ||
      account.account_type !== 'operator') return invalid();
    const { data: identity, error: identityError } = await privileged.auth.admin.getUserById(account.user_id);
    if (identityError || !identity.user?.email) return invalid();
    const auth = createClient(url, publishable, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: session, error: signInError } = await auth.auth.signInWithPassword({
      email: identity.user.email, password,
    });
    if (signInError || !session.session) return invalid();
    return respond(200, {
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
      expires_in: session.session.expires_in,
    });
  } catch { return invalid(); }
});
