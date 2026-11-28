-- supabase/migrations/20261128000004_client_audits.sql
-- Clients can open the Audit page and run 1 audit per calendar month; agency logins are unlimited.
-- last_client_audit_at is set only by the audit Edge Function. Safe to run more than once.
alter table public.businesses add column if not exists last_client_audit_at timestamptz;
grant select (last_client_audit_at) on public.businesses to authenticated;

-- Every login of the business (agency or client) can read its audit report
drop policy if exists "agency reads audits" on public.business_audits;
drop policy if exists "members read audits" on public.business_audits;
create policy "members read audits" on public.business_audits
  for select to authenticated
  using (public.is_member(business_id));

notify pgrst, 'reload schema';
