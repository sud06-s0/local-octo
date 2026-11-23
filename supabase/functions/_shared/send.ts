// supabase/functions/_shared/send.ts
// Message delivery: WhatsApp (Meta Cloud API), SMS (MSG91) and email (Google Workspace / Gmail).
// Every provider needs PRE-APPROVED templates — see SETUP.md for the exact template text.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { approvedTemplates, defaultFollowUp, type ParamKey } from './waTemplates.ts'
import { reviewEmailHtml, sendGmail, type GmailConfig } from './email.ts'

type Kind = 'initial' | 'follow_up' | 'test'
type Channel = 'whatsapp' | 'sms' | 'email'

export interface Messaging {
  mode?: 'smart' | 'custom'
  ownerFirstName?: string
  personalizedImage?: boolean
  useTitle?: boolean
  imageDataUrl?: string | null
  businessName?: string
  customMessage?: string
  customFollowUp?: string
  /** WhatsApp: 'standard' templates, or the agency's own approved 'custom' templates */
  waMode?: 'standard' | 'custom'
  /** chosen templates from the shared library (row ids); empty = this business's own latest approved */
  waTemplateId?: string | null
  waFollowUpTemplateId?: string | null
  followUpsEnabled?: boolean
  /** Which channels each review request goes out on (set on the Messaging page). Default: WhatsApp only */
  channels?: { whatsapp?: boolean; sms?: boolean; email?: boolean }
  /** SMS timing: 'window' = only 10 AM–9 PM India time (default), 'now' = send straight away */
  smsTiming?: 'now' | 'window'
  /** Custom email template subjects; empty = default subject */
  emailSubject?: string
  emailFollowUpSubject?: string
}

/** Channels turned on for this business (WhatsApp only when nothing has been saved yet). */
export function enabledChannels(m: Messaging): Record<Channel, boolean> {
  const c = m.channels
  if (!c) return { whatsapp: true, sms: false, email: false }
  return { whatsapp: c.whatsapp === true, sms: c.sms === true, email: c.email === true }
}

interface Channels {
  whatsapp: null | {
    phoneNumberId: string
    token: string
    initial: string
    initialImage: string
    followUp: string
    lang: string
    version: string
  }
  sms: null | { authKey: string; initial: string; followUp: string }
  email: null | GmailConfig
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
  // DLT-approved MSG91 templates (lo_review_request_p / lo_review_followup_p); secrets override them
  const smsInitial = pick('msg91_sms_template_initial', 'MSG91_SMS_TEMPLATE_INITIAL', '6b02bf24e1174c82ca0e0792')
  const gmailUser = env('GMAIL_USER')
  // app passwords are shown as 4 groups of 4 letters; spaces don't belong in it
  const gmailPass = env('GMAIL_APP_PASSWORD').replace(/\s/g, '')

  return {
    whatsapp:
      waId && waToken
        ? {
            phoneNumberId: waId,
            token: waToken,
            initial: pick('whatsapp_template_initial', 'WHATSAPP_TEMPLATE_INITIAL', 'review_request'),
            initialImage: pick('whatsapp_template_initial_image', 'WHATSAPP_TEMPLATE_INITIAL_IMAGE', 'review_request_image'),
            followUp: pick('whatsapp_template_followup', 'WHATSAPP_TEMPLATE_FOLLOWUP', 'review_followup'),
            lang: pick('whatsapp_template_lang', 'WHATSAPP_TEMPLATE_LANG', 'en'),
            version: env('WHATSAPP_API_VERSION') || 'v23.0',
          }
        : null,
    sms:
      msgKey && smsInitial
        ? { authKey: msgKey, initial: smsInitial, followUp: pick('msg91_sms_template_followup', 'MSG91_SMS_TEMPLATE_FOLLOWUP', '6b02be340483eded070eb952') }
        : null,
    email: gmailUser && gmailPass ? { user: gmailUser, pass: gmailPass, from: env('GMAIL_FROM') || undefined } : null,
  }
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m)
}

/** Email subject: the custom template's subject when Custom is on and one is written, else the default. */
export function emailSubject(kind: Kind, m: Messaging, firstName: string, businessName: string): string {
  const custom = m.mode === 'custom' ? (kind === 'follow_up' ? m.emailFollowUpSubject : m.emailSubject)?.trim() : ''
  if (custom) return fill(custom, { first_name: firstName, business_name: businessName, owner_name: m.ownerFirstName ?? '' })
  return kind === 'follow_up' ? `A quick reminder from ${businessName}` : `How was your visit to ${businessName}?`
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

/**
 * SMS variables for the MSG91 templates. The DLT text is fixed:
 *   Hi ##name##, Thank you for visiting ##business##. Please share your feedback here: https://review.localocto.com/r?t=##token## - Local Octo
 * DLT allows at most 30 characters per variable. ##token## = short business name + "-" + the code from the
 * review link (contact token, or the business public key for test messages), e.g. "sirmvpu-fffb3b123db020e63e".
 * The `r` function ignores the part before the "-".
 */
export function smsVars(firstName: string, businessName: string, link: string): Record<string, string> {
  // DLT: each {#var#} holds at most 30 characters, or the SMS no longer matches the template and fails
  const cut = (v: string) => Array.from(v).slice(0, 30).join('')
  let code = ''
  try {
    const u = new URL(link)
    code = u.searchParams.get('t') || u.searchParams.get('b') || ''
  } catch {
    /* not a URL */
  }
  // short business name in front only when it fits: slug + "-" + code <= 30
  const room = 30 - code.length - 1
  const slug = room >= 3 ? businessName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, room) : ''
  return {
    name: cut(firstName),
    business: cut(businessName),
    token: cut(slug && code ? `${slug}-${code}` : code),
  }
}

/** Promotional SMS on DLT are only delivered 10 AM–9 PM India time. */
export function smsWindowOpen(now = new Date()): boolean {
  const ist = new Date(now.getTime() + 330 * 60_000)
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return mins >= 10 * 60 && mins < 21 * 60
}

async function sendSms(ch: NonNullable<Channels['sms']>, to: string, templateId: string, vars: Record<string, string>): Promise<SendResult> {
  const res = await fetch('https://control.msg91.com/api/v5/flow', {
    method: 'POST',
    headers: { authkey: ch.authKey, accept: 'application/json', 'content-type': 'application/json' },
    // MSG91 wants the country code without '+' (e.g. 919876543210); numbers are stored as +919876543210
    // Same request as MSG91's "Test DLT": sender (header) and route come from the template's ACTIVE version in MSG91.
    // Optional MSG91_SMS_ROUTE / MSG91_SMS_SENDER secrets are added only if set.
    body: JSON.stringify({
      template_id: templateId,
      short_url: '0',
      ...(env('MSG91_SMS_ROUTE') ? { route: env('MSG91_SMS_ROUTE') } : {}),
      ...(env('MSG91_SMS_SENDER') ? { sender: env('MSG91_SMS_SENDER') } : {}),
      recipients: [{ mobiles: to.replace(/\D/g, ''), ...vars }],
    }),
  })
  const body = await readJson(res)
  if (!res.ok || body.type === 'error') return { ok: false, error: String(body.message ?? `MSG91 SMS HTTP ${res.status}`) }
  return { ok: true, id: String(body.message ?? '') }
}

export interface DeliverInput {
  admin: SupabaseClient
  businessId: string
  contactId: string | null
  kind: Kind
  firstName: string
  /** 'male' | 'female' | '' — WhatsApp adds Sir / Ma'am after the first name */
  gender?: string
  email: string
  phone: string // digits with country code
  businessName: string
  messaging: Messaging
  link: string
  /** Photo with the customer's name (when Personalized Image is on) — first message and follow-ups */
  imageUrl?: string
  /** Test messages: send on this one channel only (the Messaging tab it was sent from), ignoring the on/off switches */
  only?: Channel
}

/** "Adarsh" + male -> "Adarsh Sir", "Varsha" + female -> "Varsha Ma'am", otherwise just the first name. */
export function withTitle(firstName: string, gender?: string): string {
  if (gender === 'male') return `${firstName} Sir`
  if (gender === 'female') return `${firstName} Ma'am`
  return firstName
}

export interface DeliverResult {
  ok: boolean
  channel?: Channel
  /** every channel that went out */
  channels?: Channel[]
  error?: string
  noChannel?: boolean
}

/**
 * Sends on every channel the business turned on (Messaging page): WhatsApp, SMS and/or email.
 * Test messages to an email address always go by email. Every attempt is logged in `messages`.
 */
export async function deliver(input: DeliverInput): Promise<DeliverResult> {
  const ch = await loadChannels(input.admin, input.businessId)
  const isFollow = input.kind === 'follow_up'
  const text = buildText(input.kind, input.messaging, input.firstName, input.businessName, input.link)
  const on = input.only
    ? { whatsapp: input.only === 'whatsapp', sms: input.only === 'sms', email: input.only === 'email' }
    : enabledChannels(input.messaging)
  const attempts: Array<{ channel: Channel; recipient: string; run: () => Promise<SendResult> }> = []

  if (input.phone && on.whatsapp && ch.whatsapp) {
    const wa = ch.whatsapp
    // Only approved templates go out on WhatsApp. Standard ones: {{1}} first name, {{2}} business name, {{3}} review link.
    // First message carries the personalised photo when enabled; follow-ups are text only.
    const photo = isFollow ? undefined : input.imageUrl
    let template = isFollow ? wa.followUp : photo ? wa.initialImage : wa.initial
    const waName = input.messaging.useTitle === false ? input.firstName : withTitle(input.firstName, input.gender)
    let params = [waName, input.businessName, input.link]
    const header = photo
    let lang: string | undefined

    const values: Record<ParamKey, string> = {
      first_name: waName,
      review_link: input.link,
      business_name: input.businessName,
      owner_name: input.messaging.ownerFirstName || input.businessName,
    }
    // WhatsApp custom mode: the agency's approved custom templates (otherwise the standard ones).
    // Follow-ups also use the agency's "default for all businesses" follow-up in Standard mode.
    const pick =
      input.messaging.waMode === 'custom'
        ? (await approvedTemplates(input.admin, input.businessId, { initial: input.messaging.waTemplateId, followup: input.messaging.waFollowUpTemplateId }))[
            isFollow ? 'followup' : photo ? 'initial_image' : 'initial'
          ]
        : isFollow
          ? await defaultFollowUp(input.admin)
          : undefined
    if (pick) {
      template = pick.name
      lang = pick.language
      params = pick.params.map((p) => values[p] ?? '')
    }

    attempts.push({
      channel: 'whatsapp',
      recipient: input.phone,
      run: () => sendWhatsApp(wa, input.phone, template, params, header, lang),
    })
  }
  if (input.phone && on.sms && ch.sms) {
    const sms = ch.sms
    attempts.push({
      channel: 'sms',
      recipient: input.phone,
      run: async () =>
        input.messaging.smsTiming !== 'now' && !smsWindowOpen()
          ? { ok: false, error: 'SMS not sent: promotional SMS only go out 10 AM–9 PM' }
          : await sendSms(sms, input.phone, isFollow ? sms.followUp : sms.initial, smsVars(input.messaging.useTitle === false ? input.firstName : withTitle(input.firstName, input.gender), input.businessName, input.link)),
    })
  }
  if (input.email && on.email && ch.email) {
    const em = ch.email
    attempts.push({
      channel: 'email',
      recipient: input.email,
      run: () =>
        sendGmail(em, {
          to: input.email,
          fromName: input.businessName,
          subject: emailSubject(input.kind, input.messaging, input.firstName, input.businessName),
          text,
          // Emails never carry the photo (WhatsApp only)
          html: reviewEmailHtml({ businessName: input.businessName, message: text, link: input.link }),
        }),
    })
  }

  if (attempts.length === 0) {
    const missing = [
      on.whatsapp && input.phone && !ch.whatsapp && 'WhatsApp',
      on.sms && input.phone && !ch.sms && 'SMS',
      on.email && input.email && !ch.email && 'Email',
    ].filter(Boolean)
    if (input.only === 'email' && !input.email) return { ok: false, noChannel: true, error: 'Enter an email address to test email' }
    if (input.only && input.only !== 'email' && !input.phone) return { ok: false, noChannel: true, error: 'Enter a phone number to test WhatsApp or SMS' }
    return {
      ok: false,
      noChannel: true,
      error: missing.length
        ? `${missing.join(', ')} not connected yet`
        : 'No channel turned on for this contact (Messaging page: WhatsApp / SMS / Email)',
    }
  }

  let lastError = ''
  const sentOn: Channel[] = []
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
    if (result.ok) sentOn.push(a.channel)
    else lastError = `${a.channel === 'whatsapp' ? 'WhatsApp' : a.channel === 'sms' ? 'SMS' : 'Email'}: ${result.error ?? 'Unknown error'}`
  }
  if (sentOn.length) return { ok: true, channel: sentOn[0], channels: sentOn, error: lastError || undefined }
  return { ok: false, error: lastError }
}
