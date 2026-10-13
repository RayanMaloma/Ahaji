// Stable public room IDs are generated once. The database primary key and
// format check remain the final authority when two Admins create concurrently.
export function roomIdBase(name) {
  const normalized=String(name||'').normalize('NFKC').trim().toLowerCase();
  const latin=normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
  if(latin && /^[a-z]/.test(latin))return latin;
  // Arabic and other scripts use a repeatable name-derived fallback.
  let hash=2166136261;
  for(const character of normalized){hash^=character.codePointAt(0);hash=Math.imul(hash,16777619);}
  return `room-${(hash>>>0).toString(36)}`;
}

export function roomIdCandidate(base,attempt) {
  if(!Number.isInteger(attempt)||attempt<0)throw new RangeError('Invalid room ID attempt.');
  const suffix=attempt?`-${attempt+1}`:'';
  return `${base.slice(0,64-suffix.length)}${suffix}`;
}
