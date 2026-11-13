-- supabase/migrations/20261113000001_whatsapp_templates.sql
-- Custom WhatsApp templates per business (submitted to Meta for approval from the Messaging page).
-- Run once in the SQL Editor AFTER 20261112000001_init.sql.

create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('initial', 'initial_image', 'followup')),
  name text not null,                    -- template name in Meta (unique per WhatsApp account)
  language text not null default 'en',
  body text not null,                    -- exact text submitted to Meta, with {{1}} {{2}} placeholders
  params jsonb not null default '[]'::jsonb, -- which value fills each placeholder, e.g. ["first_name","review_link"]
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paused', 'disabled', 'failed')),
  meta_template_id text,
  reason text,                           -- rejection / failure reason from Meta
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index whatsapp_templates_business_idx on public.whatsapp_templates (business_id, kind, created_at desc);
create index whatsapp_templates_meta_idx on public.whatsapp_templates (meta_template_id) where meta_template_id is not null;

create trigger whatsapp_templates_touch before update on public.whatsapp_templates
  for each row execute function public.touch_updated_at();

alter table public.whatsapp_templates enable row level security;
-- Members can see their templates; only Edge Functions (secret key) create or update them.
create policy "wa templates: members read" on public.whatsapp_templates
  for select to authenticated using (public.is_member(business_id));
revoke insert, update, delete on public.whatsapp_templates from anon, authenticated;

-- Optional per-business WhatsApp Business Account (falls back to the WHATSAPP_WABA_ID secret)
alter table public.business_channels add column if not exists whatsapp_waba_id text;
