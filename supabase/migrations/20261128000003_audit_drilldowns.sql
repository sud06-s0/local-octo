-- supabase/migrations/20261128000003_audit_drilldowns.sql
-- Competition Drilldown cache: each heatmap dot is looked up on Google once per report, the first time someone clicks it.
-- Removed together with its report. Only the audit-drill Edge Function reads/writes it. Safe to run more than once.
create table if not exists public.audit_drilldowns (
  audit_id uuid not null references public.business_audits (id) on delete cascade,
  keyword_idx int not null,
  point_idx int not null,
  results jsonb not null,
  created_at timestamptz not null default now(),
  primary key (audit_id, keyword_idx, point_idx)
);
alter table public.audit_drilldowns enable row level security;
revoke all on public.audit_drilldowns from public, anon, authenticated;
notify pgrst, 'reload schema';
