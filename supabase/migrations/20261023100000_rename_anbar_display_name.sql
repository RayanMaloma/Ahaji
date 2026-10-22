-- Product Owner rename: room `anbar` is displayed as «عنبر 23».
-- Only rooms.name changes; the ID, sessions, assignments, and media keep
-- their relationships. Guarded so it never overwrites a name an Admin has
-- since chosen, and it is a no-op where the rename already happened.
update public.rooms set name = 'عنبر 23' where id = 'anbar' and name = 'السجن';
