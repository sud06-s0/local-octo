-- supabase/migrations/20261120000002_clients_full_app.sql
-- Client logins can use the whole app for their business (Dashboard, Contacts, Messaging, Reviews, Integrations),
-- including saving settings. Adding businesses and creating logins stay agency-only. Safe to run more than once.

drop policy if exists "businesses: admins update" on public.businesses;
drop policy if exists "businesses: members update" on public.businesses;
create policy "businesses: members update" on public.businesses
  for update to authenticated
  using (public.is_member(id))
  with check (public.is_member(id));

notify pgrst, 'reload schema';
