// supabase/functions/r/index.ts
// Review-link redirect: /functions/v1/r?t=<contact token>
// Records the click (stops follow-ups) and sends the customer to the Google review form.

import { adminClient } from '../_shared/supabase.ts'

// Link-preview crawlers (WhatsApp, Facebook, Slack…) must not count as a customer click.
const BOT = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slack|telegram|discord|skype|linkedin/i

function page(title: string, body: string, status = 404) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8f9f9;color:#1d2320">
<div style="text-align:center;padding:24px"><h1 style="font-size:20px">${title}</h1><p style="color:#5d6762">${body}</p></div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('t') ?? ''
  if (!/^[a-f0-9]{8,64}$/.test(token)) return page('Link not found', 'This review link is not valid.')

  const admin = adminClient()
  const { data: contact } = await admin
    .from('contacts')
    .select('id, business_id, first_name, last_name, status, clicked_at, businesses(review_link)')
    .eq('token', token)
    .maybeSingle()

  const business = contact?.businesses as unknown as { review_link: string } | null
  if (!contact || !business?.review_link) return page('Link not found', 'This review link has expired.')

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

  return new Response(null, { status: 302, headers: { Location: business.review_link, 'Cache-Control': 'no-store' } })
})
