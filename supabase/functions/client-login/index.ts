// supabase/functions/client-login/index.ts
// Agency only (Account settings → Client logins): create a client's login with a password the agency sets,
// and give it access to one of the agency's businesses. No email is sent; the agency shares the login details.
// Body: { businessId | newBusinessName, name, email, password }. newBusinessName creates the client's own business
// (agency = owner, client = member); the client then connects it with their Google login. An email that already
// has a client account just gets access.
// Logins made here are always client accounts (account_type 'client', business role 'member'): no agency rights.

import { adminClient, getUser, isAgency, isMember } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const admin = adminClient()
  const user = await getUser(req, admin)
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!(await isAgency(admin, user.id))) return json({ error: 'Only agency accounts can create client logins' }, 403)

  const body = (await req.json().catch(() => ({}))) as { businessId?: string; newBusinessName?: string; name?: string; email?: string; password?: string }
  let businessId = String(body.businessId ?? '')
  const newBusinessName = String(body.newBusinessName ?? '').trim().slice(0, 120)
  const name = String(body.name ?? '').trim().slice(0, 120)
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (!newBusinessName && (!businessId || !(await isMember(admin, user.id, businessId)))) return json({ error: 'Pick one of your businesses' }, 403)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email' }, 400)

  // Existing account? Just give it access — but only if it is a client account (never an agency / admin one)
  const { data: existing } = await admin.from('profiles').select('id, account_type, is_platform_admin').ilike('email', email).maybeSingle()
  if (existing && (existing.account_type !== 'client' || existing.is_platform_admin)) {
    return json({ error: 'This email is an agency account. Client logins must use a client email.' }, 400)
  }
  let userId = existing?.id as string | undefined
  let created = false

  if (!userId) {
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400)
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // can sign in straight away, no confirmation email
      user_metadata: { full_name: name },
    })
    if (error || !data.user) return json({ error: error?.message ?? 'Could not create the login' }, 400)
    userId = data.user.id
    created = true
    // The profile row comes from the auth trigger; make sure it is a client account with the name filled in
    await admin.from('profiles').upsert({ id: userId, email, full_name: name, account_type: 'client' }, { onConflict: 'id' })
  }

  // New business for this client: same as "Add business" (agency is the owner), named by the agency
  if (newBusinessName) {
    const { data: biz, error: bizError } = await admin
      .from('businesses')
      .insert({ name: newBusinessName, created_by: user.id })
      .select('id, messaging')
      .single()
    if (bizError || !biz) return json({ error: `Login ${created ? 'created' : 'found'}, but the business could not be created` }, 500)
    businessId = biz.id as string
    // keep the default messaging settings, only fill in the business name (as create_business does)
    await admin.from('businesses').update({ messaging: { ...(biz.messaging ?? {}), businessName: newBusinessName } }).eq('id', businessId)
    await admin.from('business_members').insert({ business_id: businessId, user_id: user.id, role: 'owner' })
  }

  const { error: memberError } = await admin
    .from('business_members')
    .upsert({ business_id: businessId, user_id: userId, role: 'member' }, { onConflict: 'business_id,user_id', ignoreDuplicates: true })
  if (memberError) return json({ error: 'Login created, but could not give access to the business' }, 500)

  return json({ ok: true, created, businessId })
})
