-- supabase/migrations/20261123000003_short_links.sql
-- Short review links: https://review.localocto.com/r?t=<business code>-<contact code>, e.g. r?t=sirmv-ab12
--   businesses.short_code: 5–6 lowercase letters/digits, unique. A client can set it once; agency logins can change it
--                          any time (enforced by a trigger, so it holds for direct updates too).
--   contacts.code:         4 characters, unique within the business, made automatically (existing contacts filled in).
-- Old links (r?t=<long token>) keep working. Needs 20261123000002. Safe to run more than once.

alter table public.businesses add column if not exists short_code text;
alter table public.businesses drop constraint if exists businesses_short_code_format;
alter table public.businesses add constraint businesses_short_code_format check (short_code is null or short_code ~ '^[a-z0-9]{5,6}$');
create unique index if not exists businesses_short_code_key on public.businesses (short_code) where short_code is not null;

create or replace function public.guard_short_code()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.short_code is not distinct from old.short_code then return new; end if;
  -- server code (no signed-in user) and agency logins may change it; a client only while it's still empty
  if auth.uid() is not null and old.short_code is not null and not public.is_agency() then
    raise exception 'The short link is already set. Ask your agency to change it.' using errcode = 'P0001';
  end if;
  new.short_code := lower(new.short_code);
  return new;
end;
$$;
drop trigger if exists businesses_guard_short_code on public.businesses;
create trigger businesses_guard_short_code before update of short_code on public.businesses
  for each row execute function public.guard_short_code();

-- 4-character contact codes (no look-alike characters)
create or replace function public.new_contact_code(p_business uuid)
returns text language plpgsql volatile set search_path = '' as $$
declare
  chars constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..4 loop
      c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.contacts where business_id = p_business and code = c);
  end loop;
  return c;
end;
$$;

alter table public.contacts add column if not exists code text;
update public.contacts set code = public.new_contact_code(business_id) where code is null;
create unique index if not exists contacts_business_code_key on public.contacts (business_id, code);

create or replace function public.set_contact_code()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.code is null then new.code := public.new_contact_code(new.business_id); end if;
  return new;
end;
$$;
drop trigger if exists contacts_set_code on public.contacts;
create trigger contacts_set_code before insert on public.contacts
  for each row execute function public.set_contact_code();

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
  code text,
  short_code text,
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
  select l.id, l.business_id, l.first_name, l.gender, l.send_kind, l.status::text, l.email, l.phone, l.token, l.code, b.short_code, l.requests_sent,
         b.name,  -- the business name on the Dashboard (the Messaging page's Business Name is only for tests/preview)
         b.review_link, b.messaging, b.scheduling
  from locked l
  join public.businesses b on b.id = l.business_id;
end;
$$;
revoke execute on function public.claim_due_contacts(int, int) from public, anon, authenticated;

notify pgrst, 'reload schema';
