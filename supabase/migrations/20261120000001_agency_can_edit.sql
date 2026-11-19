-- supabase/migrations/20261120000001_agency_can_edit.sql
-- Agency accounts can change the settings of every business they belong to (not only as owner/admin).
-- Client logins (role 'member', account_type 'client') still can't. Safe to run more than once.

drop policy if exists "businesses: admins update" on public.businesses;
create policy "businesses: admins update" on public.businesses
  for update to authenticated
  using (public.is_business_admin(id) or (public.is_agency() and public.is_member(id)))
  with check (public.is_business_admin(id) or (public.is_agency() and public.is_member(id)));

notify pgrst, 'reload schema';
