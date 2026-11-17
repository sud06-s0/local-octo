-- supabase/migrations/20261117000002_agency_client_roles.sql
-- Two kinds of account:
--   agency → adds businesses, gives client logins access, submits WhatsApp templates
--   client → works inside the businesses it was given; sees only approved templates
-- New sign-ups are clients. Platform admins always count as agency.

alter table public.profiles
  add column if not exists account_type text not null default 'client'
  check (account_type in ('agency', 'client'));

-- Everyone who already created a business (and platform admins) stays agency
update public.profiles p
set account_type = 'agency'
where p.is_platform_admin
   or exists (select 1 from public.businesses b where b.created_by = p.id);

create or replace function public.is_agency()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (account_type = 'agency' or is_platform_admin)
  );
$$;

-- Only agency accounts can add businesses
create or replace function public.create_business(p_name text, p_address text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_agency() then
    raise exception 'Only agency accounts can add businesses';
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

-- Logins that can open a business (agency only)
create or replace function public.business_logins(p_business uuid)
returns table (user_id uuid, email text, full_name text, account_type text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.email, p.full_name, p.account_type
  from public.business_members m
  join public.profiles p on p.id = m.user_id
  where m.business_id = p_business
    and public.is_agency()
    and public.is_member(p_business)
  order by m.created_at;
$$;

create or replace function public.add_business_login(p_business uuid, p_email text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if not (public.is_agency() and public.is_member(p_business)) then
    raise exception 'Only agency accounts can give access';
  end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No account with this email yet. Ask them to sign up first, then add them.';
  end if;
  insert into public.business_members (business_id, user_id, role)
  values (p_business, v_user, 'member')
  on conflict (business_id, user_id) do nothing;
end;
$$;

create or replace function public.remove_business_login(p_business uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_agency() and public.is_member(p_business)) then
    raise exception 'Only agency accounts can remove access';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot remove yourself';
  end if;
  delete from public.business_members where business_id = p_business and user_id = p_user;
end;
$$;

revoke execute on function public.is_agency() from anon;
revoke execute on function public.business_logins(uuid) from anon;
revoke execute on function public.add_business_login(uuid, text) from anon;
revoke execute on function public.remove_business_login(uuid, uuid) from anon;
grant execute on function public.is_agency() to authenticated;
grant execute on function public.business_logins(uuid) to authenticated;
grant execute on function public.add_business_login(uuid, text) to authenticated;
grant execute on function public.remove_business_login(uuid, uuid) to authenticated;
