// supabase/functions/dispatch/index.ts
// Called every minute by cron-job.org with header `x-cron-secret: <CRON_SECRET>`.
// Sends due review requests and follow-ups inside each business's 9 AM–7 PM window.

import { adminClient, functionsUrl } from '../_shared/supabase.ts'
import { deliver, type Messaging } from '../_shared/send.ts'
import { json, safeEqual } from '../_shared/http.ts'
import { contactImageUrl } from '../_shared/reviewImage.ts'

const FOLLOW_UP_GAP_DAYS = Number(Deno.env.get('FOLLOW_UP_GAP_DAYS') ?? 3)
const PER_RUN = Number(Deno.env.get('DISPATCH_PER_RUN') ?? 100)
const PER_BUSINESS = Number(Deno.env.get('DISPATCH_PER_BUSINESS') ?? 20)
const CONCURRENCY = 5

interface DueRow {
  contact_id: string
  business_id: string
  first_name: string
  email: string
  phone: string
  token: string
  requests_sent: number
  business_name: string
  review_link: string
  messaging: Messaging
  scheduling: { followUps?: number }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  const given = req.headers.get('x-cron-secret') ?? new URL(req.url).searchParams.get('secret') ?? ''
  if (!secret || !safeEqual(given, secret)) return json({ error: 'Unauthorized' }, 401)

  const admin = adminClient()
  const { data, error } = await admin.rpc('claim_due_contacts', { p_limit: PER_RUN, p_per_business: PER_BUSINESS })
  if (error) return json({ error: error.message }, 500)

  const rows = (data ?? []) as DueRow[]
  const linkBase = Deno.env.get('LINK_BASE_URL') || `${functionsUrl()}/r`
  const stats = { claimed: rows.length, sent: 0, failed: 0, finished: 0 }

  const handle = async (row: DueRow) => {
    const maxFollowUps = row.messaging?.followUpsEnabled === false ? 0 : Number(row.scheduling?.followUps ?? 2)
    const kind = row.requests_sent === 0 ? 'initial' : 'follow_up'

    // Nothing left to send (follow-ups turned down since it was scheduled)
    if (kind === 'follow_up' && row.requests_sent > maxFollowUps) {
      await admin.from('contacts').update({ next_send_at: null }).eq('id', row.contact_id)
      stats.finished++
      return
    }

    const result = await deliver({
      admin,
      businessId: row.business_id,
      contactId: row.contact_id,
      kind,
      firstName: row.first_name,
      email: row.email,
      phone: row.phone,
      businessName: row.business_name,
      messaging: row.messaging ?? {},
      link: `${linkBase}?t=${row.token}`,
      imageUrl: kind === 'initial' && row.messaging?.personalizedImage && row.messaging?.imageDataUrl ? contactImageUrl(row.token) : undefined,
    })

    const now = new Date()
    if (result.ok) {
      const sent = row.requests_sent + 1
      const next = sent <= maxFollowUps ? new Date(now.getTime() + FOLLOW_UP_GAP_DAYS * 86_400_000).toISOString() : null
      await admin
        .from('contacts')
        .update({ requests_sent: sent, last_sent_at: now.toISOString(), next_send_at: next, status: 'sent' })
        .eq('id', row.contact_id)
        .in('status', ['pending', 'sent'])
      stats.sent++
    } else {
      // No channel configured: stop. Provider error: retry in 1 hour, max 3 failed attempts per day.
      let next: string | null = null
      if (!result.noChannel) {
        const since = new Date(now.getTime() - 86_400_000).toISOString()
        const { count } = await admin
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('contact_id', row.contact_id)
          .eq('status', 'failed')
          .gte('created_at', since)
        if ((count ?? 0) < 3) next = new Date(now.getTime() + 3_600_000).toISOString()
      }
      await admin.from('contacts').update({ next_send_at: next }).eq('id', row.contact_id)
      stats.failed++
    }
  }

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(handle))
  }

  return json({ ok: true, ...stats, at: new Date().toISOString() })
})
