-- supabase/migrations/20261127000001_business_audits.sql
-- Audit / rank reports (agency only). Written only by the audit Edge Function; agency logins of the business can read them.
-- Safe to run more than once.
create table if not exists public.business_audits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  keywords text[] not null default '{}',
  report jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists business_audits_business_idx on public.business_audits (business_id, created_at desc);

alter table public.business_audits enable row level security;
revoke all on public.business_audits from public, anon, authenticated;
grant select on public.business_audits to authenticated;

drop policy if exists "agency reads audits" on public.business_audits;
create policy "agency reads audits" on public.business_audits
  for select to authenticated
  using (public.is_agency() and public.is_member(business_id));

notify pgrst, 'reload schema';
