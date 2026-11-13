// supabase/functions/wa-template/index.ts
// Submits a business's Custom Message to Meta as WhatsApp templates, and refreshes their approval status.
// Body: { businessId, action: 'submit' | 'refresh', kinds?: ('initial' | 'followup')[] }
// Needs secrets: WHATSAPP_WABA_ID, WHATSAPP_ACCESS_TOKEN (whatsapp_business_management), WHATSAPP_APP_ID (photo template).

import { adminClient, getUser, isMember } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'
import { renderReviewImage } from '../_shared/reviewImage.ts'
import {
  buildTemplateBody,
  createTemplate,
  fetchTemplateStatus,
  metaConfig,
  templateName,
  uploadSampleImage,
  type TemplateKind,
} from '../_shared/waTemplates.ts'

interface Messaging {
  businessName?: string
  ownerFirstName?: string
  customMessage?: string
  customFollowUp?: string
  imageDataUrl?: string | null
}

const COLS = 'id, kind, name, body, status, reason, created_at, updated_at'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const admin = adminClient()
  const user = await getUser(req, admin)
  if (!user) return json({ error: 'Sign in required' }, 401)

  const { businessId, action = 'refresh', kinds } = (await req.json().catch(() => ({}))) as {
    businessId?: string
    action?: 'submit' | 'refresh'
    kinds?: Array<'initial' | 'followup'>
  }
  if (!businessId) return json({ error: 'businessId is required' }, 400)
  if (!(await isMember(admin, user.id, businessId))) return json({ error: 'Not allowed' }, 403)

  const cfg = await metaConfig(admin, businessId)
  if (!cfg.wabaId || !cfg.token) return json({ error: 'WhatsApp is not connected yet (WHATSAPP_WABA_ID / WHATSAPP_ACCESS_TOKEN missing)' }, 400)

  const warnings: string[] = []

  if (action === 'submit') {
    const { data: b } = await admin.from('businesses').select('name, messaging').eq('id', businessId).single()
    if (!b) return json({ error: 'Business not found' }, 404)
    const m = (b.messaging ?? {}) as Messaging
    const vars = { businessName: m.businessName || b.name, ownerName: m.ownerFirstName || '' }
    const want = new Set(kinds?.length ? kinds : ['initial', 'followup'])

    const jobs: Array<{ kind: TemplateKind; source: string; image: boolean }> = []
    if (want.has('initial') && m.customMessage) {
      jobs.push({ kind: 'initial', source: m.customMessage, image: false })
      if (cfg.appId) jobs.push({ kind: 'initial_image', source: m.customMessage, image: true })
      else warnings.push('Photo version not submitted: add the WHATSAPP_APP_ID secret.')
    }
    if (want.has('followup') && m.customFollowUp) jobs.push({ kind: 'followup', source: m.customFollowUp, image: false })

    let headerHandle: string | undefined
    for (const job of jobs) {
      const built = buildTemplateBody(job.source, vars)
      const name = templateName(businessId, job.kind)
      const row = { business_id: businessId, kind: job.kind, name, language: cfg.lang, body: built.body, params: built.params }
      try {
        if (!built.params.includes('review_link')) throw new Error('The message must include the Review Link')
        if (job.image && !headerHandle) headerHandle = await uploadSampleImage(cfg, await renderReviewImage(m.imageDataUrl ?? null, 'Priya'))
        const created = await createTemplate(cfg, name, built.body, built.example, job.image ? headerHandle : undefined)
        await admin.from('whatsapp_templates').insert({ ...row, status: created.status, meta_template_id: created.id })
      } catch (e) {
        await admin.from('whatsapp_templates').insert({ ...row, status: 'failed', reason: e instanceof Error ? e.message : String(e) })
      }
    }
  } else {
    // refresh: ask Meta for the latest status of anything still pending
    const { data: pending } = await admin
      .from('whatsapp_templates')
      .select('id, meta_template_id')
      .eq('business_id', businessId)
      .eq('status', 'pending')
      .not('meta_template_id', 'is', null)
    for (const t of pending ?? []) {
      try {
        const s = await fetchTemplateStatus(cfg, t.meta_template_id as string)
        await admin.from('whatsapp_templates').update({ status: s.status, reason: s.reason }).eq('id', t.id)
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : String(e))
      }
    }
  }

  const { data: rows } = await admin.from('whatsapp_templates').select(COLS).eq('business_id', businessId).order('created_at', { ascending: false }).limit(30)
  return json({ ok: true, templates: rows ?? [], warnings })
})
