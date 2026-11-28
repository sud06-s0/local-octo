// supabase/functions/audit-drill/index.ts
// Competition Drilldown for one heatmap dot: the top 20 businesses (name, rating, reviews) at that point for that keyword,
// plus the business's own rank there (yourRank, 21 = not in the top 20).
// GET ?t=<share_token>&k=<keyword index>&i=<point index>. No login (the report's share token is the key).
//
// The list is shown in the SAME order the audit saw (the place IDs saved with the report), so the dot and the list
// always agree. Names/ratings come from one Google Text Search (Enterprise) at that point; any business from the saved
// list that this search doesn't return is looked up by ID (Place Details). Done once per dot, then served from audit_drilldowns.
// Reports saved before IDs were stored fall back to the live search order.
// Secret: GOOGLE_PLACES_API_KEY.

import { adminClient } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const VERSION = 3 // bump to ignore older cached results

interface Info {
  name: string
  rating: number | null
  reviews: number | null
}

function gridPoint(lat: number, lng: number, size: number, stepKm: number, i: number) {
  const dLat = stepKm / 111.32
  const dLng = stepKm / (111.32 * Math.cos((lat * Math.PI) / 180))
  const half = (size - 1) / 2
  const row = Math.floor(i / size)
  const col = i % size
  return { lat: lat + (half - row) * dLat, lng: lng + (col - half) * dLng }
}

const info = (p: Any): Info => ({ name: p.displayName?.text ?? '', rating: p.rating ?? null, reviews: p.userRatingCount ?? null })

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'GET') return json({ error: 'Use GET' }, 405)

  const q = new URL(req.url).searchParams
  const token = q.get('t') ?? ''
  const k = Number(q.get('k'))
  const i = Number(q.get('i'))
  if (!/^[a-f0-9]{24}$/.test(token) || !Number.isInteger(k) || !Number.isInteger(i) || k < 0 || i < 0) return json({ error: 'Bad request' }, 400)

  const admin = adminClient()
  const { data: audit } = await admin.from('business_audits').select('id, business_id, report').eq('share_token', token).maybeSingle()
  if (!audit) return json({ error: 'Report not found' }, 404)

  const report = audit.report as Any
  const kw = report?.keywords?.[k]
  // Grid centre: the chosen audit centre (older reports: the business location)
  const lat = report?.center?.lat ?? report?.business?.lat
  const lng = report?.center?.lng ?? report?.business?.lng
  const size = kw?.size ?? 3
  if (!kw || lat == null || lng == null || i >= size * size) return json({ error: 'Dot not found' }, 404)

  const { data: cached } = await admin.from('audit_drilldowns').select('results').eq('audit_id', audit.id).eq('keyword_idx', k).eq('point_idx', i).maybeSingle()
  const c = cached?.results as Any
  if (c && c.v === VERSION) return json(c, 200, { 'Cache-Control': 'public, max-age=3600' })

  const key = Deno.env.get('GOOGLE_PLACES_API_KEY')
  if (!key) return json({ error: 'GOOGLE_PLACES_API_KEY is not set' }, 500)
  const { data: biz } = await admin.from('businesses').select('place_id').eq('id', audit.business_id).maybeSingle()
  const yourId: string = biz?.place_id ?? ''

  // Live search at the dot: names and ratings in one call
  const pt = gridPoint(lat, lng, size, kw.stepKm ?? 1.5, i)
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount' },
    body: JSON.stringify({
      textQuery: kw.keyword,
      languageCode: 'en',
      regionCode: 'IN',
      pageSize: 20,
      locationBias: { circle: { center: { latitude: pt.lat, longitude: pt.lng }, radius: kw.radiusM ?? 1000 } },
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return json({ error: body?.error?.message ?? `Google HTTP ${res.status}` }, 502)
  const live = (body.places ?? []) as Any[]
  const known = new Map<string, Info>(live.map((p) => [p.id as string, info(p)]))

  // The order the audit saw at this dot (falls back to the live order for older reports)
  const saved: string[] | undefined = Array.isArray(kw.ids?.[i]) ? kw.ids[i] : undefined
  const order = (saved ?? live.map((p) => p.id as string)).slice(0, 20)

  // Look up any saved business the live search didn't return
  const missing = order.filter((id) => !known.has(id))
  await Promise.all(
    missing.map(async (id) => {
      const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=en`, {
        headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount' },
      })
      if (r.ok) known.set(id, info(await r.json()))
    }),
  )

  const rows = order
    .map((id, n) => ({ rank: n + 1, ...(known.get(id) ?? { name: 'Unknown business', rating: null, reviews: null }), you: !!yourId && id === yourId }))
  const yourIdx = rows.findIndex((r) => r.you)
  const result = { v: VERSION, rows, yourRank: yourIdx === -1 ? 21 : yourIdx + 1, auditOrder: !!saved }

  await admin.from('audit_drilldowns').upsert({ audit_id: audit.id, keyword_idx: k, point_idx: i, results: result })
  return json(result, 200, { 'Cache-Control': 'public, max-age=3600' })
})
