-- supabase/migrations/20261128000001_usage_reset.sql
-- Monthly channel counts can be reset to 0 for a business: messages sent before usage_reset_at don't count.
-- Message history is kept. Safe to run more than once.
alter table public.businesses add column if not exists usage_reset_at timestamptz;
grant select (usage_reset_at) on public.businesses to authenticated;

create or replace function public.channel_requests_this_month(p_business uuid, p_channel text)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from public.messages m
  join public.businesses b on b.id = m.business_id
  where m.business_id = p_business
    and m.channel::text = p_channel
    and m.kind in ('initial', 'follow_up')
    and m.status <> 'failed'
    and m.created_at >= greatest(
      date_trunc('month', now() at time zone b.timezone) at time zone b.timezone,
      coalesce(b.usage_reset_at, '-infinity'::timestamptz)
    );
$$;
revoke execute on function public.channel_requests_this_month(uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
