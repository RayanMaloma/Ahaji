-- Staff clients receive changes to their authorized session rows through RLS.
alter publication supabase_realtime add table public.game_sessions;
