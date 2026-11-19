-- supabase/migrations/20261119000002_contact_gender.sql
-- Contact gender: WhatsApp messages address the customer as "<First name> Sir" (male) or "<First name> Ma'am" (female).
-- Safe to run more than once.

alter table public.contacts add column if not exists gender text not null default '';
alter table public.contacts drop constraint if exists contacts_gender_check;
alter table public.contacts add constraint contacts_gender_check check (gender in ('', 'male', 'female'));

-- 'male' / 'm' / 'female' / 'f' (any case) -> 'male' / 'female'; anything else -> null (= not given)
create or replace function public.normalize_gender(p text)
returns text language sql immutable set search_path = '' as $$
  select case lower(trim(coalesce(p, '')))
    when 'male' then 'male' when 'm' then 'male'
    when 'female' then 'female' when 'f' then 'female'
    else null end;
$$;

-- upsert_contact gets p_gender (default null = keep what is there)
drop function if exists public.upsert_contact(uuid, text, text, text, text, boolean, text, boolean);
drop function if exists public.upsert_contact(uuid, text, text, text, text, boolean, text, boolean, text);
create function public.upsert_contact(
  p_business uuid,
  p_first text,
  p_last text,
  p_email text,
  p_phone text,
  p_dnc boolean,
  p_source text,
  p_consent boolean,
  p_gender text default null
)
returns text -- 'added' | 'updated' | 'cooldown' | 'invalid'
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text;
  v_first text := trim(coalesce(p_first, ''));
  v_gender text := public.normalize_gender(p_gender);
  existing public.contacts;
  v_next timestamptz;
begin
  select * into b from public.businesses where id = p_business;
  if not found then
    return 'invalid';
  end if;
  v_phone := public.normalize_phone(p_phone, b.country_code);
  if v_first = '' or (v_email = '' and length(v_phone) < 10) then
    return 'invalid';
  end if;
  if length(v_phone) < 10 then v_phone := ''; end if;

  v_next := now() + public.initial_delay((b.scheduling ->> 'initialDelayIndex')::int);

  select * into existing from public.contacts c
  where c.business_id = p_business
    and ((v_email <> '' and lower(c.email) = v_email) or (v_phone <> '' and c.phone = v_phone))
  limit 1;

  if found then
    if v_gender is not null then
      update public.contacts set gender = v_gender where id = existing.id;
    end if;
    if existing.do_not_contact then
      return 'updated'; -- never re-enable an opted-out contact automatically
    end if;
    -- 30-day cooldown so repeat customers are not asked again too soon
    if existing.last_sent_at is not null and existing.last_sent_at > now() - interval '30 days' then
      return 'cooldown';
    end if;
    update public.contacts set
      first_name = v_first,
      last_name = coalesce(nullif(trim(p_last), ''), last_name),
      email = coalesce(nullif(v_email, ''), email),
      phone = coalesce(nullif(v_phone, ''), phone),
      do_not_contact = coalesce(p_dnc, false),
      status = case when coalesce(p_dnc, false) then 'stopped'::public.contact_status
                    when status = 'reviewed' then status else 'pending' end,
      requests_sent = case when status = 'reviewed' then requests_sent else 0 end,
      next_send_at = case when coalesce(p_dnc, false) or status = 'reviewed' then null else v_next end,
      consent_at = case when p_consent then now() else consent_at end,
      clicked_at = null
    where id = existing.id;
    return 'updated';
  end if;

  insert into public.contacts (business_id, first_name, last_name, email, phone, gender, do_not_contact, status, source, consent_at, next_send_at)
  values (
    p_business, v_first, trim(coalesce(p_last, '')), v_email, v_phone, coalesce(v_gender, ''), coalesce(p_dnc, false),
    case when coalesce(p_dnc, false) then 'stopped'::public.contact_status else 'pending' end,
    coalesce(p_source, 'manual'),
    case when p_consent then now() end,
    case when coalesce(p_dnc, false) then null else v_next end
  );
  return 'added';
end;
$$;
revoke execute on function public.upsert_contact(uuid, text, text, text, text, boolean, text, boolean, text) from public, anon, authenticated;

-- add_contacts passes "gender" through
-- p_contacts: [{ "firstName", "lastName", "email", "phone", "gender", "doNotContact" }]
create or replace function public.add_contacts(p_business uuid, p_contacts jsonb, p_source text default 'manual', p_consent boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  res text;
  added int := 0; updated int := 0; cooldown int := 0; invalid int := 0;
begin
  if not public.is_member(p_business) then
    raise exception 'Not allowed';
  end if;
  for item in select * from jsonb_array_elements(coalesce(p_contacts, '[]'::jsonb)) loop
    res := public.upsert_contact(
      p_business,
      item ->> 'firstName', item ->> 'lastName', item ->> 'email', item ->> 'phone',
      coalesce((item ->> 'doNotContact')::boolean, false),
      p_source, p_consent,
      item ->> 'gender'
    );
    case res
      when 'added' then added := added + 1;
      when 'updated' then updated := updated + 1;
      when 'cooldown' then cooldown := cooldown + 1;
      else invalid := invalid + 1;
    end case;
  end loop;
  return jsonb_build_object('added', added, 'updated', updated, 'cooldown', cooldown, 'invalid', invalid);
end;
$$;

-- claim_due_contacts also returns gender (return type changes, so drop first)
drop function if exists public.claim_due_contacts(int, int);
create function public.claim_due_contacts(p_limit int default 100, p_per_business int default 20)
returns table (
  contact_id uuid,
  business_id uuid,
  first_name text,
  gender text,
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
      and extract(hour from (now() at time zone b.timezone)) >= 9
      and extract(hour from (now() at time zone b.timezone)) < 19
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
  select l.id, l.business_id, l.first_name, l.gender, l.email, l.phone, l.token, l.requests_sent,
         coalesce(nullif(b.messaging ->> 'businessName', ''), b.name),
         b.review_link, b.messaging, b.scheduling
  from locked l
  join public.businesses b on b.id = l.business_id;
end;
$$;
revoke execute on function public.claim_due_contacts(int, int) from public, anon, authenticated;
