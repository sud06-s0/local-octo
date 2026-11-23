-- supabase/migrations/20261123000001_channel_limits.sql
-- 100 review requests per channel (WhatsApp, SMS, Email) per business per month. Sent first messages + follow-ups
-- count (tests and failed sends don't). A contact is picked while at least one of the business's turned-on channels
-- has room; full channels are skipped by the sender. Safe to run more than once.

drop function if exists public.channel_requests_this_month(uuid, text);
create function public.channel_requests_this_month(p_business uuid, p_channel text)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from public.messages m
  join public.businesses b on b.id = m.business_id
  where m.business_id = p_business
    and m.channel::text = p_channel
    and m.kind in ('initial', 'follow_up')
    and m.status <> 'failed'
    and m.created_at >= (date_trunc('month', now() at time zone b.timezone) at time zone b.timezone);
$$;
revoke execute on function public.channel_requests_this_month(uuid, text) from public, anon, authenticated;

create index if not exists messages_business_channel_idx on public.messages (business_id, channel, created_at) where kind in ('initial', 'follow_up');

drop function if exists public.claim_due_contacts(int, int);
create function public.claim_due_contacts(p_limit int default 100, p_per_business int default 20)
returns table (
  contact_id uuid,
  business_id uuid,
  first_name text,
  gender text,
  send_kind text,
  status text,
  email text,
  phone text,
  token text,
  requests_sent int,
  business_name text,
  review_link text,
  messaging jsonb,
  scheduling jsonb
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with quota as (
    -- room left this month on the most open turned-on channel (100 each; nothing saved yet = WhatsApp only)
    select b.id as business_id,
           greatest(
             case when coalesce((b.messaging -> 'channels' ->> 'whatsapp')::boolean, b.messaging -> 'channels' is null)
                  then 100 - public.channel_requests_this_month(b.id, 'whatsapp') else 0 end,
             case when coalesce((b.messaging -> 'channels' ->> 'sms')::boolean, false)
                  then 100 - public.channel_requests_this_month(b.id, 'sms') else 0 end,
             case when coalesce((b.messaging -> 'channels' ->> 'email')::boolean, false)
                  then 100 - public.channel_requests_this_month(b.id, 'email') else 0 end,
             0
           ) as remaining
    from public.businesses b
  ),
  due as (
    select c.id, c.business_id, q.remaining,
           row_number() over (partition by c.business_id order by c.next_send_at) as rn
    from public.contacts c
    join public.businesses b on b.id = c.business_id
    join quota q on q.business_id = c.business_id
    where q.remaining > 0
      and c.next_send_at is not null
      and c.next_send_at <= now()
      and c.do_not_contact = false
      and (c.status in ('pending', 'sent') or c.send_kind in ('initial', 'follow_up'))
      and coalesce((b.scheduling ->> 'active')::boolean, true)
      and b.review_link <> ''
      -- 9 AM–7 PM in the business's time zone, unless Sending hours = Anytime
      and (
        coalesce((b.scheduling ->> 'sendAnytime')::boolean, false)
        or (extract(hour from (now() at time zone b.timezone)) >= 9
            and extract(hour from (now() at time zone b.timezone)) < 19)
      )
  ),
  picked as (
    select c.id
    from public.contacts c
    join due on due.id = c.id
    where due.rn <= least(p_per_business, due.remaining)
    order by c.next_send_at
    limit p_limit
    for update of c skip locked
  ),
  locked as (
    -- push next_send_at forward so a slow run is never picked up twice
    update public.contacts c set next_send_at = now() + interval '15 minutes'
    from picked where c.id = picked.id
    returning c.*
  )
  select l.id, l.business_id, l.first_name, l.gender, l.send_kind, l.status::text, l.email, l.phone, l.token, l.requests_sent,
         coalesce(nullif(b.messaging ->> 'businessName', ''), b.name),
         b.review_link, b.messaging, b.scheduling
  from locked l
  join public.businesses b on b.id = l.business_id;
end;
$$;
revoke execute on function public.claim_due_contacts(int, int) from public, anon, authenticated;

notify pgrst, 'reload schema';
