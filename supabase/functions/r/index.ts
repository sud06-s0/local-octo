// supabase/functions/r/index.ts
// Review-link redirect: /functions/v1/r?t=<contact token>
// SMS links carry a short business name first ("sirmvpu-<token>"); only the part after the last "-" counts.
// Test SMS carry the business public key instead of a contact token -> the business's review page.
// Records the click (stops follow-ups) and opens the review page (4 faces) in the app.
// APP_URL secret = the app's address (default https://review.localocto.com).

import { adminClient } from '../_shared/supabase.ts'

// Link-preview crawlers (WhatsApp, Facebook, Slack…) must not count as a customer click.
const BOT = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slack|telegram|discord|skype|linkedin/i

// Supabase serves function responses as plain text, so an HTML error page would show as raw code.
// Every outcome goes to the app's review page instead; it shows the faces, or "link not valid" if the token is unknown.
function toReviewPage(token: string) {
  const appUrl = (Deno.env.get('APP_URL') || 'https://review.localocto.com').replace(/\/+$/, '')
  return new Response(null, { status: 302, headers: { Location: `${appUrl}/review?t=${encodeURIComponent(token)}`, 'Cache-Control': 'no-store' } })
}

Deno.serve(async (req) => {
  const raw = new URL(req.url).searchParams.get('t') ?? ''
  const token = raw.split('-').pop() ?? ''
  if (!/^[a-f0-9]{8,64}$/.test(token)) return toReviewPage(token)

  const admin = adminClient()
  const { data: contact } = await admin
    .from('contacts')
    .select('id, business_id, first_name, last_name, status, clicked_at, businesses(review_link)')
    .eq('token', token)
    .maybeSingle()

  if (!contact) {
    const { data: biz } = await admin.from('businesses').select('public_key').eq('public_key', token).maybeSingle()
    if (biz) {
      const appUrl = (Deno.env.get('APP_URL') || 'https://review.localocto.com').replace(/\/+$/, '')
      return new Response(null, { status: 302, headers: { Location: `${appUrl}/review?b=${encodeURIComponent(token)}`, 'Cache-Control': 'no-store' } })
    }
  }

  const business = contact?.businesses as unknown as { review_link: string } | null
  if (!contact || !business?.review_link) return toReviewPage(token)

  const isBot = BOT.test(req.headers.get('user-agent') ?? '')
  if (!isBot && !contact.clicked_at) {
    await admin
      .from('contacts')
      .update({
        clicked_at: new Date().toISOString(),
        next_send_at: null,
        status: contact.status === 'reviewed' ? 'reviewed' : 'clicked',
      })
      .eq('id', contact.id)
    await admin.from('notifications').insert({
      business_id: contact.business_id,
      type: 'link_clicked',
      title: 'Review link clicked',
      body: `${`${contact.first_name} ${contact.last_name}`.trim()} opened your review link.`,
    })
  }

  return toReviewPage(token)
})
