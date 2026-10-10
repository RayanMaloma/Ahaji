import { createClient } from '../vendor/supabase.bundle.mjs';

// This publishable key identifies the project; it grants no privilege without
// an authenticated session and the database's RLS policies.
export const supabase = createClient(
  'https://gbhleqizxcmxmutgcjon.supabase.co',
  'sb_publishable_ajP_I5ftvfxFlv9MpC7G5Q_uDMjGIDq',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

export function safeNext(value) {
  if (!value || typeof value !== 'string') return 'index.html';
  try {
    const url = new URL(value, window.location.href);
    if (url.origin !== window.location.origin || !['/index.html', '/gm.html', '/staff.html', '/admin.html'].includes(url.pathname)) {
      return 'index.html';
    }
    return url.pathname.slice(1) + url.search;
  } catch {
    return 'index.html';
  }
}

export async function currentAccess() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;
  const { data, error } = await supabase.from('staff_accounts')
    .select('role,active').eq('user_id', userData.user.id).maybeSingle();
  if (error) throw error;
  if (!data?.active || !['admin', 'game_master'].includes(data.role)) return { user: userData.user, role: null };
  return { user: userData.user, role: data.role };
}
