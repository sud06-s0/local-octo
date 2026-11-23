-- supabase/migrations/20261123000006_qr_download.sql
-- Review-link QR code PDF: a client login can download it once, agency logins any time.
-- businesses.qr_downloaded_at records the first download. Safe to run more than once.

alter table public.businesses add column if not exists qr_downloaded_at timestamptz;
grant select (qr_downloaded_at) on public.businesses to authenticated;

drop function if exists public.mark_qr_download(uuid);
create function public.mark_qr_download(p_business uuid)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz;
begin
  if not public.is_member(p_business) then
    raise exception 'Business not found' using errcode = 'P0001';
  end if;
  select qr_downloaded_at into v_at from public.businesses where id = p_business;
  if v_at is not null and not public.is_agency() then
    raise exception 'The QR code PDF was already downloaded. Ask your agency for another copy.' using errcode = 'P0001';
  end if;
  update public.businesses set qr_downloaded_at = coalesce(qr_downloaded_at, now()) where id = p_business
  returning qr_downloaded_at into v_at;
  return v_at;
end;
$$;
revoke execute on function public.mark_qr_download(uuid) from public, anon;
grant execute on function public.mark_qr_download(uuid) to authenticated;

notify pgrst, 'reload schema';
