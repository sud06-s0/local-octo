-- supabase/migrations/20261116000001_google_business.sql
-- Google Business Profile connection per business (OAuth). Holds the refresh token, so the
-- browser never reads this table: the google-business function returns the safe status fields.

create table if not exists public.google_connections (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  google_email text not null default '',
  refresh_token text not null,
  account_name text,               -- accounts/123…
  location_name text,              -- locations/456…
  location_title text not null default '',
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz
);

alter table public.google_connections enable row level security;
-- No policies on purpose: only Edge Functions (secret key) can read or write it.
revoke all on public.google_connections from anon, authenticated;
