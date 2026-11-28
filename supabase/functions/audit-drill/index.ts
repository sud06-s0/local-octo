// supabase/functions/audit-drill/index.ts
// Competition Drilldown for one heatmap dot: top 5 businesses (name, rating, reviews) at that point for that keyword.
// GET ?t=<share_token>&k=<keyword index>&i=<point index>. No login (the report's share token is the key).
// One Google Text Search (Enterprise) the first time a dot is clicked; after that it's served from audit_drilldowns.
// Secret: GOOGLE_PLACES_API_KEY.

import { adminClient } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function gridPoint(lat: number, lng: number, size: number, stepKm: number, i: number) {
  const dLat = stepKm / 111.32
  const dLng = stepKm / (111.32 * Math.cos((lat * Math.PI) / 180))
  const half = (size - 1) / 2
  const row = Math.floor(i / size)
  const col = i % size
  return { lat: lat + (half - row) * dLat, lng: lng + (col - half) * dLng }
}

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
  const lat = report?.business?.lat
  const lng = report?.business?.lng
  const size = kw?.size ?? 3
  if (!kw || lat == null || lng == null || i >= size * size) return json({ error: 'Dot not found' }, 404)

  const { data: cached } = await admin.from('audit_drilldowns').select('results').eq('audit_id', audit.id).eq('keyword_idx', k).eq('point_idx', i).maybeSingle()
  if (cached) return json({ results: cached.results }, 200, { 'Cache-Control': 'public, max-age=3600' })

  const key = Deno.env.get('GOOGLE_PLACES_API_KEY')
  if (!key) return json({ error: 'GOOGLE_PLACES_API_KEY is not set' }, 500)
  const { data: biz } = await admin.from('businesses').select('place_id').eq('id', audit.business_id).maybeSingle()

  const pt = gridPoint(lat, lng, size, kw.stepKm ?? 1.5, i)
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount',
    },
    body: JSON.stringify({
      textQuery: kw.keyword,
      languageCode: 'en',
      regionCode: 'IN',
      pageSize: 20,
      locationBias: { circle: { center: { latitude: pt.lat, longitude: pt.lng }, radius: 1000 } },
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return json({ error: body?.error?.message ?? `Google HTTP ${res.status}` }, 502)

  const list = (body.places ?? []) as Any[]
  const top = list.slice(0, 5).map((p, n) => ({
    rank: n + 1,
    name: p.displayName?.text ?? '',
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? null,
    you: !!biz?.place_id && p.id === biz.place_id,
  }))
  // If the business is lower down, add it as the last row so it's easy to compare
  const yourIdx = biz?.place_id ? list.findIndex((p) => p.id === biz.place_id) : -1
  if (yourIdx >= 5) {
    const p = list[yourIdx]
    top.push({ rank: yourIdx + 1, name: p.displayName?.text ?? '', rating: p.rating ?? null, reviews: p.userRatingCount ?? null, you: true })
  }

  await admin.from('audit_drilldowns').upsert({ audit_id: audit.id, keyword_idx: k, point_idx: i, results: top })
  return json({ results: top }, 200, { 'Cache-Control': 'public, max-age=3600' })
})
