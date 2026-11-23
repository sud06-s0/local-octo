-- supabase/migrations/20261123000005_edit_contact.sql
-- Edit a contact's name, email and phone from the Contacts page. Phone is normalised like Add Contacts
-- (country code added). Members of the business only. Safe to run more than once.

drop function if exists public.update_contact_details(uuid, text, text, text, text);
create function public.update_contact_details(p_contact uuid, p_first text, p_last text, p_email text, p_phone text)
returns public.contacts
language plpgsql security definer set search_path = '' as $$
declare
  c public.contacts;
  v_cc text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text;
  v_first text := trim(coalesce(p_first, ''));
begin
  select * into c from public.contacts where id = p_contact;
  if c.id is null or not public.is_member(c.business_id) then
    raise exception 'Contact not found' using errcode = 'P0001';
  end if;
  select country_code into v_cc from public.businesses where id = c.business_id;
  v_phone := public.normalize_phone(coalesce(p_phone, ''), v_cc);
  if length(v_phone) < 10 then v_phone := ''; end if;
  if v_first = '' then raise exception 'First name is required' using errcode = 'P0001'; end if;
  if v_email = '' and v_phone = '' then raise exception 'Add an email or a phone number' using errcode = 'P0001'; end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email looks wrong' using errcode = 'P0001'; end if;
  if exists (select 1 from public.contacts x where x.business_id = c.business_id and x.id <> c.id
             and ((v_email <> '' and lower(x.email) = v_email) or (v_phone <> '' and x.phone = v_phone))) then
    raise exception 'Another contact already has this email or phone' using errcode = 'P0001';
  end if;
  update public.contacts
     set first_name = v_first, last_name = trim(coalesce(p_last, '')), email = v_email, phone = v_phone
   where id = c.id
  returning * into c;
  return c;
end;
$$;
revoke execute on function public.update_contact_details(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_contact_details(uuid, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
