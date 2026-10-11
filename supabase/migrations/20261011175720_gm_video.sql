-- Game Masters can present uploaded videos as room content, separate from the loss video.
alter table public.room_media drop constraint room_media_kind_check;
alter table public.room_media add constraint room_media_kind_check
  check (kind in ('hint_sound','lose_sound','lose_video','gm_image','gm_sound','gm_video'));
alter table public.room_media drop constraint room_media_check;
alter table public.room_media add constraint room_media_check
  check (kind not in ('gm_image','gm_sound','gm_video') or
    (label is not null and length(btrim(label)) > 0));
