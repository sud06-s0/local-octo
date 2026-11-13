// supabase/functions/_shared/send.ts
// Message delivery: WhatsApp (Meta Cloud API), SMS and email (MSG91).
// Every provider needs PRE-APPROVED templates — see SETUP.md for the exact template text.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { approvedTemplates, type ParamKey } from './waTemplates.ts'

type Kind = 'initial' | 'follow_up' | 'test'
type Channel = 'whatsapp' | 'sms' | 'email'

export interface Messaging {
  mode?: 'smart' | 'custom'
  ownerFirstName?: string
  personalizedImage?: boolean
  imageDataUrl?: string | null
  businessName?: string
  customMessage?: string
  customFollowUp?: string
  followUpsEnabled?: boolean
}

interface Channels {
  whatsapp: null | {
    phoneNumberId: string
    token: string
    initial: string
    initialImage: string
    followUp: string
    followUpImage: string
    lang: string
    version: string
  }
  sms: null | { authKey: string; initial: string; followUp: string }
  email: null | { authKey: string; from: string; fromName: string; domain: string; templateId: string }
}

interface SendResult {
  ok: boolean
  id?: string
  error?: string
}

const env = (k: string) => Deno.env.get(k) ?? ''

/** Per-business overrides from business_channels, falling back to platform secrets. */
export async function loadChannels(admin: SupabaseClient, businessId: string): Promise<Channels> {
  const { data: row } = await admin.from('business_channels').select('*').eq('business_id', businessId).maybeSingle()
  const pick = (col: string, key: string, fallback = '') => (row?.[col] as string | null) || env(key) || fallback

  const waId = pick('whatsapp_phone_number_id', 'WHATSAPP_PHONE_NUMBER_ID')
  const waToken = pick('whatsapp_access_token', 'WHATSAPP_ACCESS_TOKEN')
  const msgKey = env('MSG91_AUTH_KEY')
  const smsInitial = pick('msg91_sms_template_initial', 'MSG91_SMS_TEMPLATE_INITIAL')
  const emailTemplate = pick('msg91_email_template_id', 'MSG91_EMAIL_TEMPLATE_ID')
  const emailFrom = pick('email_from', 'MSG91_EMAIL_FROM')
  const emailDomain = pick('email_domain', 'MSG91_EMAIL_DOMAIN')

  return {
    whatsapp:
      waId && waToken
        ? {
            phoneNumberId: waId,
            token: waToken,
            initial: pick('whatsapp_template_initial', 'WHATSAPP_TEMPLATE_INITIAL', 'review_request'),
            initialImage: pick('whatsapp_template_initial_image', 'WHATSAPP_TEMPLATE_INITIAL_IMAGE', 'review_request_image'),
            followUp: pick('whatsapp_template_followup', 'WHATSAPP_TEMPLATE_FOLLOWUP', 'review_followup'),
            followUpImage: pick('whatsapp_template_followup_image', 'WHATSAPP_TEMPLATE_FOLLOWUP_IMAGE', 'review_followup_image'),
            lang: pick('whatsapp_template_lang', 'WHATSAPP_TEMPLATE_LANG', 'en'),
            version: env('WHATSAPP_API_VERSION') || 'v23.0',
          }
        : null,
    sms:
      msgKey && smsInitial
        ? { authKey: msgKey, initial: smsInitial, followUp: pick('msg91_sms_template_followup', 'MSG91_SMS_TEMPLATE_FOLLOWUP', smsInitial) }
        : null,
    email:
      msgKey && emailTemplate && emailFrom && emailDomain
        ? { authKey: msgKey, from: emailFrom, fromName: pick('email_from_name', 'MSG91_EMAIL_FROM_NAME', 'Local Octo'), domain: emailDomain, templateId: emailTemplate }
        : null,
  }
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m)
}

/** Full text used for email (WhatsApp/SMS text is fixed by their approved templates). */
export function buildText(kind: Kind, m: Messaging, firstName: string, businessName: string, link: string): string {
  const vars = { first_name: firstName, business_name: businessName, owner_name: m.ownerFirstName ?? '', review_link: link }
  if (m.mode === 'custom') {
    return fill(kind === 'follow_up' ? m.customFollowUp || m.customMessage || '' : m.customMessage || '', vars)
  }
  return kind === 'follow_up'
    ? `Hey ${firstName}, just wanted to quickly follow up. We'd really appreciate your feedback! ${link}`
    : `Hey ${firstName}, we hope you enjoyed your experience with ${businessName}! Would you mind taking a moment to leave a review? Here's the link: ${link}`
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function sendWhatsApp(
  ch: NonNullable<Channels['whatsapp']>,
  to: string,
  template: string,
  params: string[],
  headerImage?: string,
  lang?: string,
): Promise<SendResult> {
  const components: unknown[] = []
  // Image header (template must be created in Meta with Header = Image)
  if (headerImage) components.push({ type: 'header', parameters: [{ type: 'image', image: { link: headerImage } }] })
  components.push({ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) })
  const res = await fetch(`https://graph.facebook.com/${ch.version}/${ch.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ch.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: lang || ch.lang },
        components,
      },
    }),
  })
  const body = await readJson(res)
  const id = (body.messages as Array<{ id: string }> | undefined)?.[0]?.id
  if (!res.ok || !id) {
    const err = body.error as { message?: string } | undefined
    return { ok: false, error: err?.message ?? `WhatsApp HTTP ${res.status}` }
  }
  return { ok: true, id }
}

async function sendSms(ch: NonNullable<Channels['sms']>, to: string, templateId: string, vars: Record<string, string>): Promise<SendResult> {
  const res = await fetch('https://control.msg91.com/api/v5/flow', {
    method: 'POST',
    headers: { authkey: ch.authKey, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ template_id: templateId, short_url: '0', recipients: [{ mobiles: to, ...vars }] }),
  })
  const body = await readJson(res)
  if (!res.ok || body.type === 'error') return { ok: false, error: String(body.message ?? `MSG91 SMS HTTP ${res.status}`) }
  return { ok: true, id: String(body.message ?? '') }
}

async function sendEmail(ch: NonNullable<Channels['email']>, to: string, name: string, vars: Record<string, string>): Promise<SendResult> {
  const res = await fetch('https://control.msg91.com/api/v5/email/send', {
    method: 'POST',
    headers: { authkey: ch.authKey, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      recipients: [{ to: [{ email: to, name: name || to }], variables: vars }],
      from: { email: ch.from, name: ch.fromName },
      domain: ch.domain,
      template_id: ch.templateId,
    }),
  })
  const body = await readJson(res)
  if (!res.ok || body.hasError === true || body.status === 'fail') {
    return { ok: false, error: String((body.errors as unknown) ?? body.message ?? `MSG91 email HTTP ${res.status}`) }
  }
  const data = body.data as { unique_id?: string } | undefined
  return { ok: true, id: data?.unique_id ?? '' }
}

export interface DeliverInput {
  admin: SupabaseClient
  businessId: string
  contactId: string | null
  kind: Kind
  firstName: string
  email: string
  phone: string // digits with country code
  businessName: string
  messaging: Messaging
  link: string
  /** Photo with the customer's name (when Personalized Image is on) — first message and follow-ups */
  imageUrl?: string
}

export interface DeliverResult {
  ok: boolean
  channel?: Channel
  error?: string
  noChannel?: boolean
}

/**
 * Phone first (WhatsApp, then SMS as fallback), email if there is no phone or phone sending failed.
 * Every attempt is logged in `messages`.
 */
export async function deliver(input: DeliverInput): Promise<DeliverResult> {
  const ch = await loadChannels(input.admin, input.businessId)
  const isFollow = input.kind === 'follow_up'
  const text = buildText(input.kind, input.messaging, input.firstName, input.businessName, input.link)
  const attempts: Array<{ channel: Channel; recipient: string; run: () => Promise<SendResult> }> = []

  if (input.phone && ch.whatsapp) {
    const wa = ch.whatsapp
    // Default templates: {{1}} first name, {{2}} business name, {{3}} review link
    let template = isFollow ? (input.imageUrl ? wa.followUpImage : wa.followUp) : input.imageUrl ? wa.initialImage : wa.initial
    let params = [input.firstName, input.businessName, input.link]
    let header = input.imageUrl
    let lang: string | undefined

    // Custom Message mode: use the business's own approved template when there is one
    if (input.messaging.mode === 'custom') {
      const custom = await approvedTemplates(input.admin, input.businessId)
      const values: Record<ParamKey, string> = { first_name: input.firstName, review_link: input.link }
      // With a photo, only the approved photo template is used, so the customer's name is always on a photo.
      // Until it's approved, the standard photo template goes out instead.
      const pick = isFollow
        ? input.imageUrl ? custom.followup_image : custom.followup
        : input.imageUrl ? custom.initial_image : custom.initial
      if (pick) {
        template = pick.name
        lang = pick.language
        params = pick.params.map((p) => values[p] ?? '')
        header = input.imageUrl
      }
    }

    attempts.push({
      channel: 'whatsapp',
      recipient: input.phone,
      run: () => sendWhatsApp(wa, input.phone, template, params, header, lang),
    })
  }
  if (input.phone && ch.sms) {
    const sms = ch.sms
    attempts.push({
      channel: 'sms',
      recipient: input.phone,
      run: () => sendSms(sms, input.phone, isFollow ? sms.followUp : sms.initial, { name: input.firstName, business: input.businessName, link: input.link }),
    })
  }
  if (input.email && ch.email) {
    const em = ch.email
    attempts.push({
      channel: 'email',
      recipient: input.email,
      run: () =>
        sendEmail(em, input.email, input.firstName, {
          first_name: input.firstName,
          business_name: input.businessName,
          message: text,
          review_link: input.link,
          image_url: input.imageUrl ?? '',
        }),
    })
  }

  if (attempts.length === 0) return { ok: false, noChannel: true, error: 'No sending channel configured for this contact' }

  let lastError = ''
  for (const a of attempts) {
    let result: SendResult
    try {
      result = await a.run()
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    await input.admin.from('messages').insert({
      business_id: input.businessId,
      contact_id: input.contactId,
      channel: a.channel,
      kind: input.kind,
      status: result.ok ? 'sent' : 'failed',
      recipient: a.recipient,
      provider_message_id: result.id || null,
      error: result.error ?? null,
      sent_at: result.ok ? new Date().toISOString() : null,
    })
    if (result.ok) return { ok: true, channel: a.channel }
    lastError = result.error ?? 'Unknown error'
  }
  return { ok: false, error: lastError }
}
