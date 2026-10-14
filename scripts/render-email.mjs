// Renders the Supabase Auth email template subset Ahaji uses ({{ .Var }},
// {{ .Data.key }}, {{ if .X }}…{{ else }}…{{ end }}), escaping values as Go's
// html/template does for text. Used for tests and the standalone preview:
//   node scripts/render-email.mjs   → docs/email-preview/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const escapeHtml = value => String(value).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' })[ch]);
const lookup = (vars, key) => key.split('.').filter(Boolean).reduce((value, part) => value?.[part], vars);

export function renderTemplate(template, vars, { html = true } = {}) {
  const conditional = /\{\{\s*if\s+\.([\w.]+)\s*\}\}([\s\S]*?)(?:\{\{\s*else\s*\}\}([\s\S]*?))?\{\{\s*end\s*\}\}/g;
  const withBranches = template.replace(conditional, (_, key, yes, no = '') => lookup(vars, key) ? yes : no);
  const output = withBranches.replace(/\{\{\s*\.([\w.]+)\s*\}\}/g, (_, key) => {
    const value = lookup(vars, key) ?? '';
    return html ? escapeHtml(value) : String(value);
  });
  if (/\{\{/.test(output)) throw new Error('Unrendered template expression');
  return output;
}

export const SAMPLE = {
  RedirectTo: 'http://127.0.0.1:8765/activate.html',
  TokenHash: 'pkce_7f3a9c1e5b2d4086a1c9e7f05b3d2a64',
  Email: 'sara@example.com',
  Data: { ahaji_display_name: 'سارة', ahaji_role_label: 'مدير لعبة' },
};

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(here, '..');
  const template = fs.readFileSync(path.join(root, 'supabase/templates/staff-invite.html'), 'utf8');
  const text = fs.readFileSync(path.join(root, 'supabase/templates/staff-invite.txt'), 'utf8');
  const out = path.join(root, 'docs/email-preview');
  fs.mkdirSync(out, { recursive: true });
  // The preview loads the logo from the repository; production uses the hosted copy.
  const email = renderTemplate(template, SAMPLE)
    .replace(/https:\/\/[^"]+\/branding\/ahaji-email-logo\.png/, '../../images/email/ahaji-logo.png');
  fs.writeFileSync(path.join(out, 'staff-invite-email.html'), email);
  fs.writeFileSync(path.join(out, 'staff-invite-email.txt'), renderTemplate(text, SAMPLE, { html: false }));
  const noName = renderTemplate(template, { ...SAMPLE, Data: {} })
    .replace(/https:\/\/[^"]+\/branding\/ahaji-email-logo\.png/, '../../images/email/ahaji-logo.png');
  fs.writeFileSync(path.join(out, 'staff-invite-email-no-name.html'), noName);
  console.log(`Wrote previews to ${path.relative(root, out)}`);
}
