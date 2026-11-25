-- supabase/migrations/20261125000001_client_passwords.sql
-- Client login passwords, saved so agency logins can see them again in Account settings (with Reset).
-- Stored encrypted (AES-GCM, key held only by the client-login Edge Function); nobody can read this table from the
-- browser, only the Edge Function (service role). Safe to run more than once.
create table if not exists public.client_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  password_enc text not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.client_credentials enable row level security;
revoke all on public.client_credentials from public, anon, authenticated;
notify pgrst, 'reload schema';
