// supabase/functions/contacts-webhook/index.ts
// POST contacts from Zapier, Pabbly, a CRM or any system.
// Auth: header `x-api-key: lo_live_...` (generate it on the Integrations page).
// Body: one contact, an array, or { "contacts": [...] }.
// Fields: first_name (or name), last_name, email, phone, do_not_contact.
// Sending through this API confirms you have the customer's consent to message them.

import { adminClient } from '../_shared/supabase.ts'
import { json, preflight, sha256Hex } from '../_shared/http.ts'

type Raw = Record<string, unknown>
const MAX = 500

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '')

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const key = req.headers.get('x-api-key') ?? req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!key.startsWith('lo_live_')) return json({ error: 'Missing or invalid API key' }, 401)

  const admin = adminClient()
  const { data: business } = await admin.from('businesses').select('id').eq('api_key_hash', await sha256Hex(key)).maybeSingle()
  if (!business) return json({ error: 'Missing or invalid API key' }, 401)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const list: Raw[] = Array.isArray(body) ? body : Array.isArray((body as Raw)?.contacts) ? ((body as Raw).contacts as Raw[]) : [body as Raw]
  if (list.length > MAX) return json({ error: `Send at most ${MAX} contacts per request` }, 413)

  const counts: Record<string, number> = { added: 0, updated: 0, cooldown: 0, invalid: 0 }
  for (const c of list) {
    let first = str(c.first_name ?? c.firstName ?? c.name)
    let last = str(c.last_name ?? c.lastName)
    if (!last && first.includes(' ')) [first, last] = [first.split(' ')[0], first.split(' ').slice(1).join(' ')]
    const { data, error } = await admin.rpc('upsert_contact', {
      p_business: business.id,
      p_first: first,
      p_last: last,
      p_email: str(c.email),
      p_phone: str(c.phone ?? c.mobile ?? c.whatsapp),
      p_dnc: c.do_not_contact === true || c.doNotContact === true,
      p_source: 'webhook',
      p_consent: true,
    })
    const result = error ? 'invalid' : String(data)
    counts[result] = (counts[result] ?? 0) + 1
  }

  return json({ ok: true, received: list.length, ...counts })
})
