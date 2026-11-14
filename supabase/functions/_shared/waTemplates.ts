// supabase/functions/_shared/waTemplates.ts
// Turns a client's Custom Message into a WhatsApp template, submits it to Meta and tracks approval.
// Only needs the WABA ID + token. Photo (image-header) templates are submitted too: the app ID needed for
// Meta's sample-photo upload is read from the access token itself, so nobody has to enter it.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type TemplateKind = 'initial' | 'initial_image' | 'followup' | 'followup_image'
export type ParamKey = 'first_name' | 'review_link'

const env = (k: string) => Deno.env.get(k) ?? ''
const EXAMPLES: Record<ParamKey, string> = { first_name: 'Priya', review_link: 'https://g.page/r/example/review' }
const SAMPLE_PHOTO_URL = () => env('DEFAULT_REVIEW_IMAGE_URL') || 'https://local-octo.vercel.app/default-personal.jpg'

/** The 4 standard templates: {{1}} first name, {{2}} business name, {{3}} review link (same order as send.ts). */
export const STANDARD_TEMPLATES: Array<{ kind: TemplateKind; col: string; key: string; def: string; body: string }> = [
  { kind: 'initial', col: 'whatsapp_template_initial', key: 'WHATSAPP_TEMPLATE_INITIAL', def: 'review_request', body: 'Hi {{1}}, thanks for choosing {{2}}! Would you mind taking a moment to leave us a Google review? {{3}} Thank you!' },
  { kind: 'initial_image', col: 'whatsapp_template_initial_image', key: 'WHATSAPP_TEMPLATE_INITIAL_IMAGE', def: 'review_request_image', body: 'Hi {{1}}, thanks for choosing {{2}}! Would you mind taking a moment to leave us a Google review? {{3}} Thank you!' },
  { kind: 'followup', col: 'whatsapp_template_followup', key: 'WHATSAPP_TEMPLATE_FOLLOWUP', def: 'review_followup', body: 'Hi {{1}}, just a quick reminder from {{2}} — your feedback means a lot to us! {{3}} Thank you!' },
  { kind: 'followup_image', col: 'whatsapp_template_followup_image', key: 'WHATSAPP_TEMPLATE_FOLLOWUP_IMAGE', def: 'review_followup_image', body: 'Hi {{1}}, just a quick reminder from {{2}} — your feedback means a lot to us! {{3}} Thank you!' },
]
export const STANDARD_EXAMPLE = ['Priya', 'Sharma Dental Clinic', 'https://g.page/r/example/review']

export interface MetaConfig {
  wabaId: string
  token: string
  version: string
  lang: string
}

export async function metaConfig(admin: SupabaseClient, businessId: string): Promise<MetaConfig> {
  const { data: row } = await admin.from('business_channels').select('*').eq('business_id', businessId).maybeSingle()
  return {
    wabaId: (row?.whatsapp_waba_id as string) || env('WHATSAPP_WABA_ID'),
    token: (row?.whatsapp_access_token as string) || env('WHATSAPP_ACCESS_TOKEN'),
    version: env('WHATSAPP_API_VERSION') || 'v23.0',
    lang: (row?.whatsapp_template_lang as string) || env('WHATSAPP_TEMPLATE_LANG') || 'en',
  }
}

/**
 * {first_name} and {review_link} become {{1}}, {{2}}… (in order of appearance).
 * {business_name} and {owner_name} are written in as fixed text.
 * Meta rejects bodies that start or end with a variable, so a short greeting / sign-off is added when needed.
 */
export function buildTemplateBody(source: string, vars: { businessName: string; ownerName: string }) {
  let text = source
    .replace(/\{business_name\}/g, vars.businessName)
    .replace(/\{owner_name\}/g, vars.ownerName || vars.businessName)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const params: ParamKey[] = []
  text = text.replace(/\{(first_name|review_link)\}/g, (_m, key: ParamKey) => {
    params.push(key)
    return `{{${params.length}}}`
  })

  if (/^\{\{\d+\}\}/.test(text)) text = `Hi ${text}`
  if (/\{\{\d+\}\}[\s.!?,]*$/.test(text)) text = `${text} Thank you!`
  // Two variables with nothing between them are rejected too
  text = text.replace(/(\{\{\d+\}\})\s*(\{\{\d+\}\})/g, '$1 - $2')

  return { body: text, params, example: params.map((p) => EXAMPLES[p]) }
}

export function templateName(businessId: string, kind: TemplateKind): string {
  return `lo_${businessId.replace(/-/g, '').slice(0, 10)}_${kind}_${Date.now().toString(36)}`
}

export function mapStatus(meta: string | undefined): string {
  switch ((meta ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'approved'
    case 'REJECTED':
      return 'rejected'
    case 'PAUSED':
      return 'paused'
    case 'DISABLED':
      return 'disabled'
    default:
      return 'pending' // PENDING, IN_APPEAL, LIMIT_EXCEEDED…
  }
}

async function graph(cfg: MetaConfig, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://graph.facebook.com/${cfg.version}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.token}`, ...(init.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = body?.error
    throw new Error(e?.error_user_msg || e?.message || `Meta HTTP ${res.status}`)
  }
  return body
}

/** The Meta app the access token belongs to (needed only for the sample-photo upload). */
async function appIdFromToken(cfg: MetaConfig): Promise<string> {
  if (env('WHATSAPP_APP_ID')) return env('WHATSAPP_APP_ID')
  try {
    const app = await graph(cfg, 'app?fields=id')
    if (app?.id) return String(app.id)
  } catch {
    // fall through to debug_token
  }
  const dbg = await graph(cfg, `debug_token?input_token=${encodeURIComponent(cfg.token)}`)
  const id = dbg?.data?.app_id
  if (!id) throw new Error('Could not read the Meta app from the access token')
  return String(id)
}

/**
 * Uploads the sample photo Meta wants to see on an image-header template and returns its handle.
 * Meta's resumable upload: POST /{app-id}/uploads → session id, then POST the bytes to the session.
 */
export async function uploadSamplePhoto(cfg: MetaConfig): Promise<string> {
  const appId = await appIdFromToken(cfg)
  const img = await fetch(SAMPLE_PHOTO_URL())
  if (!img.ok) throw new Error(`Could not load the sample photo (${img.status})`)
  const bytes = new Uint8Array(await img.arrayBuffer())
  const type = img.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
  const ext = type === 'image/png' ? 'png' : 'jpg'
  const session = await graph(cfg, `${appId}/uploads?file_name=sample.${ext}&file_length=${bytes.length}&file_type=${encodeURIComponent(type)}`, { method: 'POST' })
  if (!session?.id) throw new Error('Meta did not start the photo upload')
  const res = await fetch(`https://graph.facebook.com/${cfg.version}/${session.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${cfg.token}`, file_offset: '0' },
    body: bytes,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body?.h) throw new Error(body?.error?.error_user_msg || body?.error?.message || `Photo upload failed (HTTP ${res.status})`)
  return String(body.h)
}

/** Creates a template. Pass headerHandle (from uploadSamplePhoto) for an Image-header template. */
export async function createTemplate(
  cfg: MetaConfig,
  name: string,
  body: string,
  example: string[],
  headerHandle?: string,
): Promise<{ id: string; status: string; category: string | null }> {
  const components: unknown[] = []
  if (headerHandle) components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [headerHandle] } })
  components.push({ type: 'BODY', text: body, ...(example.length ? { example: { body_text: [example] } } : {}) })
  const res = await graph(cfg, `${cfg.wabaId}/message_templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, language: cfg.lang, category: 'MARKETING', components }),
  })
  return { id: String(res.id), status: mapStatus(res.status), category: res.category ? String(res.category).toLowerCase() : 'marketing' }
}

/** Looks a template up by exact name in the WhatsApp Business Account (works for API- and hand-made ones). */
export async function findTemplateByName(
  cfg: MetaConfig,
  name: string,
): Promise<{ id: string; status: string; reason: string | null; language: string; category: string | null } | null> {
  const res = await graph(cfg, `${cfg.wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=id,name,status,rejected_reason,language,category&limit=50`)
  const hit = (res.data ?? []).find((t: { name: string; language: string }) => t.name === name && (!cfg.lang || t.language === cfg.lang))
    ?? (res.data ?? []).find((t: { name: string }) => t.name === name)
  if (!hit) return null
  const reason = hit.rejected_reason && hit.rejected_reason !== 'NONE' ? String(hit.rejected_reason) : null
  return { id: String(hit.id), status: mapStatus(hit.status), reason, language: hit.language, category: hit.category ? String(hit.category).toLowerCase() : null }
}

export interface ApprovedTemplate {
  name: string
  language: string
  params: ParamKey[]
}

/** Latest approved custom template of each kind for a business. */
export async function approvedTemplates(admin: SupabaseClient, businessId: string): Promise<Partial<Record<TemplateKind, ApprovedTemplate>>> {
  const { data } = await admin
    .from('whatsapp_templates')
    .select('kind, name, language, params')
    .eq('business_id', businessId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
  const out: Partial<Record<TemplateKind, ApprovedTemplate>> = {}
  for (const r of data ?? []) {
    const kind = r.kind as TemplateKind
    if (!out[kind]) out[kind] = { name: r.name, language: r.language, params: (r.params ?? []) as ParamKey[] }
  }
  return out
}
