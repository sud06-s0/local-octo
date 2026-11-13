-- supabase/migrations/20261113000005_google_places.sql
-- Google Business Profile details imported with the Places API ("Find your business on Google").

alter table public.businesses
  add column if not exists phone text not null default '',
  add column if not exists website text not null default '',
  add column if not exists google_rating numeric(2,1),
  add column if not exists google_review_count int,
  add column if not exists google_synced_at timestamptz;

-- The browser may read these; only the google-places Edge Function writes the Google numbers.
grant select (phone, website, google_rating, google_review_count, google_synced_at) on public.businesses to authenticated;
grant update (phone, website) on public.businesses to authenticated;
