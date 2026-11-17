-- supabase/migrations/20261117000004_feedback_contact.sql
-- Bad / Worse answers on the review page now come with a short "what can we improve" form.
-- Name / email / phone are filled by the customer when the link isn't tied to a contact (shared link or QR).
alter table public.review_feedback
  add column if not exists customer_name text not null default '',
  add column if not exists customer_email text not null default '',
  add column if not exists customer_phone text not null default '';
