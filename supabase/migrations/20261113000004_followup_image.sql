-- supabase/migrations/20261113000004_followup_image.sql
-- Follow-ups also carry the photo with the customer's name.

alter table public.whatsapp_templates drop constraint if exists whatsapp_templates_kind_check;
alter table public.whatsapp_templates add constraint whatsapp_templates_kind_check
  check (kind in ('initial', 'initial_image', 'followup', 'followup_image'));

alter table public.business_channels add column if not exists whatsapp_template_followup_image text;
