// supabase/functions/client-login/index.ts
// Agency only (Account settings → Client logins): create a client's login with a password the agency sets,
// and give it access to one of the agency's businesses. No email is sent; the agency shares the login details.
// Body: { businessId | newBusinessName, name, email, password }. newBusinessName creates the client's own business
// (agency = owner, client = member); the client then connects it with their Google login. An email that already
// has a client account just gets access.
// Logins made here are always client accounts (account_type 'client', business role 'member'): no agency rights.
// Passwords are kept encrypted (client_credentials) so the agency can see them again:
//   { action: 'passwords', businessId } → { passwords: { [userId]: string | null } }  (client logins of that business)
//   { action: 'reset', businessId, userId } → { password }  (new password, old one stops working)

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

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    userId?: string
    businessId?: string
    newBusinessName?: string
    name?: string
    email?: string
    password?: string
  }

  // ---- show saved passwords / reset a password (client logins of one of the agency's businesses) ----
  if (body.action === 'passwords' || body.action === 'reset') {
    const bid = String(body.businessId ?? '')
    if (!bid || !(await isMember(admin, user.id, bid))) return json({ error: 'Pick one of your businesses' }, 403)
    const { data: members } = await admin.from('business_members').select('user_id').eq('business_id', bid)
    const ids = (members ?? []).map((m) => m.user_id as string)
    const { data: clients } = ids.length
      ? await admin.from('profiles').select('id').in('id', ids).eq('account_type', 'client').eq('is_platform_admin', false)
      : { data: [] }
    const clientIds = new Set((clients ?? []).map((c) => c.id as string))

    if (body.action === 'passwords') {
      const { data: rows } = clientIds.size ? await admin.from('client_credentials').select('user_id, password_enc').in('user_id', [...clientIds]) : { data: [] }
      const byId = new Map((rows ?? []).map((r) => [r.user_id as string, r.password_enc as string]))
      const passwords: Record<string, string | null> = {}
      for (const id of clientIds) {
        const enc = byId.get(id)
        passwords[id] = enc ? await decrypt(enc).catch(() => null) : null
      }
      return json({ passwords })
    }

    const target = String(body.userId ?? '')
    if (!clientIds.has(target)) return json({ error: 'This login is not a client of this business' }, 403)
    const fresh = makePassword()
    const { error } = await admin.auth.admin.updateUserById(target, { password: fresh })
    if (error) return json({ error: error.message }, 400)
    const saveErr = await savePassword(admin, target, fresh, user.id)
    if (saveErr) return json({ ok: true, password: fresh, warning: `Password changed, but not saved for later: ${saveErr}` })
    return json({ ok: true, password: fresh })
  }

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
    await savePassword(admin, userId, password, user.id)
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

// ---------- password storage (AES-GCM; key derived from the service role key, which only Edge Functions have) ----------

/** 12 characters, no look-alikes, easy to read out. */
function makePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => chars[b % chars.length]).join('')
}

let keyPromise: Promise<CryptoKey> | null = null
function key(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const secret = Deno.env.get('CLIENT_PASSWORD_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`client-login:${secret}`))
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  })()
  return keyPromise
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function encrypt(text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(text)))
  return `${b64(iv)}.${b64(ct)}`
}

async function decrypt(enc: string): Promise<string> {
  const [iv, ct] = enc.split('.')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(), unb64(ct))
  return new TextDecoder().decode(pt)
}

/** Saves the encrypted password; returns an error message when it couldn't be saved (e.g. table missing). */
async function savePassword(admin: ReturnType<typeof adminClient>, userId: string, password: string, by: string): Promise<string | null> {
  const { error } = await admin
    .from('client_credentials')
    .upsert({ user_id: userId, password_enc: await encrypt(password), updated_by: by, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  return error ? error.message : null
}
