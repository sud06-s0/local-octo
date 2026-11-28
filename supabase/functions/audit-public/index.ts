// supabase/functions/audit-public/index.ts
// Public audit report page data: GET ?t=<share_token> -> { createdAt, report }. No login (the token is the key).

import { adminClient } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'GET') return json({ error: 'Use GET' }, 405)

  const token = new URL(req.url).searchParams.get('t') ?? ''
  if (!/^[a-f0-9]{24}$/.test(token)) return json({ error: 'Report not found' }, 404)

  const { data } = await adminClient().from('business_audits').select('created_at, report').eq('share_token', token).maybeSingle()
  if (!data) return json({ error: 'Report not found' }, 404)
  // The saved place-ID lists are only for the drilldown function; leave them out of the page data
  const report = data.report as { keywords?: Record<string, unknown>[] }
  const keywords = (report.keywords ?? []).map(({ ids: _ids, ...k }) => k)
  return json({ createdAt: data.created_at, report: { ...report, keywords } }, 200, { 'Cache-Control': 'public, max-age=300' })
})
