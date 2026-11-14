// supabase/functions/review-image/index.ts
// Personalised image shown above the WhatsApp/email review request.
//   ?t=<contact token>                 -> business photo + "<FirstName>!"
//   ?b=<business id>&n=<name>&s=<sig>  -> signed URL used by "Send Test Message"
// WhatsApp downloads this URL once when the message is sent.

import { adminClient } from '../_shared/supabase.ts'
import { verifyTestSignature } from '../_shared/reviewImage.ts'
import { renderReviewImage } from '../_shared/renderImage.ts'

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const admin = adminClient()
  let photo: string | null = null
  let name = ''

  const token = url.searchParams.get('t')
  if (token) {
    if (!/^[a-f0-9]{8,64}$/.test(token)) return new Response('Not found', { status: 404 })
    const { data } = await admin.from('contacts').select('first_name, businesses(messaging)').eq('token', token).maybeSingle()
    if (!data) return new Response('Not found', { status: 404 })
    name = data.first_name
    photo = ((data.businesses as unknown as { messaging?: { imageDataUrl?: string } })?.messaging?.imageDataUrl) ?? null
  } else {
    const b = url.searchParams.get('b') ?? ''
    const n = url.searchParams.get('n') ?? ''
    const s = url.searchParams.get('s') ?? ''
    if (!/^[0-9a-f-]{36}$/.test(b) || !(await verifyTestSignature(b, n, s))) return new Response('Not found', { status: 404 })
    const { data } = await admin.from('businesses').select('messaging').eq('id', b).maybeSingle()
    if (!data) return new Response('Not found', { status: 404 })
    name = n
    photo = (data.messaging as { imageDataUrl?: string })?.imageDataUrl ?? null
  }

  try {
    const jpeg = await renderReviewImage(photo, name)
    return new Response(new Blob([jpeg as Uint8Array<ArrayBuffer>]), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } })
  } catch (e) {
    console.error('review-image failed', e)
    return new Response('Image error', { status: 500 })
  }
})
