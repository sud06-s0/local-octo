-- supabase/migrations/20261120000003_shared_templates.sql
-- Custom WhatsApp templates are a shared library: agency accounts see every business's templates
-- (and each business picks which approved ones it sends). Client logins still see only their own business's.
-- Safe to run more than once.

drop policy if exists "wa templates: members read" on public.whatsapp_templates;
create policy "wa templates: members read" on public.whatsapp_templates
  for select to authenticated
  using (public.is_member(business_id) or public.is_agency());

notify pgrst, 'reload schema';
