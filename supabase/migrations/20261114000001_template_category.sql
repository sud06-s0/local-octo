-- supabase/migrations/20261114000001_template_category.sql
-- Category Meta gave each WhatsApp template (marketing / utility / authentication).
alter table public.whatsapp_templates add column if not exists category text;
