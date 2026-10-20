-- Defence in depth: turn on row-level security, with no policies, for every table in public that
-- this role owns. The app and workers connect as the table owner, which bypasses RLS (no FORCE),
-- so nothing changes for them; any other role (anon/authenticated through the Supabase Data API,
-- if it is ever turned on) sees no rows at all.
-- Dynamic so it also covers tables added by earlier-numbered migrations. Tables owned by others
-- (PostGIS spatial_ref_sys) are skipped. test/rls.test.ts fails if a later table is left without RLS.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS tbl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND pg_get_userbyid(c.relowner) = current_user AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t.tbl);
  END LOOP;
END $$;
