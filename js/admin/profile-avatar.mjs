export function profileInitial(user) {
  const metadata = user?.user_metadata || {};
  const name = [metadata.display_name, metadata.full_name, metadata.name]
    .find(value => typeof value === 'string' && value.trim());
  const source = name || (typeof user?.email === 'string' ? user.email.split('@')[0] : '');
  const first = [...source.trim()].find(character => /[\p{L}\p{N}]/u.test(character));
  return first ? first.toLocaleUpperCase() : '•';
}

export function profileName(user) {
  const metadata = user?.user_metadata || {};
  return [metadata.display_name, metadata.full_name, metadata.name]
    .find(value => typeof value === 'string' && value.trim())?.trim() || 'حساب المدير';
}
