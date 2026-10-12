-- Keep room names in the catalog itself, not in frontend ID mappings.
-- Only change untouched legacy names so an Admin's custom name wins.
update public.rooms set name = 'السجن' where id = 'anbar' and name = 'Prison';
update public.rooms set name = 'الهرم' where id = 'haram' and name = 'Pyramid';
update public.rooms set name = 'العم صالح' where id = 'saleh' and name = 'Uncle Saleh';
