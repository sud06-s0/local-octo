-- supabase/migrations/20261120000004_default_followup.sql
-- One custom follow-up template can be the default for ALL businesses (Template library → "Make default for all").
-- Sending a follow-up: the business's own pick → the default → its own latest approved → the standard one.
-- Also makes review_followup_utility3 the default now. Safe to run more than once.

alter table public.whatsapp_templates add column if not exists is_default boolean not null default false;
create index if not exists whatsapp_templates_default_idx on public.whatsapp_templates (kind) where is_default;

update public.whatsapp_templates set is_default = false where kind = 'followup' and name <> 'review_followup_utility3';
update public.whatsapp_templates set is_default = true  where kind = 'followup' and name =  'review_followup_utility3';

notify pgrst, 'reload schema';
