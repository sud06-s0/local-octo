-- supabase/migrations/20261119000004_manual_send.sql
-- Contacts menu: "Send first message" / "Send follow-up" always send that message, even past the follow-up limit.
-- contacts.send_kind = 'initial' | 'follow_up' while a manual send is waiting ('' = none).
-- Automatic scheduling keeps its rules. Includes the gender column and the Sending hours (Anytime) check.
-- Safe to run more than once.

alter table public.contacts add column if not exists gender text not null default '';
alter table public.contacts drop column if exists send_now;
alter table public.contacts add column if not exists send_kind text not null default '';
alter table public.contacts drop constraint if exists contacts_send_kind_check;
alter table public.contacts add constraint contacts_send_kind_check check (send_kind in ('', 'initial', 'follow_up'));

drop function if exists public.claim_due_contacts(int, int);
create function public.claim_due_contacts(p_limit int default 100, p_per_business int default 20)
returns table (
  contact_id uuid,
  business_id uuid,
  first_name text,
  gender text,
  send_kind text,
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
  with due as (
    select c.id, c.business_id,
           row_number() over (partition by c.business_id order by c.next_send_at) as rn
    from public.contacts c
    join public.businesses b on b.id = c.business_id
    where c.next_send_at is not null
      and c.next_send_at <= now()
      and c.do_not_contact = false
      and c.status in ('pending', 'sent')
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
    where due.rn <= p_per_business
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
  select l.id, l.business_id, l.first_name, l.gender, l.send_kind, l.email, l.phone, l.token, l.requests_sent,
         coalesce(nullif(b.messaging ->> 'businessName', ''), b.name),
         b.review_link, b.messaging, b.scheduling
  from locked l
  join public.businesses b on b.id = l.business_id;
end;
$$;
revoke execute on function public.claim_due_contacts(int, int) from public, anon, authenticated;

-- Make the API see the new column/function right away
notify pgrst, 'reload schema';
