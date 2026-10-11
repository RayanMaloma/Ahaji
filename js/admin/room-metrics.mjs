const AUDIO_KINDS = new Set(['hint_sound', 'lose_sound', 'gm_sound']);

export function roomMetrics(room) {
  const counts = { hints: room.hints.length, images: 0, videos: 0, audio: 0 };
  for (const record of room.mediaRecords) {
    if (record.kind === 'gm_image') counts.images += 1;
    else if (record.kind === 'lose_video' || record.kind === 'gm_video') counts.videos += 1;
    else if (AUDIO_KINDS.has(record.kind)) counts.audio += 1;
  }
  return counts;
}

export function metricLabel(kind, count) {
  if (kind === 'hints') {
    if (count === 0) return '0 تلميحات';
    if (count === 1) return '1 تلميح';
    if (count === 2) return 'تلميحان';
    if (count >= 3 && count <= 10) return `${count} تلميحات`;
    return `${count} تلميحًا`;
  }
  const labels = {
    images: count === 1 ? 'صورة' : 'صور',
    videos: count === 1 ? 'فيديو' : 'فيديوهات',
    audio: count === 1 ? 'صوت' : 'أصوات'
  };
  if (count === 2) return { images: 'صورتان', videos: 'فيديوهان', audio: 'صوتان' }[kind];
  return `${count} ${labels[kind]}`;
}
