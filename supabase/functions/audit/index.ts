// supabase/functions/audit/index.ts
// Audit / rank report for one business. Agency logins only.
// Body: { action: 'suggest', businessId }            -> { keywords, source }  (Google search keywords if available, else from categories + city)
//       { action: 'run', businessId, keywords[] }    -> { id, report }        (saved in business_audits)
// Secrets: GOOGLE_PLACES_API_KEY (Places API (New)). Uses the Google Business Profile connection when the business has one.
// Places cost per keyword: 8 x Text Search IDs-only (free, unlimited in India) + 1 x Text Search Enterprise (7,000 free / month in India).

import { adminClient, getUser, isAgency, isMember } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'
import { accessTokenFor, gbp } from '../_shared/gbp.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const PLACES = 'https://places.googleapis.com/v1'
const MAX_KEYWORDS = 10
const GRID_STEP_KM = 1.5 // 3 x 3 points, 1.5 km apart -> about 9 sq km
const NOT_FOUND = 21 // shown as "20+"

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function places(path: string, fields: string, init: RequestInit = {}) {
  const key = Deno.env.get('GOOGLE_PLACES_API_KEY')
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY is not set in Supabase secrets')
  const res = await fetch(`${PLACES}/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fields },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error?.message ?? `Google Places HTTP ${res.status}`)
  return body as Any
}

/* ---------- profile ---------- */

interface Profile {
  name: string
  address: string
  city: string
  lat: number | null
  lng: number | null
  rating: number | null
  reviewCount: number | null
  primaryCategory: string
  additionalCategories: string[]
  services: number | null // null = unknown (Google not connected)
  description: string | null
  phone: boolean
  website: boolean
  hours: boolean
  photos: number | null
  source: 'gbp' | 'places'
}

async function gbpProfile(admin: SupabaseClient, businessId: string): Promise<{ profile: Partial<Profile>; token: string; location: string } | null> {
  const { data: conn } = await admin.from('google_connections').select('location_name, account_name').eq('business_id', businessId).maybeSingle()
  if (!conn?.location_name) return null
  const { token } = await accessTokenFor(admin, businessId)
  const mask = 'title,categories,profile,serviceItems,regularHours,phoneNumbers,websiteUri,storefrontAddress,latlng'
  const l = await gbp(token, `https://mybusinessbusinessinformation.googleapis.com/v1/${conn.location_name}?readMask=${mask}`)
  let photos: number | null = null
  if (conn.account_name) {
    try {
      const m = await gbp(token, `https://mybusiness.googleapis.com/v4/${conn.account_name}/${conn.location_name}/media?pageSize=1`)
      photos = m.totalMediaItemCount ?? (m.mediaItems?.length ?? 0)
    } catch {
      photos = null
    }
  }
  const addr = l.storefrontAddress
  return {
    token,
    location: conn.location_name,
    profile: {
      name: l.title ?? '',
      address: addr ? [...(addr.addressLines ?? []), addr.locality, addr.administrativeArea].filter(Boolean).join(', ') : '',
      city: addr?.locality ?? '',
      lat: l.latlng?.latitude ?? null,
      lng: l.latlng?.longitude ?? null,
      primaryCategory: l.categories?.primaryCategory?.displayName ?? '',
      additionalCategories: (l.categories?.additionalCategories ?? []).map((c: Any) => c.displayName).filter(Boolean),
      services: (l.serviceItems ?? []).length,
      description: l.profile?.description ?? '',
      phone: !!l.phoneNumbers?.primaryPhone,
      website: !!l.websiteUri,
      hours: !!l.regularHours?.periods?.length,
      photos,
      source: 'gbp',
    },
  }
}

async function loadProfile(admin: SupabaseClient, businessId: string) {
  const { data: b } = await admin.from('businesses').select('name, address, place_id, phone, website, google_rating, google_review_count').eq('id', businessId).single()
  if (!b) throw new Error('Business not found')

  let g: Awaited<ReturnType<typeof gbpProfile>> = null
  let gbpError = ''
  try {
    g = await gbpProfile(admin, businessId)
  } catch (e) {
    gbpError = e instanceof Error ? e.message : 'Google Business Profile request failed'
  }

  // Places details: location, rating, types (and everything else when Google is not connected)
  let p: Any = {}
  if (b.place_id) {
    p = await places(
      `places/${b.place_id}?languageCode=en`,
      'id,displayName,formattedAddress,addressComponents,location,rating,userRatingCount,primaryTypeDisplayName,nationalPhoneNumber,websiteUri,regularOpeningHours,photos,editorialSummary',
    )
  }
  const city = (p.addressComponents ?? []).find((c: Any) => (c.types ?? []).includes('locality'))?.longText ?? ''

  const profile: Profile = {
    name: g?.profile.name || p.displayName?.text || b.name,
    address: g?.profile.address || p.formattedAddress || b.address || '',
    city: g?.profile.city || city,
    lat: g?.profile.lat ?? p.location?.latitude ?? null,
    lng: g?.profile.lng ?? p.location?.longitude ?? null,
    rating: p.rating ?? (b.google_rating != null ? Number(b.google_rating) : null),
    reviewCount: p.userRatingCount ?? b.google_review_count ?? null,
    primaryCategory: g?.profile.primaryCategory || p.primaryTypeDisplayName?.text || '',
    additionalCategories: g?.profile.additionalCategories ?? [],
    services: g?.profile.services ?? null,
    description: g ? g.profile.description ?? '' : p.editorialSummary?.text ?? null,
    phone: g ? !!g.profile.phone : !!(p.nationalPhoneNumber || b.phone),
    website: g ? !!g.profile.website : !!(p.websiteUri || b.website),
    hours: g ? !!g.profile.hours : !!p.regularOpeningHours?.periods?.length,
    photos: g?.profile.photos ?? (p.photos ? p.photos.length : null), // Places returns at most 10
    source: g ? 'gbp' : 'places',
  }
  return { profile, placeId: (p.id as string) || b.place_id || '', gbp: g, gbpError }
}

/* ---------- keywords ---------- */

async function searchKeywords(token: string, location: string): Promise<{ keyword: string; impressions: number }[]> {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1)
  const q = new URLSearchParams({
    'monthlyRange.startMonth.year': String(start.getFullYear()),
    'monthlyRange.startMonth.month': String(start.getMonth() + 1),
    'monthlyRange.endMonth.year': String(end.getFullYear()),
    'monthlyRange.endMonth.month': String(end.getMonth() + 1),
    pageSize: '50',
  })
  const body = await gbp(token, `https://businessprofileperformance.googleapis.com/v1/${location}/searchkeywords/impressions/monthly?${q}`)
  return (body.searchKeywordsCounts ?? [])
    .map((k: Any) => ({ keyword: String(k.searchKeyword ?? '').trim(), impressions: Number(k.insightsValue?.value ?? k.insightsValue?.threshold ?? 0) }))
    .filter((k: { keyword: string }) => k.keyword)
    .sort((a: { impressions: number }, b: { impressions: number }) => b.impressions - a.impressions)
}

function keywordsFromCategories(profile: Profile): string[] {
  const cats = [profile.primaryCategory, ...profile.additionalCategories].filter(Boolean).map((c) => c.toLowerCase())
  const out = new Set<string>()
  for (const c of cats) {
    if (profile.city) out.add(`${c} in ${profile.city.toLowerCase()}`)
    out.add(`${c} near me`)
    out.add(`best ${c}`)
  }
  return [...out].slice(0, MAX_KEYWORDS)
}

/* ---------- ranks ---------- */

function grid(lat: number, lng: number) {
  const dLat = GRID_STEP_KM / 111.32
  const dLng = GRID_STEP_KM / (111.32 * Math.cos((lat * Math.PI) / 180))
  const pts: { lat: number; lng: number }[] = []
  for (const r of [1, 0, -1]) for (const c of [-1, 0, 1]) pts.push({ lat: lat + r * dLat, lng: lng + c * dLng })
  return pts // row by row, north-west first; index 4 is the business location
}

const searchBody = (keyword: string, p: { lat: number; lng: number }) =>
  JSON.stringify({
    textQuery: keyword,
    languageCode: 'en',
    regionCode: 'IN',
    pageSize: 20,
    locationBias: { circle: { center: { latitude: p.lat, longitude: p.lng }, radius: 1000 } },
  })

interface Competitor {
  placeId: string
  name: string
  rating: number | null
  reviews: number | null
  rank: number
}

async function rankKeyword(keyword: string, placeId: string, lat: number, lng: number) {
  const pts = grid(lat, lng)
  const results = await Promise.all(
    pts.map(async (pt, i) => {
      if (i === 4) {
        // Center: one Enterprise call also gives the names and ratings of the businesses around
        const body = await places('places:searchText', 'places.id,places.displayName,places.rating,places.userRatingCount', { method: 'POST', body: searchBody(keyword, pt) })
        const list = (body.places ?? []) as Any[]
        const idx = list.findIndex((x) => x.id === placeId)
        const competitors: Competitor[] = list
          .map((x, n) => ({ placeId: x.id, name: x.displayName?.text ?? '', rating: x.rating ?? null, reviews: x.userRatingCount ?? null, rank: n + 1 }))
          .filter((x) => x.placeId !== placeId && (idx === -1 ? x.rank <= 3 : x.rank < idx + 1))
        return { rank: idx === -1 ? NOT_FOUND : idx + 1, competitors }
      }
      const body = await places('places:searchText', 'places.id', { method: 'POST', body: searchBody(keyword, pt) })
      const idx = ((body.places ?? []) as Any[]).findIndex((x) => x.id === placeId)
      return { rank: idx === -1 ? NOT_FOUND : idx + 1, competitors: [] as Competitor[] }
    }),
  )
  const ranks = results.map((r) => r.rank)
  const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length
  return {
    keyword,
    grid: ranks,
    center: ranks[4],
    average: Math.round(avg * 10) / 10,
    foundIn: ranks.filter((r) => r <= 20).length,
    top3In: ranks.filter((r) => r <= 3).length,
    competitors: results[4].competitors,
  }
}

/* ---------- reviews ---------- */

async function reviewStats(admin: SupabaseClient, businessId: string) {
  const since = new Date(Date.now() - 84 * 86400_000).toISOString() // 12 weeks
  const [{ count: recent }, { count: total }, { count: replied }] = await Promise.all([
    admin.from('reviews').select('id', { count: 'exact', head: true }).eq('business_id', businessId).gte('review_created_at', since),
    admin.from('reviews').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
    admin.from('reviews').select('id', { count: 'exact', head: true }).eq('business_id', businessId).not('reply_text', 'is', null).neq('reply_source', 'draft'),
  ])
  return {
    perWeek: Math.round(((recent ?? 0) / 12) * 10) / 10,
    synced: total ?? 0,
    responseRate: total ? Math.round(((replied ?? 0) / total) * 100) : null,
  }
}

/* ---------- scores ---------- */

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

function titleCheck(name: string, city: string) {
  const t = name.toLowerCase()
  const issues: string[] = []
  if (/\b(best|top|no\.?\s?1|cheap|near me)\b/.test(t)) issues.push('Promotional words in the name')
  if (/\d{6,}/.test(t)) issues.push('Phone number in the name')
  if (city && t.includes(city.toLowerCase())) issues.push('City name in the name')
  if (/[|]/.test(t) || (t.match(/[-,]/g) ?? []).length >= 2) issues.push('Extra keywords added with | , or -')
  if (name.length > 60) issues.push('Name is very long')
  const risk = issues.length >= 2 ? 'High' : issues.length === 1 ? 'Medium' : 'Low'
  return { score: clamp(100 - issues.length * 35), issues, risk }
}

function buildScores(profile: Profile, reviews: Awaited<ReturnType<typeof reviewStats>>) {
  const title = titleCheck(profile.name, profile.city)
  const categories = 1 + profile.additionalCategories.length
  const categoryScore = profile.source === 'gbp' ? clamp((categories / 5) * 100) : null
  const serviceScore = profile.services == null ? null : clamp((profile.services / 20) * 100)
  const descLen = profile.description?.length ?? 0
  const descHasCategory = !!profile.primaryCategory && (profile.description ?? '').toLowerCase().includes(profile.primaryCategory.toLowerCase().split(' ')[0])
  const descriptionScore = profile.description == null ? null : clamp((Math.min(descLen, 600) / 600) * 80 + (descHasCategory ? 20 : 0))

  const checklist = [
    { label: 'Phone number', done: profile.phone },
    { label: 'Website', done: profile.website },
    { label: 'Opening hours', done: profile.hours },
    { label: 'Description', done: profile.description == null ? null : descLen >= 250 },
    { label: '5+ categories', done: profile.source === 'gbp' ? categories >= 5 : null },
    { label: '20+ services', done: profile.services == null ? null : profile.services >= 20 },
    { label: '10+ photos', done: profile.photos == null ? null : profile.photos >= 10 },
    { label: 'Replies to reviews', done: reviews.responseRate == null ? null : reviews.responseRate >= 80 },
  ]
  const known = checklist.filter((c) => c.done !== null)
  const completion = known.length ? clamp((known.filter((c) => c.done).length / known.length) * 100) : 0

  const reviewScore = clamp((reviews.perWeek / 2) * 100)
  const responseScore = reviews.responseRate == null ? null : clamp((reviews.responseRate / 80) * 100)

  const parts = [title.score, categoryScore, serviceScore, descriptionScore, completion, reviewScore, responseScore].filter((n): n is number => n != null)
  const profileScore = clamp(parts.reduce((a, b) => a + b, 0) / parts.length)

  return {
    profileScore,
    title: { ...title, value: profile.name },
    categories: { count: profile.source === 'gbp' ? categories : null, target: 5, score: categoryScore, list: [profile.primaryCategory, ...profile.additionalCategories].filter(Boolean) },
    services: { count: profile.services, target: 20, score: serviceScore },
    description: { length: profile.description == null ? null : descLen, target: 600, mentionsCategory: descHasCategory, score: descriptionScore },
    completion: { score: completion, checklist },
    reviews: { perWeek: reviews.perWeek, target: 2, score: reviewScore, synced: reviews.synced },
    response: { rate: reviews.responseRate, target: 80, score: responseScore },
    suspensionRisk: title.risk,
  }
}

/* ---------- handler ---------- */

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const admin = adminClient()
  const user = await getUser(req, admin)
  if (!user) return json({ error: 'Sign in required' }, 401)

  const input = (await req.json().catch(() => ({}))) as { action?: string; businessId?: string; keywords?: string[] }
  const businessId = input.businessId
  if (!businessId) return json({ error: 'businessId is required' }, 400)
  if (!(await isAgency(admin, user.id)) || !(await isMember(admin, user.id, businessId))) return json({ error: 'Not allowed' }, 403)

  try {
    if (input.action === 'suggest') {
      const { profile, gbp: g } = await loadProfile(admin, businessId)
      if (g) {
        try {
          const kw = await searchKeywords(g.token, g.location)
          if (kw.length) return json({ keywords: kw.slice(0, MAX_KEYWORDS).map((k) => k.keyword), source: 'google' })
        } catch {
          // Performance API not enabled or no data yet: fall back to categories
        }
      }
      return json({ keywords: keywordsFromCategories(profile), source: 'categories' })
    }

    if (input.action === 'run') {
      const keywords = [...new Set((input.keywords ?? []).map((k) => String(k).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_KEYWORDS)
      if (!keywords.length) return json({ error: 'Add at least one keyword' }, 400)

      const { profile, placeId, gbp: g, gbpError } = await loadProfile(admin, businessId)
      if (!placeId) return json({ error: 'This business has no Google place yet. Connect Google or find the business on Google first.' }, 400)
      if (profile.lat == null || profile.lng == null) return json({ error: 'Could not get the business location from Google' }, 400)

      let impressions = new Map<string, number>()
      if (g) {
        try {
          impressions = new Map((await searchKeywords(g.token, g.location)).map((k) => [k.keyword.toLowerCase(), k.impressions]))
        } catch {
          // optional
        }
      }

      // 3 keywords at a time (9 calls each)
      const rows: Awaited<ReturnType<typeof rankKeyword>>[] = []
      for (let i = 0; i < keywords.length; i += 3) {
        rows.push(...(await Promise.all(keywords.slice(i, i + 3).map((k) => rankKeyword(k, placeId, profile.lat!, profile.lng!)))))
      }

      // Competitors that rank above the business, across all keywords
      const comp = new Map<string, Competitor & { keywords: number; rankSum: number }>()
      for (const r of rows)
        for (const c of r.competitors) {
          const cur = comp.get(c.placeId) ?? { ...c, keywords: 0, rankSum: 0 }
          cur.keywords += 1
          cur.rankSum += c.rank
          comp.set(c.placeId, cur)
        }
      const competitors = [...comp.values()]
        .sort((a, b) => b.keywords - a.keywords || a.rankSum / a.keywords - b.rankSum / b.keywords)
        .slice(0, 8)
        .map((c) => ({ name: c.name, rating: c.rating, reviews: c.reviews, keywords: c.keywords, averageRank: Math.round((c.rankSum / c.keywords) * 10) / 10 }))

      const reviews = await reviewStats(admin, businessId)
      const scores = buildScores(profile, reviews)
      const searchRank = Math.round((rows.reduce((a, r) => a + r.average, 0) / rows.length) * 10) / 10

      const report = {
        version: 1,
        business: { name: profile.name, address: profile.address, rating: profile.rating, reviewCount: profile.reviewCount, category: profile.primaryCategory },
        source: profile.source,
        gbpNote: g ? '' : gbpError || 'Google Business Profile is not connected, so services, categories and description could not be checked.',
        gridStepKm: GRID_STEP_KM,
        searchRank,
        scores,
        keywords: rows.map(({ competitors: _c, ...r }) => ({ ...r, impressions: impressions.get(r.keyword) ?? null })),
        competitors,
      }

      const { data, error } = await admin.from('business_audits').insert({ business_id: businessId, keywords, report, created_by: user.id }).select('id, created_at').single()
      if (error) throw new Error(error.message)
      return json({ id: data.id, createdAt: data.created_at, report })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Audit failed' }, 502)
  }
})
