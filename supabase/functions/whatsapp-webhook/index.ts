// supabase/functions/whatsapp-webhook/index.ts
// Meta webhook for the WhatsApp number:
//  - GET  verification (hub.verify_token = WHATSAPP_VERIFY_TOKEN)
//  - POST delivery statuses -> messages.status, and STOP replies -> Do Not Contact

import { adminClient } from '../_shared/supabase.ts'
import { safeEqual } from '../_shared/http.ts'

const STOP_WORDS = /^\s*(stop|unsubscribe|cancel|opt\s?out|end|quit)\s*$/i
const STATUS_MAP: Record<string, string> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' }

async function validSignature(raw: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get('WHATSAPP_APP_SECRET')
  if (!secret) return true // signature check is skipped until the app secret is set
  if (!header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return safeEqual(hex, header.slice(7))
}

interface WaValue {
  metadata?: { phone_number_id?: string }
  statuses?: Array<{ id: string; status: string; errors?: Array<{ title?: string; message?: string }> }>
  messages?: Array<{ from: string; type: string; text?: { body?: string }; button?: { text?: string } }>
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === Deno.env.get('WHATSAPP_VERIFY_TOKEN')
    return ok ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 }) : new Response('Forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const raw = await req.text()
  if (!(await validSignature(raw, req.headers.get('x-hub-signature-256')))) return new Response('Bad signature', { status: 401 })

  let payload: { entry?: Array<{ changes?: Array<{ value?: WaValue }> }> }
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response('ok', { status: 200 })
  }

  const admin = adminClient()
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {}

      for (const s of value.statuses ?? []) {
        const status = STATUS_MAP[s.status]
        if (!status) continue
        await admin
          .from('messages')
          .update({ status, error: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? null })
          .eq('provider_message_id', s.id)
      }

      for (const m of value.messages ?? []) {
        const text = m.text?.body ?? m.button?.text ?? ''
        if (!STOP_WORDS.test(text)) continue
        // If this number belongs to specific businesses, only opt out there; the shared platform number opts out everywhere.
        let query = admin
          .from('contacts')
          .update({ do_not_contact: true, status: 'stopped', next_send_at: null, stopped_at: new Date().toISOString() })
          .eq('phone', m.from)
        const phoneId = value.metadata?.phone_number_id
        if (phoneId) {
          const { data: owners } = await admin.from('business_channels').select('business_id').eq('whatsapp_phone_number_id', phoneId)
          if (owners && owners.length) query = query.in('business_id', owners.map((o) => o.business_id))
        }
        await query
      }
    }
  }
  return new Response('ok', { status: 200 })
})
