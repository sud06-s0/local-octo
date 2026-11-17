// supabase/functions/wa-template/index.ts
// WhatsApp templates (the standard ones only; WhatsApp sends nothing else). Body: { businessId, action }
//  - standard:        approval status of review_request, review_request_image, review_followup.
//  - submit_standard: submits whichever of them don't exist yet (agency accounts only), then returns their status.
// Only the WABA ID + access token are needed. The app ID for the sample-photo upload is read from the token.

import { adminClient, getUser, isAgency, isMember } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'
import { createTemplate, findTemplateByName, metaConfig, STANDARD_EXAMPLE, STANDARD_TEMPLATES, uploadSamplePhoto, type MetaConfig } from '../_shared/waTemplates.ts'

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

  const { businessId, action = 'standard' } = (await req.json().catch(() => ({}))) as {
    businessId?: string
    action?: 'standard' | 'submit_standard'
  }
  if (!businessId) return json({ error: 'businessId is required' }, 400)
  if (!(await isMember(admin, user.id, businessId))) return json({ error: 'Not allowed' }, 403)

  const cfg = await metaConfig(admin, businessId)
  if (!cfg.wabaId || !cfg.token) return json({ error: 'WhatsApp is not connected yet (WHATSAPP_WABA_ID / WHATSAPP_ACCESS_TOKEN missing)' }, 400)

  if (action === 'submit_standard' && !(await isAgency(admin, user.id))) {
    return json({ error: 'Only your agency can submit WhatsApp templates' }, 403)
  }

  const getPhoto = photoHandle(cfg)

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
})
