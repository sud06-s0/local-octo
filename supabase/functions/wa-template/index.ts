// supabase/functions/wa-template/index.ts
// WhatsApp templates. Body: { businessId, action, kinds? }
//  - submit:          Custom Message / Custom Follow-up → submitted to Meta as text AND photo (Image header) templates,
//                     named by the business (customTemplateName / customFollowUpTemplateName, photo version + "_photo").
//  - refresh:         "Check WhatsApp" — looks every custom template up by name and updates its status.
//  - standard:        approval status of the 4 standard templates (review_request, review_request_image, review_followup, review_followup_image).
//  - submit_standard: submits whichever of the 4 standard templates don't exist yet, then returns their status.
// Only the WABA ID + access token are needed. The app ID for the sample-photo upload is read from the token.

import { adminClient, getUser, isMember } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'
import {
  buildTemplateBody,
  createTemplate,
  findTemplateByName,
  metaConfig,
  STANDARD_EXAMPLE,
  STANDARD_TEMPLATES,
  templateName,
  uploadSamplePhoto,
  type MetaConfig,
  type TemplateKind,
} from '../_shared/waTemplates.ts'

interface Messaging {
  businessName?: string
  ownerFirstName?: string
  customMessage?: string
  customFollowUp?: string
  customTemplateName?: string
  customFollowUpTemplateName?: string
}

/** WhatsApp template names: lowercase letters, numbers and underscores. */
const cleanName = (v?: string) => (v ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)

const COLS = 'id, kind, name, language, body, status, reason, category, created_at, updated_at'
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** One sample-photo upload per request, shared by every photo template submitted in it. */
function photoHandle(cfg: MetaConfig) {
  let p: Promise<string> | null = null
  return () => (p ??= uploadSamplePhoto(cfg))
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const admin = adminClient()
  const user = await getUser(req, admin)
  if (!user) return json({ error: 'Sign in required' }, 401)

  const { businessId, action = 'refresh', kinds } = (await req.json().catch(() => ({}))) as {
    businessId?: string
    action?: 'submit' | 'refresh' | 'standard' | 'submit_standard'
    kinds?: Array<'initial' | 'followup'>
  }
  if (!businessId) return json({ error: 'businessId is required' }, 400)
  if (!(await isMember(admin, user.id, businessId))) return json({ error: 'Not allowed' }, 403)

  const cfg = await metaConfig(admin, businessId)
  if (!cfg.wabaId || !cfg.token) return json({ error: 'WhatsApp is not connected yet (WHATSAPP_WABA_ID / WHATSAPP_ACCESS_TOKEN missing)' }, 400)

  const getPhoto = photoHandle(cfg)
  const warnings: string[] = []

  if (action === 'standard' || action === 'submit_standard') {
    const { data: ch } = await admin.from('business_channels').select('*').eq('business_id', businessId).maybeSingle()
    const env = (k: string) => Deno.env.get(k) ?? ''
    const standard = []
    for (const t of STANDARD_TEMPLATES) {
      const name = (ch?.[t.col] as string) || env(t.key) || t.def
      try {
        let found = await findTemplateByName(cfg, name)
        if (!found && action === 'submit_standard') {
          const header = t.kind.endsWith('_image') ? await getPhoto() : undefined
          const created = await createTemplate(cfg, name, t.body, STANDARD_EXAMPLE, header)
          found = { id: created.id, status: created.status, reason: null, language: cfg.lang, category: created.category }
        }
        standard.push({ kind: t.kind, name, status: found ? found.status : 'not_created', reason: found?.reason ?? null, category: found?.category ?? null })
      } catch (e) {
        standard.push({ kind: t.kind, name, status: 'failed', reason: errText(e), category: null })
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

    const jobs: Array<{ kind: TemplateKind; source: string; name: string }> = []
    if (want.has('initial') && m.customMessage) jobs.push({ kind: 'initial', source: m.customMessage, name: cleanName(m.customTemplateName) })
    if (want.has('followup') && m.customFollowUp) jobs.push({ kind: 'followup', source: m.customFollowUp, name: cleanName(m.customFollowUpTemplateName) })

    for (const job of jobs) {
      const built = buildTemplateBody(job.source, vars)
      const base = { business_id: businessId, language: cfg.lang, body: built.body, params: built.params }
      const photoKind: TemplateKind = job.kind === 'initial' ? 'initial_image' : 'followup_image'

      // Text version and photo version (same text + Image header), both submitted to Meta.
      // Names come from the business ("my_name" and "my_name_photo"); generated if none was given.
      for (const kind of [job.kind, photoKind]) {
        const name = job.name ? `${job.name}${kind === photoKind ? '_photo' : ''}` : templateName(businessId, kind)
        try {
          if (!built.params.includes('review_link')) throw new Error('The message must include the Review Link')
          const header = kind === photoKind ? await getPhoto() : undefined
          const created = await createTemplate(cfg, name, built.body, built.example, header)
          await admin.from('whatsapp_templates').insert({ ...base, kind, name, status: created.status, category: created.category, meta_template_id: created.id })
        } catch (e) {
          await admin.from('whatsapp_templates').insert({ ...base, kind, name, status: 'failed', reason: errText(e) })
        }
      }
    }
  }

  // Check every template that isn't final yet (also runs right after submit)
  const { data: open } = await admin
    .from('whatsapp_templates')
    .select('id, name')
    .eq('business_id', businessId)
    .or('status.in.(not_created,pending,paused),and(status.eq.approved,category.is.null)')
  for (const t of open ?? []) {
    try {
      const found = await findTemplateByName(cfg, t.name)
      if (found) {
        await admin.from('whatsapp_templates').update({ status: found.status, reason: found.reason, meta_template_id: found.id, language: found.language, category: found.category }).eq('id', t.id)
      }
    } catch (e) {
      warnings.push(errText(e))
    }
  }

  const { data: rows } = await admin.from('whatsapp_templates').select(COLS).eq('business_id', businessId).order('created_at', { ascending: false }).limit(30)
  return json({ ok: true, templates: rows ?? [], warnings: [...new Set(warnings)] })
})
