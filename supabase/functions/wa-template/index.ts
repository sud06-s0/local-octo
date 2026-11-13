// supabase/functions/wa-template/index.ts
// Custom Messages on WhatsApp. Body: { businessId, action: 'submit' | 'refresh' | 'standard', kinds?: ('initial' | 'followup')[] }
//  - submit:  text versions are submitted to Meta automatically (WABA ID + token only, no App ID).
//             The photo version is listed as 'not_created' with the exact name + text to create in WhatsApp Manager.
//  - refresh: "Check WhatsApp" — looks every template up by name in the WhatsApp Business Account and updates its status.
//  - standard: approval status of the 4 standard templates (review_request, review_request_image, review_followup, review_followup_image).

import { adminClient, getUser, isMember } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'
import { buildTemplateBody, createTemplate, findTemplateByName, metaConfig, templateName, type TemplateKind } from '../_shared/waTemplates.ts'

interface Messaging {
  businessName?: string
  ownerFirstName?: string
  customMessage?: string
  customFollowUp?: string
}

const COLS = 'id, kind, name, language, body, status, reason, created_at, updated_at'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const admin = adminClient()
  const user = await getUser(req, admin)
  if (!user) return json({ error: 'Sign in required' }, 401)

  const { businessId, action = 'refresh', kinds } = (await req.json().catch(() => ({}))) as {
    businessId?: string
    action?: 'submit' | 'refresh' | 'standard'
    kinds?: Array<'initial' | 'followup'>
  }
  if (!businessId) return json({ error: 'businessId is required' }, 400)
  if (!(await isMember(admin, user.id, businessId))) return json({ error: 'Not allowed' }, 403)

  const cfg = await metaConfig(admin, businessId)
  if (!cfg.wabaId || !cfg.token) return json({ error: 'WhatsApp is not connected yet (WHATSAPP_WABA_ID / WHATSAPP_ACCESS_TOKEN missing)' }, 400)

  const warnings: string[] = []

  if (action === 'standard') {
    const { data: ch } = await admin.from('business_channels').select('*').eq('business_id', businessId).maybeSingle()
    const env = (k: string) => Deno.env.get(k) ?? ''
    const list: Array<{ kind: TemplateKind; col: string; key: string; def: string }> = [
      { kind: 'initial', col: 'whatsapp_template_initial', key: 'WHATSAPP_TEMPLATE_INITIAL', def: 'review_request' },
      { kind: 'initial_image', col: 'whatsapp_template_initial_image', key: 'WHATSAPP_TEMPLATE_INITIAL_IMAGE', def: 'review_request_image' },
      { kind: 'followup', col: 'whatsapp_template_followup', key: 'WHATSAPP_TEMPLATE_FOLLOWUP', def: 'review_followup' },
      { kind: 'followup_image', col: 'whatsapp_template_followup_image', key: 'WHATSAPP_TEMPLATE_FOLLOWUP_IMAGE', def: 'review_followup_image' },
    ]
    const standard = []
    for (const t of list) {
      const name = (ch?.[t.col] as string) || env(t.key) || t.def
      try {
        const found = await findTemplateByName(cfg, name)
        standard.push({ kind: t.kind, name, status: found ? found.status : 'not_created', reason: found?.reason ?? null })
      } catch (e) {
        standard.push({ kind: t.kind, name, status: 'failed', reason: e instanceof Error ? e.message : String(e) })
      }
    }
    return json({ ok: true, standard })
  }

  if (action === 'submit') {
    const { data: b } = await admin.from('businesses').select('name, messaging').eq('id', businessId).single()
    if (!b) return json({ error: 'Business not found' }, 404)
    const m = (b.messaging ?? {}) as Messaging
    const vars = { businessName: m.businessName || b.name, ownerName: m.ownerFirstName || '' }
    const want = new Set(kinds?.length ? kinds : ['initial', 'followup'])

    const jobs: Array<{ kind: TemplateKind; source: string }> = []
    if (want.has('initial') && m.customMessage) jobs.push({ kind: 'initial', source: m.customMessage })
    if (want.has('followup') && m.customFollowUp) jobs.push({ kind: 'followup', source: m.customFollowUp })

    for (const job of jobs) {
      const built = buildTemplateBody(job.source, vars)
      const base = { business_id: businessId, language: cfg.lang, body: built.body, params: built.params }

      // Text version: submitted automatically
      const name = templateName(businessId, job.kind)
      try {
        if (!built.params.includes('review_link')) throw new Error('The message must include the Review Link')
        const created = await createTemplate(cfg, name, built.body, built.example)
        await admin.from('whatsapp_templates').insert({ ...base, kind: job.kind, name, status: created.status, meta_template_id: created.id })
      } catch (e) {
        await admin.from('whatsapp_templates').insert({ ...base, kind: job.kind, name, status: 'failed', reason: e instanceof Error ? e.message : String(e) })
      }

      // Photo version: created by hand in WhatsApp Manager (same text + Image header), tracked here by name
      const photoKind: TemplateKind = job.kind === 'initial' ? 'initial_image' : 'followup_image'
      await admin.from('whatsapp_templates').insert({ ...base, kind: photoKind, name: templateName(businessId, photoKind), status: 'not_created' })
    }
  }

  // Check every template that isn't final yet (also runs right after submit)
  const { data: open } = await admin
    .from('whatsapp_templates')
    .select('id, name')
    .eq('business_id', businessId)
    .in('status', ['not_created', 'pending', 'paused'])
  for (const t of open ?? []) {
    try {
      const found = await findTemplateByName(cfg, t.name)
      if (found) {
        await admin.from('whatsapp_templates').update({ status: found.status, reason: found.reason, meta_template_id: found.id, language: found.language }).eq('id', t.id)
      }
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e))
    }
  }

  const { data: rows } = await admin.from('whatsapp_templates').select(COLS).eq('business_id', businessId).order('created_at', { ascending: false }).limit(30)
  return json({ ok: true, templates: rows ?? [], warnings: [...new Set(warnings)] })
})
