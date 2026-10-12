export function profileInitial(user, profile) {
  const metadata = user?.user_metadata || {};
  const name = [profile?.display_name, metadata.display_name, metadata.full_name, metadata.name]
    .find(value => typeof value === 'string' && value.trim());
  const source = name || (typeof user?.email === 'string' ? user.email.split('@')[0] : '');
  const first = [...source.trim()].find(character => /[\p{L}\p{N}]/u.test(character));
  return first ? first.toLocaleUpperCase() : '•';
}

export function profileName(user, profile) {
  const metadata = user?.user_metadata || {};
  return [profile?.display_name, metadata.display_name, metadata.full_name, metadata.name]
    .find(value => typeof value === 'string' && value.trim())?.trim() ||
    (typeof user?.email === 'string' ? user.email.trim() : '');
}
