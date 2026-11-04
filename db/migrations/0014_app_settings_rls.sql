-- app_settings holds the live coin address, so it must not be reachable through Supabase's public API
-- (anon / authenticated keys). Same as the other tables: RLS on and no policies, so only the server's
-- own database connection reads or writes it.
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
