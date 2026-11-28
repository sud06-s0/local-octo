-- supabase/migrations/20261128000002_audit_share.sql
-- Public share link for audit reports: /audit-report/<share_token>. Read only through the audit-public Edge Function.
-- Safe to run more than once.
alter table public.business_audits
  add column if not exists share_token text not null default encode(extensions.gen_random_bytes(12), 'hex');
create unique index if not exists business_audits_share_token_idx on public.business_audits (share_token);
notify pgrst, 'reload schema';
