-- supabase/migrations/20261123000004_short_code_grants.sql
-- businesses uses column-level grants (so secrets stay hidden from the browser): the new short_code column must be
-- granted, or every businesses query from the app fails with "permission denied for table businesses".
-- Who may change it is still decided by the guard trigger (clients once, agency any time). Safe to run more than once.
grant select (short_code) on public.businesses to authenticated;
grant update (short_code) on public.businesses to authenticated;
notify pgrst, 'reload schema';
