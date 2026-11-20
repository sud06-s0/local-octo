// supabase/functions/feedback/index.ts
// Public API for the review page (review.localocto.com/review?t=<contact token> or ?b=<business public key>).
//  GET  ?t= | ?b=                       → { businessName, firstName, knownContact }
//  POST { t | b, rating, text?, photo?, name?, email?, phone? } → saves the answer.
//       rating 5 (Happy) / 4 (Good): text + optional photo (data URL, max 5 MB) → returns { reviewLink }
//       rating 2 (Bad) / 1 (Worse): text + optional photo saved for the business (plus contact details on shared links);
//       nothing goes to Google → returns { reviewLink: null }

import { adminClient } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'

const LABEL: Record<number, string> = { 5: 'Happy', 4: 'Good', 2: 'Bad', 1: 'Worse' }
const MAX_PHOTO = 5 * 1024 * 1024

async function findTarget(admin: ReturnType<typeof adminClient>, t: string, b: string) {
  if (/^[a-f0-9]{8,64}$/.test(t)) {
    const { data } = await admin
      .from('contacts')
      .select('id, business_id, first_name, businesses(name, review_link)')
      .eq('token', t)
      .maybeSingle()
    const biz = data?.businesses as unknown as { name: string; review_link: string } | null
    if (data && biz) return { businessId: data.business_id as string, contactId: data.id as string, firstName: data.first_name as string, name: biz.name, reviewLink: biz.review_link }
  }
  if (/^[a-f0-9]{8,64}$/.test(b)) {
    const { data } = await admin.from('businesses').select('id, name, review_link').eq('public_key', b).maybeSingle()
    if (data) return { businessId: data.id as string, contactId: null, firstName: '', name: data.name as string, reviewLink: data.review_link as string }
  }
  return null
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const admin = adminClient()

  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams
    const target = await findTarget(admin, q.get('t') ?? '', q.get('b') ?? '')
    if (!target) return json({ error: 'This review link is not valid' }, 404)
    return json({ businessName: target.name, firstName: target.firstName, knownContact: !!target.contactId })
  }

  if (req.method !== 'POST') return json({ error: 'Use GET or POST' }, 405)
  const input = (await req.json().catch(() => ({}))) as {
    t?: string
    b?: string
    rating?: number
    text?: string
    photo?: string
    name?: string
    email?: string
    phone?: string
  }
  const target = await findTarget(admin, input.t ?? '', input.b ?? '')
  if (!target) return json({ error: 'This review link is not valid' }, 404)

  const rating = Number(input.rating)
  if (!LABEL[rating]) return json({ error: 'Pick one of the faces' }, 400)
  const positive = rating >= 4

  // Text and photo only for Happy / Good
  // Review text (+ photo) for every face; Bad / Worse are saved for the business only
  const text = String(input.text ?? '').trim().slice(0, 4000)
  // Contact details only matter on shared links (no contact behind them)
  const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
  // Name the customer typed on the form (WhatsApp links come prefilled with the contact's first name)
  const customerName = clean(input.name, 120)
  const customerEmail = target.contactId ? '' : clean(input.email, 200)
  const customerPhone = target.contactId ? '' : clean(input.phone, 30)
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) return json({ error: 'Please check the email address' }, 400)
  let photoUrl: string | null = null
  if (input.photo) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.photo)
    if (!m) return json({ error: 'Photo must be a JPG, PNG or WebP image' }, 400)
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0))
    if (bytes.length > MAX_PHOTO) return json({ error: 'Photo is too large (5 MB max)' }, 400)
    const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg'
    const path = `${target.businessId}/feedback/${crypto.randomUUID()}.${ext}`
    const { error } = await admin.storage.from('business-assets').upload(path, bytes, { contentType: m[1] })
    if (error) return json({ error: 'Could not save the photo' }, 500)
    photoUrl = admin.storage.from('business-assets').getPublicUrl(path).data.publicUrl
  }

  const { error } = await admin.from('review_feedback').insert({
    business_id: target.businessId,
    contact_id: target.contactId,
    rating,
    text,
    photo_url: photoUrl,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
  })
  if (error) return json({ error: error.message }, 500)

  await admin.from('notifications').insert({
    business_id: target.businessId,
    type: positive ? 'new_review' : 'low_rating',
    title: `Review page: ${LABEL[rating]}`,
    body: `${target.firstName || customerName || 'A customer'} picked ${LABEL[rating]}${text ? `: "${text.slice(0, 120)}"` : ''}`,
  })

  return json({ ok: true, reviewLink: positive ? target.reviewLink || null : null })
})
