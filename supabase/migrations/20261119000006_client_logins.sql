-- supabase/migrations/20261119000006_client_logins.sql
-- Client logins are created by the client-login Edge Function (agency only). Extra lock so a signed-in
-- user can never write their own profile row except the name (account_type / admin flag stay server-side).
-- Safe to run more than once.

revoke insert, delete on public.profiles from anon, authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

notify pgrst, 'reload schema';
