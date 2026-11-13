-- supabase/migrations/20261112000001_init.sql
-- Local Octo review platform: multi-business schema, RLS, RPCs and storage.
-- Run once in Supabase SQL Editor (or `supabase db push`).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'member');
create type public.contact_status as enum ('pending', 'sent', 'clicked', 'reviewed', 'stopped');
create type public.message_channel as enum ('whatsapp', 'email', 'sms');
create type public.message_kind as enum ('initial', 'follow_up', 'test');
create type public.message_status as enum ('queued', 'sent', 'delivered', 'read', 'failed');
create type public.reply_source as enum ('google', 'app', 'draft');
create type public.notification_type as enum ('new_review', 'low_rating', 'link_clicked', 'system');

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  is_platform_admin boolean not null default false, -- Local Octo staff: see every business
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Businesses (tenants) and members
-- ---------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  address text not null default '',
  place_id text,
  review_link text not null default '',
  maps_url text not null default '',
  timezone text not null default 'Asia/Kolkata',
  country_code text not null default '91', -- used to normalise 10-digit phone numbers
  public_key text not null unique default encode(extensions.gen_random_bytes(12), 'hex'), -- widgets (safe to expose)
  api_key_hash text unique, -- sha256 of the webhook API key
  api_key_prefix text,
  messaging jsonb not null default jsonb_build_object(
    'mode', 'smart',
    'ownerFirstName', '',
    'businessName', '',
    'personalizedImage', true,
    'imageDataUrl', null,
    'customMessage', 'Hey {first_name}, we hope you enjoyed your experience with {business_name}! Would you mind taking a moment to leave a review? Here''s the link: {review_link}',
    'customFollowUp', 'Hi {first_name}, just a quick reminder — your feedback means a lot to us! {review_link}',
    'followUpsEnabled', true
  ),
  scheduling jsonb not null default '{"active": true, "initialDelayIndex": 0, "followUps": 2}'::jsonb,
  ai jsonb not null default '{"autoPostPositive": false, "nickname": ""}'::jsonb,
  widgets jsonb not null default jsonb_build_object(
    'popup', jsonb_build_object('position', 'left', 'star', '#FFC107', 'background', '#FFFFFF', 'text', '#000000'),
    'carousel', jsonb_build_object('star', '#FFC107', 'background', '#FFFFFF', 'text', '#333333')
  ),
  social jsonb not null default '{"facebookConnected": false, "instagramConnected": false, "autoPost": false, "captionSource": "review", "templates": [], "activeTemplateId": null}'::jsonb,
  notification_prefs jsonb not null default '{"emailNewReview": true, "emailLowRating": true, "whatsappLowRating": true, "weeklySummary": true, "lowRatingThreshold": 3}'::jsonb,
  integrations jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index business_members_user_idx on public.business_members (user_id);

-- Per-business sending credentials. RLS on with NO policies: only Edge Functions
-- (secret key) can read it. Empty columns fall back to the platform env secrets.
create table public.business_channels (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  whatsapp_phone_number_id text,
  whatsapp_access_token text,
  whatsapp_template_initial text,
  whatsapp_template_initial_image text, -- same text, Header = Image (used when a photo is uploaded)
  whatsapp_template_followup text,
  whatsapp_template_lang text,
  email_from text,
  email_from_name text,
  email_domain text,
  msg91_email_template_id text,
  msg91_sms_template_initial text,
  msg91_sms_template_followup text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Contacts, messages, reviews, notifications, social posts
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  first_name text not null,
  last_name text not null default '',
  email text not null default '',
  phone text not null default '', -- digits only, with country code (e.g. 919845011223)
  status public.contact_status not null default 'pending',
  do_not_contact boolean not null default false,
  consent_at timestamptz,
  source text not null default 'manual', -- manual | csv | webhook
  requests_sent int not null default 0,
  last_sent_at timestamptz,
  next_send_at timestamptz,
  clicked_at timestamptz,
  reviewed_at timestamptz,
  stopped_at timestamptz,
  token text not null unique default encode(extensions.gen_random_bytes(9), 'hex'), -- review-link click tracking
  created_at timestamptz not null default now(),
  check (email <> '' or phone <> '')
);
create index contacts_business_created_idx on public.contacts (business_id, created_at desc);
create index contacts_due_idx on public.contacts (next_send_at) where next_send_at is not null and do_not_contact = false;
create unique index contacts_business_email_uq on public.contacts (business_id, lower(email)) where email <> '';
create unique index contacts_business_phone_uq on public.contacts (business_id, phone) where phone <> '';

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  channel public.message_channel not null,
  kind public.message_kind not null,
  status public.message_status not null default 'queued',
  recipient text not null default '',
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index messages_business_idx on public.messages (business_id, created_at desc);
create index messages_provider_idx on public.messages (provider_message_id) where provider_message_id is not null;

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  google_review_id text,
  author text not null,
  author_photo_url text,
  avatar_color text not null default '#2f8c4a',
  rating smallint not null check (rating between 1 and 5),
  text text not null default '',
  url text not null default '',
  review_created_at timestamptz not null default now(),
  reply_text text,
  reply_source public.reply_source,
  reply_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, google_review_id)
);
create index reviews_business_idx on public.reviews (business_id, review_created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  body text not null default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_business_idx on public.notifications (business_id, created_at desc);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  review_id uuid references public.reviews (id) on delete cascade,
  network text not null check (network in ('facebook', 'instagram')),
  format text not null check (format in ('feed', 'story')),
  status text not null default 'scheduled' check (status in ('scheduled', 'posted', 'failed')),
  error text,
  scheduled_at timestamptz not null default now(),
  posted_at timestamptz,
  created_at timestamptz not null default now()
);
create index social_posts_business_idx on public.social_posts (business_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger businesses_touch before update on public.businesses
  for each row execute function public.touch_updated_at();

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.is_member(p_business uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin()
      or exists (select 1 from public.business_members m where m.business_id = p_business and m.user_id = auth.uid());
$$;

create or replace function public.is_business_admin(p_business uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin()
      or exists (
        select 1 from public.business_members m
        where m.business_id = p_business and m.user_id = auth.uid() and m.role in ('owner', 'admin')
      );
$$;

-- Digits only, prefixed with the country code when a local 10-digit number is given.
create or replace function public.normalize_phone(p_phone text, p_country text default '91')
returns text language sql immutable set search_path = '' as $$
  with d as (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits)
  select case
    when length(digits) = 0 then ''
    when length(digits) = 10 then p_country || digits
    when length(digits) = 11 and left(digits, 1) = '0' then p_country || substr(digits, 2)
    else digits
  end
  from d;
$$;

-- Delay options shown on the Request Scheduling page (index -> interval).
create or replace function public.initial_delay(p_index int)
returns interval language sql immutable set search_path = '' as $$
  select (array['0 minutes', '1 hour', '3 hours', '6 hours', '1 day', '2 days', '3 days', '7 days'])[
    least(greatest(coalesce(p_index, 0), 0), 7) + 1
  ]::interval;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.business_channels enable row level security; -- no policies on purpose
alter table public.contacts enable row level security;
alter table public.messages enable row level security;
alter table public.reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.social_posts enable row level security;

create policy "profiles: read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_platform_admin());
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated; -- cannot self-promote to platform admin

create policy "businesses: members read" on public.businesses
  for select to authenticated using (public.is_member(id));
create policy "businesses: admins update" on public.businesses
  for update to authenticated using (public.is_business_admin(id)) with check (public.is_business_admin(id));
create policy "businesses: platform admin delete" on public.businesses
  for delete to authenticated using (public.is_platform_admin());
-- Inserts go through create_business(); keys are only changed by functions.
revoke insert, update on public.businesses from authenticated, anon;
grant update (name, address, place_id, review_link, maps_url, timezone, country_code,
  messaging, scheduling, ai, widgets, social, notification_prefs, integrations)
  on public.businesses to authenticated;
-- Never expose the API key hash to the browser.
revoke select on public.businesses from anon, authenticated;
grant select (id, name, address, place_id, review_link, maps_url, timezone, country_code, public_key,
  api_key_prefix, messaging, scheduling, ai, widgets, social, notification_prefs, integrations,
  created_by, created_at, updated_at)
  on public.businesses to authenticated;

create policy "members: read own businesses" on public.business_members
  for select to authenticated using (public.is_member(business_id));
create policy "members: admins manage" on public.business_members
  for all to authenticated using (public.is_business_admin(business_id)) with check (public.is_business_admin(business_id));

create policy "contacts: members all" on public.contacts
  for all to authenticated using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy "messages: members read" on public.messages
  for select to authenticated using (public.is_member(business_id));
create policy "reviews: members all" on public.reviews
  for all to authenticated using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy "notifications: members all" on public.notifications
  for all to authenticated using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy "social: members all" on public.social_posts
  for all to authenticated using (public.is_member(business_id)) with check (public.is_member(business_id));

-- ---------------------------------------------------------------------------
-- RPCs called from the app
-- ---------------------------------------------------------------------------

-- Create a business and make the caller its owner.
create or replace function public.create_business(p_name text, p_address text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into public.businesses (name, address, created_by)
  values (trim(p_name), coalesce(p_address, ''), auth.uid())
  returning * into b;

  update public.businesses
  set messaging = messaging || jsonb_build_object('businessName', b.name)
  where id = b.id
  returning * into b;

  insert into public.business_members (business_id, user_id, role)
  values (b.id, auth.uid(), 'owner');
  return b.id;
end;
$$;

-- Insert or refresh one contact and schedule its first request.
-- Shared by add_contacts() (app) and the contacts-webhook Edge Function.
create or replace function public.upsert_contact(
  p_business uuid,
  p_first text,
  p_last text,
  p_email text,
  p_phone text,
  p_dnc boolean,
  p_source text,
  p_consent boolean
)
returns text -- 'added' | 'updated' | 'cooldown' | 'invalid'
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text;
  v_first text := trim(coalesce(p_first, ''));
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

  insert into public.contacts (business_id, first_name, last_name, email, phone, do_not_contact, status, source, consent_at, next_send_at)
  values (
    p_business, v_first, trim(coalesce(p_last, '')), v_email, v_phone, coalesce(p_dnc, false),
    case when coalesce(p_dnc, false) then 'stopped'::public.contact_status else 'pending' end,
    coalesce(p_source, 'manual'),
    case when p_consent then now() end,
    case when coalesce(p_dnc, false) then null else v_next end
  );
  return 'added';
end;
$$;
revoke execute on function public.upsert_contact(uuid, text, text, text, text, boolean, text, boolean) from public, anon, authenticated;

-- App entry point: add many contacts at once (single form or CSV).
-- p_contacts: [{ "firstName", "lastName", "email", "phone", "doNotContact" }]
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
      p_source, p_consent
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

-- Create a new webhook API key. Returns the plain key ONCE; only its hash is stored.
create or replace function public.regenerate_api_key(p_business uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_key text := 'lo_live_' || encode(extensions.gen_random_bytes(18), 'hex');
begin
  if not public.is_business_admin(p_business) then
    raise exception 'Not allowed';
  end if;
  update public.businesses
  set api_key_hash = encode(extensions.digest(v_key, 'sha256'), 'hex'),
      api_key_prefix = left(v_key, 14)
  where id = p_business;
  return v_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- Functions used only by Edge Functions (secret key)
-- ---------------------------------------------------------------------------

-- Lock and return contacts that are due, inside each business's 9 AM–7 PM window,
-- at most p_per_business per business per run (natural pacing for reactivation lists).
create or replace function public.claim_due_contacts(p_limit int default 100, p_per_business int default 20)
returns table (
  contact_id uuid,
  business_id uuid,
  first_name text,
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
  select l.id, l.business_id, l.first_name, l.email, l.phone, l.token, l.requests_sent,
         coalesce(nullif(b.messaging ->> 'businessName', ''), b.name),
         b.review_link, b.messaging, b.scheduling
  from locked l
  join public.businesses b on b.id = l.business_id;
end;
$$;
revoke execute on function public.claim_due_contacts(int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: public bucket for message images (path: <business_id>/<file>)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('business-assets', 'business-assets', true)
on conflict (id) do nothing;

create policy "assets: members upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'business-assets' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "assets: members update" on storage.objects
  for update to authenticated
  using (bucket_id = 'business-assets' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "assets: members delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'business-assets' and public.is_member(((storage.foldername(name))[1])::uuid));
