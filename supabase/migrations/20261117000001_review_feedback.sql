-- supabase/migrations/20261117000001_review_feedback.sql
-- Answers from the review page (local-octo.vercel.app/review): Happy 5, Good 4, Bad 2, Worse 1.
-- Happy / Good can include the customer's text and photo; Bad / Worse are only the choice.
-- Written only by the feedback Edge Function; members of the business can read them.

create table if not exists public.review_feedback (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  rating smallint not null check (rating in (1, 2, 4, 5)),
  text text not null default '',
  photo_url text,
  created_at timestamptz not null default now()
);

create index if not exists review_feedback_business_idx on public.review_feedback (business_id, created_at desc);

alter table public.review_feedback enable row level security;
drop policy if exists "feedback: members read" on public.review_feedback;
create policy "feedback: members read" on public.review_feedback
  for select to authenticated using (public.is_member(business_id));
revoke insert, update, delete on public.review_feedback from anon, authenticated;
