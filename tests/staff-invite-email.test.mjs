import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderTemplate, SAMPLE } from '../scripts/render-email.mjs';
import { checkPassword } from '../js/auth/password-policy.mjs';

const html = fs.readFileSync(new URL('../supabase/templates/staff-invite.html', import.meta.url), 'utf8');
const text = fs.readFileSync(new URL('../supabase/templates/staff-invite.txt', import.meta.url), 'utf8');

test('invitation email renders an Arabic RTL message with the one-time activation link', () => {
  const out = renderTemplate(html, SAMPLE);
  assert.match(out, /<html lang="ar" dir="rtl"/);
  assert.match(out, /سارة، أنت مدعوّ للانضمام إلى فريق أحاجي/);
  assert.match(out, /بصفة <strong[^>]*>مدير لعبة<\/strong>/);
  const link = 'http://127.0.0.1:8765/activate.html?token_hash=pkce_7f3a9c1e5b2d4086a1c9e7f05b3d2a64&amp;type=invite';
  assert.ok(out.includes(`href="${link}"`), 'CTA uses the token-hash link');
  assert.equal(out.split(link).length - 1, 4, 'button (HTML and Outlook), and copyable fallback text and href');
  assert.match(out, />تفعيل حسابي</);
  assert.match(out, /24 ساعة/);
  assert.match(out, /لم تتوقّع هذه الدعوة؟/);
  assert.match(out, /sara@example\.com/);
});

test('email markup is client-safe: no scripts, forms, SVG, loader, or external CSS', () => {
  assert.doesNotMatch(html, /<script|<form|<svg|<link[^>]+stylesheet|ahaji-loader|@import/i);
  assert.match(html, /role="presentation"/);
  assert.match(html, /max-width:600px/);
  assert.match(html, /@media screen and \(max-width:620px\)/);
  assert.match(html, /alt="أحاجي"/);
  assert.match(html, /<!--\[if mso\]>/);
});

test('missing name and role produce a neutral greeting, values are escaped', () => {
  const plain = renderTemplate(html, { ...SAMPLE, Data: {} });
  assert.match(plain, />أنت مدعوّ للانضمام إلى فريق أحاجي</);
  assert.doesNotMatch(plain, /بصفة/);
  const hostile = renderTemplate(html, { ...SAMPLE, Data: { ahaji_display_name: '<img src=x onerror=alert(1)>' } });
  assert.doesNotMatch(hostile, /<img src=x/);
  assert.match(hostile, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('plain-text fallback carries the same essentials', () => {
  const out = renderTemplate(text, SAMPLE, { html: false });
  assert.match(out, /http:\/\/127\.0\.0\.1:8765\/activate\.html\?token_hash=pkce_[a-z0-9]+&type=invite/);
  assert.match(out, /24 ساعة/);
  assert.match(out, /بصفة مدير لعبة/);
  assert.doesNotMatch(out, /\{\{|<[a-z]/i);
});

test('password policy requires length, letters, digits, variety, no email, and confirmation', () => {
  assert.equal(checkPassword('Maze-Door-2026x', { email: 'sara@x.com', confirm: 'Maze-Door-2026x' }).ok, true);
  assert.equal(checkPassword('Maze-Door-2026x', { confirm: 'other' }).matches, false);
  const failing = id => checkPassword(...id).results.filter(r => !r.ok).map(r => r.id);
  assert.deepEqual(failing(['Short1a']), ['length']);
  assert.deepEqual(failing(['123456789012']), ['letter']);
  assert.deepEqual(failing(['abcdefghijklm']), ['digit']);
  assert.deepEqual(failing(['aaaaaaaaaaa1']), ['variety']);
  assert.deepEqual(failing(['sara-loves-2026', { email: 'sara@x.com' }]), ['email']);
  assert.equal(checkPassword('كلمةمرورعربية2026').ok, true, 'Arabic letters count as letters');
  assert.equal(checkPassword('x'.repeat(70) + '1a2b').results.find(r => r.id === 'length').ok, false, 'bcrypt 72-byte cap');
});
