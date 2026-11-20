// supabase/functions/wa-template/index.ts
// WhatsApp templates. Body: { businessId, action, kinds? }
//  - submit:          Custom Message / Custom Follow-up → submitted to Meta as text AND photo (Image header) templates,
//                     uses the WhatsApp template fields (waMessage / waFollowUp, named waTemplateName /
//                     waFollowUpTemplateName). First message: text + photo ("_photo") versions; follow-up: text only.
//  - refresh:         "Check WhatsApp" — looks every custom template up by name and updates its status.
//  - standard:        approval status of the 3 standard templates (review_request, review_request_image, review_followup).
// Any member of the business (agency or client login) can submit and check templates.
//  - submit_standard: submits whichever of the 4 standard templates don't exist yet, then returns their status.
// Only the WABA ID + access token are needed. The app ID for the sample-photo upload is read from the token.

import { adminClient, getUser, isAgency, isMember } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'
import {
  buildTemplateBody,
  createTemplate,
  deleteTemplate,
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
  waMessage?: string
  waFollowUp?: string
  waTemplateName?: string
  waFollowUpTemplateName?: string
  /** WhatsApp category to request for the custom templates ('marketing' default, or 'utility') */
  waCategory?: 'marketing' | 'utility'
  waFollowUpCategory?: 'marketing' | 'utility'
}

/** WhatsApp template names: lowercase letters, numbers and underscores. */
const cleanName = (v?: string) => (v ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)

const COLS = 'id, business_id, kind, name, language, body, params, status, reason, category, is_default, created_at, updated_at, businesses(name)'
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

  const { businessId, action = 'refresh', kinds, templateId, standardKinds } = (await req.json().catch(() => ({}))) as {
    businessId?: string
    templateId?: string
    action?: 'submit' | 'refresh' | 'standard' | 'submit_standard' | 'delete' | 'set_default' | 'delete_standard'
    /** submit_standard / delete_standard: which standard templates (follow-up is optional, only when asked) */
    standardKinds?: TemplateKind[]
    kinds?: Array<'initial' | 'followup'>
  }
  if (!businessId) return json({ error: 'businessId is required' }, 400)
  if (!(await isMember(admin, user.id, businessId))) return json({ error: 'Not allowed' }, 403)

  const cfg = await metaConfig(admin, businessId)
  // Agency accounts work with the shared template library (every business's custom templates)
  const agency = await isAgency(admin, user.id)
  if (!cfg.wabaId || !cfg.token) return json({ error: 'WhatsApp is not connected yet (WHATSAPP_WABA_ID / WHATSAPP_ACCESS_TOKEN missing)' }, 400)

  const getPhoto = photoHandle(cfg)
  const warnings: string[] = []

  // Delete a standard template from WhatsApp (agency only) — e.g. the optional marketing follow-up
  if (action === 'delete_standard') {
    if (!agency) return json({ error: 'Only the agency can delete templates' }, 403)
    const { data: ch } = await admin.from('business_channels').select('*').eq('business_id', businessId).maybeSingle()
    for (const t of STANDARD_TEMPLATES.filter((x) => standardKinds?.includes(x.kind))) {
      const name = (ch?.[t.col] as string) || (Deno.env.get(t.key) ?? '') || t.def
      try {
        await deleteTemplate(cfg, name)
      } catch (e) {
        return json({ error: `WhatsApp could not delete ${name}: ${errText(e)}` }, 400)
      }
    }
  }

  if (action === 'standard' || action === 'submit_standard' || action === 'delete_standard') {
    const { data: ch } = await admin.from('business_channels').select('*').eq('business_id', businessId).maybeSingle()
    const env = (k: string) => Deno.env.get(k) ?? ''
    const standard = []
    for (const t of STANDARD_TEMPLATES) {
      const name = (ch?.[t.col] as string) || env(t.key) || t.def
      try {
        let found = await findTemplateByName(cfg, name)
        // The standard follow-up is optional: only submitted when asked for (the default follow-up is a custom one)
        const wanted = standardKinds?.length ? standardKinds.includes(t.kind) : t.kind !== 'followup'
        if (!found && action === 'submit_standard' && wanted) {
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

    const cat = (c?: string) => (c === 'utility' ? 'UTILITY' : 'MARKETING') as 'MARKETING' | 'UTILITY'
    const jobs: Array<{ kind: TemplateKind; source: string; name: string; category: 'MARKETING' | 'UTILITY' }> = []
    if (want.has('initial') && m.waMessage) jobs.push({ kind: 'initial', source: m.waMessage, name: cleanName(m.waTemplateName), category: cat(m.waCategory) })
    if (want.has('followup') && m.waFollowUp) jobs.push({ kind: 'followup', source: m.waFollowUp, name: cleanName(m.waFollowUpTemplateName), category: cat(m.waFollowUpCategory) })

    for (const job of jobs) {
      const built = buildTemplateBody(job.source, vars)
      const base = { business_id: businessId, language: cfg.lang, body: built.body, params: built.params }
      // First message: text + photo versions. Follow-up: text only.
      const photoKind: TemplateKind | null = job.kind === 'initial' ? 'initial_image' : null

      // Text version and photo version (same text + Image header), both submitted to Meta.
      // Names come from the business ("my_name" and "my_name_photo"); generated if none was given.
      for (const kind of photoKind ? [job.kind, photoKind] : [job.kind]) {
        const name = job.name ? `${job.name}${kind === photoKind ? '_photo' : ''}` : templateName(businessId, kind)
        try {
          if (!built.params.includes('review_link')) throw new Error('The message must include the Review Link')
          const header = kind === photoKind ? await getPhoto() : undefined
          const created = await createTemplate(cfg, name, built.body, built.example, header, job.category)
          await admin.from('whatsapp_templates').insert({ ...base, kind, name, status: created.status, category: created.category, meta_template_id: created.id })
        } catch (e) {
          await admin.from('whatsapp_templates').insert({ ...base, kind, name, status: 'failed', reason: errText(e) })
        }
      }
    }
  }

  // Delete a custom template (this business's own only): from WhatsApp first, then from the app
  if (action === 'delete') {
    let q = admin.from('whatsapp_templates').select('id, name, meta_template_id').eq('id', templateId ?? '')
    if (!agency) q = q.eq('business_id', businessId) // clients: only their own business's templates
    const { data: t } = await q.maybeSingle()
    if (!t) return json({ error: 'Template not found' }, 404)
    // Only delete in Meta if no other business row uses the same template name (the WhatsApp account is shared)
    const { count } = await admin.from('whatsapp_templates').select('id', { count: 'exact', head: true }).eq('name', t.name).neq('id', t.id)
    try {
      if (!count) await deleteTemplate(cfg, t.name, t.meta_template_id)
    } catch (e) {
      return json({ error: `WhatsApp could not delete it: ${errText(e)}` }, 400)
    }
    await admin.from('whatsapp_templates').delete().eq('id', t.id)
  }

  // Make one follow-up the default for all businesses (agency only); pressing it again on the default turns it off
  if (action === 'set_default') {
    if (!agency) return json({ error: 'Only the agency can set the default' }, 403)
    const { data: t } = await admin.from('whatsapp_templates').select('id, kind, is_default').eq('id', templateId ?? '').maybeSingle()
    if (!t) return json({ error: 'Template not found' }, 404)
    await admin.from('whatsapp_templates').update({ is_default: false }).eq('kind', t.kind).neq('id', t.id)
    await admin.from('whatsapp_templates').update({ is_default: !t.is_default }).eq('id', t.id)
  }

  // Check every template that isn't final yet (also runs right after submit)
  let openQ = admin
    .from('whatsapp_templates')
    .select('id, name')
    .or('status.in.(not_created,pending,paused),and(status.eq.approved,category.is.null)')
  if (!agency) openQ = openQ.eq('business_id', businessId)
  const { data: open } = await openQ
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

  let listQ = admin.from('whatsapp_templates').select(COLS).order('created_at', { ascending: false }).limit(agency ? 200 : 30)
  if (!agency) listQ = listQ.eq('business_id', businessId)
  const { data: rows } = await listQ
  return json({ ok: true, templates: rows ?? [], warnings: [...new Set(warnings)] })
})
