// supabase/functions/send-test/index.ts
// "Send Test Message" button. Body: { businessId, to } where `to` is a phone number or email.

import { adminClient, getUser, isMember } from '../_shared/supabase.ts'
import { deliver, type Messaging } from '../_shared/send.ts'
import { json, preflight } from '../_shared/http.ts'
import { testImageUrl } from '../_shared/reviewImage.ts'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const admin = adminClient()
  const user = await getUser(req, admin)
  if (!user) return json({ error: 'Sign in required' }, 401)

  const { businessId, to } = (await req.json().catch(() => ({}))) as { businessId?: string; to?: string }
  if (!businessId || !to) return json({ error: 'businessId and to are required' }, 400)
  if (!(await isMember(admin, user.id, businessId))) return json({ error: 'Not allowed' }, 403)

  const { data: b } = await admin.from('businesses').select('name, review_link, messaging, country_code').eq('id', businessId).single()
  if (!b) return json({ error: 'Business not found' }, 404)
  if (!b.review_link) return json({ error: 'Add your Google review link first' }, 400)

  const isEmail = to.includes('@')
  let phone = ''
  if (!isEmail) {
    const digits = to.replace(/\D/g, '')
    phone = digits.length === 10 ? `${b.country_code}${digits}` : digits
  }
  const messaging = (b.messaging ?? {}) as Messaging
  const firstName = (user.user_metadata?.full_name as string | undefined)?.split(' ')[0] || 'there'
  const imageUrl = messaging.personalizedImage ? await testImageUrl(businessId, firstName) : undefined

  const result = await deliver({
    admin,
    businessId,
    contactId: null,
    kind: 'test',
    firstName,
    email: isEmail ? to.trim() : '',
    phone,
    businessName: messaging.businessName || b.name,
    messaging,
    link: b.review_link,
    imageUrl,
  })

  return result.ok ? json({ ok: true, channel: result.channel }) : json({ ok: false, error: result.error }, 502)
})
