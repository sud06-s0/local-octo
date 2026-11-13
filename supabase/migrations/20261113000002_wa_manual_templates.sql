-- supabase/migrations/20261113000002_wa_manual_templates.sql
-- Photo templates are created by hand in WhatsApp Manager; the app tracks them as 'not_created' until found.
-- Safe to run even if 20261113000001 already includes this status.

alter table public.whatsapp_templates drop constraint if exists whatsapp_templates_status_check;
alter table public.whatsapp_templates add constraint whatsapp_templates_status_check
  check (status in ('not_created', 'pending', 'approved', 'rejected', 'paused', 'disabled', 'failed'));
