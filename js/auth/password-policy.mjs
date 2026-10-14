// Client-side password rules for account activation. Supabase Auth remains
// the authority (its minimum length and leaked-password settings still apply).
export const PASSWORD_RULES = Object.freeze([
  { id: 'length', label: '12 حرفاً على الأقل', test: (p) => p.length >= 12 && p.length <= 72 },
  { id: 'letter', label: 'حرف واحد على الأقل', test: (p) => /\p{L}/u.test(p) },
  { id: 'digit', label: 'رقم واحد على الأقل', test: (p) => /\p{Nd}/u.test(p) },
  { id: 'variety', label: 'لا تكرار لحرف واحد', test: (p) => new Set(p).size >= 5 },
  { id: 'email', label: 'لا تتضمن بريدك الإلكتروني', test: (p, ctx) => {
    const local = String(ctx.email || '').split('@')[0].toLowerCase();
    return local.length < 3 || !p.toLowerCase().includes(local);
  } },
]);

export function checkPassword(password, { email = '', confirm } = {}) {
  const value = String(password || '');
  const results = PASSWORD_RULES.map(rule => ({ id: rule.id, label: rule.label, ok: rule.test(value, { email }) }));
  const matches = confirm === undefined || confirm === value;
  return { ok: results.every(r => r.ok) && matches && value.length > 0, results, matches };
}
