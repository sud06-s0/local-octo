// supabase/functions/audit/index.ts
// Audit / rank report for one business. Agency logins only.
// Body: { action: 'suggest', businessId }            -> { keywords, source }  (Google search keywords if available, else from categories + city)
//       { action: 'run', businessId, keywords[] }    -> { id, createdAt, shareToken, report }  (saved in business_audits)
// Secrets: GOOGLE_PLACES_API_KEY (Places API (New)); GROQ_API_KEY (optional, writes the summary).
// Uses the Google Business Profile connection when the business has one (services, posts, photos, service area).
// Places calls: top 3 keywords get a 7 x 7 heatmap (48 IDs-only + 1 Enterprise), the rest 3 x 3 (8 IDs-only + 1 Enterprise).
// IDs-only Text Search is free and unlimited in India; Text Search Enterprise has 7,000 free a month.

import { adminClient, getUser, isAgency, isMember } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'
import { accessTokenFor, gbp } from '../_shared/gbp.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const PLACES = 'https://places.googleapis.com/v1'
const MAX_KEYWORDS = 10
const HEATMAP_KEYWORDS = 3
const HEAT = { size: 7, stepKm: 1 } // 7 x 7 points, 1 km apart
const SMALL = { size: 3, stepKm: 1.5 } // 3 x 3 points, 1.5 km apart
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

/** Runs async jobs with at most `limit` at a time. */
async function pool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++
        out[i] = await jobs[i]()
      }
    }),
  )
  return out
}

/* ---------- profile ---------- */

interface Service {
  name: string
  description: string
}
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
  services: Service[] | null // null = unknown (Google not connected)
  description: string | null
  phone: boolean
  website: boolean
  hours: boolean
  photos: number | null
  serviceArea: boolean | null
  posts: { summary: string; createTime: string }[] | null
  source: 'gbp' | 'places'
}

const prettyId = (id: string) =>
  id
    .replace(/^.*:/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

async function gbpProfile(admin: SupabaseClient, businessId: string) {
  const { data: conn } = await admin.from('google_connections').select('location_name, account_name').eq('business_id', businessId).maybeSingle()
  if (!conn?.location_name) return null
  const { token } = await accessTokenFor(admin, businessId)
  const mask = 'title,categories,profile,serviceItems,regularHours,phoneNumbers,websiteUri,storefrontAddress,latlng,serviceArea'
  const l = await gbp(token, `https://mybusinessbusinessinformation.googleapis.com/v1/${conn.location_name}?readMask=${mask}`)

  // Names for structured services come from the categories' service types
  const typeNames = new Map<string, string>()
  for (const c of [l.categories?.primaryCategory, ...(l.categories?.additionalCategories ?? [])])
    for (const t of c?.serviceTypes ?? []) if (t.serviceTypeId) typeNames.set(t.serviceTypeId, t.displayName)
  const services: Service[] = (l.serviceItems ?? [])
    .map((s: Any) => {
      if (s.freeFormServiceItem) return { name: s.freeFormServiceItem.label?.displayName ?? '', description: s.freeFormServiceItem.label?.description ?? '' }
      const id = s.structuredServiceItem?.serviceTypeId ?? ''
      return { name: typeNames.get(id) ?? prettyId(id), description: s.structuredServiceItem?.description ?? '' }
    })
    .filter((s: Service) => s.name)

  let photos: number | null = null
  let posts: Profile['posts'] = null
  if (conn.account_name) {
    const base = `https://mybusiness.googleapis.com/v4/${conn.account_name}/${conn.location_name}`
    const [m, p] = await Promise.allSettled([gbp(token, `${base}/media?pageSize=1`), gbp(token, `${base}/localPosts?pageSize=100`)])
    if (m.status === 'fulfilled') photos = m.value.totalMediaItemCount ?? m.value.mediaItems?.length ?? 0
    if (p.status === 'fulfilled') posts = (p.value.localPosts ?? []).map((x: Any) => ({ summary: x.summary ?? '', createTime: x.createTime ?? '' }))
  }
  const addr = l.storefrontAddress
  return {
    token,
    location: conn.location_name as string,
    profile: {
      name: l.title ?? '',
      address: addr ? [...(addr.addressLines ?? []), addr.locality, addr.administrativeArea].filter(Boolean).join(', ') : '',
      city: addr?.locality ?? '',
      lat: l.latlng?.latitude ?? null,
      lng: l.latlng?.longitude ?? null,
      primaryCategory: l.categories?.primaryCategory?.displayName ?? '',
      additionalCategories: (l.categories?.additionalCategories ?? []).map((c: Any) => c.displayName).filter(Boolean) as string[],
      services,
      description: (l.profile?.description ?? '') as string,
      phone: !!l.phoneNumbers?.primaryPhone,
      website: !!l.websiteUri,
      hours: !!l.regularHours?.periods?.length,
      photos,
      serviceArea: !!(l.serviceArea?.places?.placeInfos?.length || l.serviceArea?.regionCode),
      posts,
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
    description: g ? g.profile.description : p.editorialSummary?.text ?? null,
    phone: g ? g.profile.phone : !!(p.nationalPhoneNumber || b.phone),
    website: g ? g.profile.website : !!(p.websiteUri || b.website),
    hours: g ? g.profile.hours : !!p.regularOpeningHours?.periods?.length,
    photos: g?.profile.photos ?? (p.photos ? p.photos.length : null), // Places returns at most 10
    serviceArea: g ? g.profile.serviceArea : null,
    posts: g?.profile.posts ?? null,
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
    out.add(`${c} near me`)
    if (profile.city) out.add(`${c} in ${profile.city.toLowerCase()}`)
    out.add(`best ${c}`)
  }
  return [...out].slice(0, MAX_KEYWORDS)
}

const STOP = new Set(['near', 'me', 'best', 'top', 'in', 'the', 'a', 'an', 'and', 'for', 'of', 'at', 'to', 'with', 'my', 'open', 'now', 'cheap', 'good'])
/** Meaningful words of the keywords + categories ("gym near me" -> "gym"). */
function targetTerms(keywords: string[], profile: Profile): string[] {
  const words = [...keywords, profile.primaryCategory, ...profile.additionalCategories]
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && w !== profile.city.toLowerCase())
  return [...new Set(words)]
}
const termsIn = (text: string, terms: string[]) => {
  const t = text.toLowerCase()
  return terms.filter((w) => new RegExp(`\\b${w}`).test(t))
}

/* ---------- ranks ---------- */

function gridPoints(lat: number, lng: number, size: number, stepKm: number) {
  const dLat = stepKm / 111.32
  const dLng = stepKm / (111.32 * Math.cos((lat * Math.PI) / 180))
  const half = (size - 1) / 2
  const pts: { lat: number; lng: number }[] = []
  for (let r = half; r >= -half; r--) for (let c = -half; c <= half; c++) pts.push({ lat: lat + r * dLat, lng: lng + c * dLng })
  return pts // row by row, north-west first; the middle point is the business location
}

const searchBody = (keyword: string, p: { lat: number; lng: number }) =>
  JSON.stringify({
    textQuery: keyword,
    languageCode: 'en',
    regionCode: 'IN',
    pageSize: 20,
    locationBias: { circle: { center: { latitude: p.lat, longitude: p.lng }, radius: 1000 } },
  })

interface Nearby {
  placeId: string
  name: string
  address: string
  rating: number | null
  reviews: number | null
  rank: number
}

async function rankKeyword(keyword: string, placeId: string, lat: number, lng: number, heat: boolean) {
  const g = heat ? HEAT : SMALL
  const pts = gridPoints(lat, lng, g.size, g.stepKm)
  const mid = (pts.length - 1) / 2
  let nearby: Nearby[] = []
  const ranks = await pool(
    pts.map((pt, i) => async () => {
      if (i === mid) {
        // Center: one Enterprise call also gives the names, addresses and ratings of the businesses around
        const body = await places('places:searchText', 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount', {
          method: 'POST',
          body: searchBody(keyword, pt),
        })
        const list = (body.places ?? []) as Any[]
        nearby = list.map((x, n) => ({ placeId: x.id, name: x.displayName?.text ?? '', address: x.formattedAddress ?? '', rating: x.rating ?? null, reviews: x.userRatingCount ?? null, rank: n + 1 }))
        const idx = list.findIndex((x) => x.id === placeId)
        return idx === -1 ? NOT_FOUND : idx + 1
      }
      const body = await places('places:searchText', 'places.id', { method: 'POST', body: searchBody(keyword, pt) })
      const idx = ((body.places ?? []) as Any[]).findIndex((x) => x.id === placeId)
      return idx === -1 ? NOT_FOUND : idx + 1
    }),
    16,
  )
  const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length
  const average = Math.round(avg * 10) / 10
  return {
    keyword,
    size: g.size,
    stepKm: g.stepKm,
    grid: ranks,
    center: ranks[mid],
    average,
    foundIn: ranks.filter((r) => r <= 20).length,
    top3In: ranks.filter((r) => r <= 3).length,
    points: ranks.length,
    // Estimate: map-pack clicks fall roughly with rank^1.5, so moving from the average rank to #1 multiplies them by about this much
    growth: Math.round(Math.pow(Math.min(average, 20), 1.52) * 100) / 100,
    nearby: nearby.filter((x) => x.placeId !== placeId),
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
    perWeek: Math.round(((recent ?? 0) / 12) * 100) / 100,
    synced: total ?? 0,
    unreplied: (total ?? 0) - (replied ?? 0),
    responseRate: total ? Math.round(((replied ?? 0) / total) * 100) : null,
  }
}

/* ---------- market opportunity (estimate) ---------- */

const METROS = ['bengaluru', 'bangalore', 'mumbai', 'delhi', 'new delhi', 'kolkata', 'chennai', 'hyderabad', 'pune', 'ahmedabad', 'gurugram', 'gurgaon', 'noida', 'navi mumbai', 'thane']
const SPEND: { match: RegExp; ticket: number; share: number }[] = [
  { match: /gym|fitness|yoga|crossfit|pilates|zumba/, ticket: 300, share: 0.03 },
  { match: /restaurant|cafe|caf|food|bakery|dhaba|biryani|pizza|sweet/, ticket: 400, share: 0.25 },
  { match: /salon|spa|beauty|barber|parlour|parlor|makeup/, ticket: 500, share: 0.08 },
  { match: /dent|clinic|doctor|hospital|medical|physio|diagnostic|pharmacy/, ticket: 800, share: 0.05 },
  { match: /school|college|coaching|academy|education|tutor|institute|university/, ticket: 3000, share: 0.01 },
  { match: /hotel|resort|lodge|guest house/, ticket: 3000, share: 0.01 },
  { match: /car|auto|bike|motor|garage|tyre/, ticket: 1500, share: 0.02 },
  { match: /pet|vet|groom/, ticket: 800, share: 0.01 },
]
function market(profile: Profile) {
  const cat = [profile.primaryCategory, ...profile.additionalCategories].join(' ').toLowerCase()
  const s = SPEND.find((x) => x.match.test(cat)) ?? { ticket: 500, share: 0.03 }
  const population = METROS.includes(profile.city.toLowerCase()) ? 6_000_000 : 1_000_000 // within 30 minutes
  const people = Math.round((population * s.share) / 1000) * 1000
  return { monthly: people * s.ticket, people, ticket: s.ticket }
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

type Reviews = Awaited<ReturnType<typeof reviewStats>>

function buildChecks(profile: Profile, reviews: Reviews, terms: string[]) {
  const desc = profile.description ?? ''
  const descTerms = termsIn(desc, terms)
  const monthAgo = Date.now() - 30 * 86400_000
  const recentPosts = profile.posts?.filter((p) => new Date(p.createTime).getTime() >= monthAgo) ?? null
  const postsWithTerms = recentPosts?.filter((p) => termsIn(p.summary, terms).length > 0).length ?? 0
  const services = profile.services
  const noDesc = services?.filter((s) => !s.description.trim()) ?? []
  const unknown = 'Connect Google Business Profile to check this.'

  const checks: { key: string; label: string; pass: boolean | null; detail: string }[] = [
    {
      key: 'description',
      label: 'Business Description',
      pass: profile.description == null ? null : descTerms.length >= Math.min(3, terms.length) && desc.length >= 250,
      detail: profile.description == null ? unknown : `${descTerms.length} of your keywords are in the description (${desc.length} characters). Use at least 3 and 250+ characters.`,
    },
    {
      key: 'reviewFrequency',
      label: 'Review Frequency',
      pass: reviews.perWeek >= 1,
      detail: `${reviews.perWeek} new reviews per week. Target: at least 1 per week.`,
    },
    {
      key: 'rating',
      label: 'Google Rating',
      pass: profile.rating == null ? null : profile.rating >= 4,
      detail: profile.rating == null ? 'No rating yet.' : `${profile.rating.toFixed(1)} stars. Target: 4.0 or more.`,
    },
    {
      key: 'replies',
      label: 'Review Replies',
      pass: reviews.synced ? reviews.unreplied === 0 : null,
      detail: reviews.synced ? (reviews.unreplied ? `${reviews.unreplied} reviews have no reply.` : 'Every review has a reply.') : 'Sync reviews from Google to check this.',
    },
    {
      key: 'images',
      label: '# of Images',
      pass: profile.photos == null ? null : profile.photos >= 8,
      detail: profile.photos == null ? unknown : `${profile.photos} images. Target: at least 8.`,
    },
    {
      key: 'postFrequency',
      label: 'Post Frequency',
      pass: recentPosts == null ? null : recentPosts.length >= 3,
      detail: recentPosts == null ? unknown : `${recentPosts.length} Google posts in the last 30 days. Recommended: one every 5 days (at least 3 a month).`,
    },
    {
      key: 'postKeywords',
      label: 'Post Keyword Optimization',
      pass: recentPosts == null ? null : recentPosts.length > 0 && postsWithTerms >= Math.ceil(recentPosts.length / 2),
      detail: recentPosts == null ? unknown : recentPosts.length ? `${postsWithTerms} of ${recentPosts.length} recent posts use your keywords.` : 'No recent posts to check.',
    },
    {
      key: 'services',
      label: 'Services List',
      pass: services == null ? null : services.length >= 25,
      detail: services == null ? unknown : `${services.length} services listed. Target: at least 25.`,
    },
    {
      key: 'serviceDescriptions',
      label: 'Service Descriptions',
      pass: services == null ? null : services.length > 0 && noDesc.length === 0,
      detail: services == null ? unknown : services.length ? `${noDesc.length} of ${services.length} services have no description.` : 'No services listed.',
    },
    {
      key: 'serviceArea',
      label: 'Service Area',
      pass: profile.serviceArea,
      detail: profile.serviceArea == null ? unknown : profile.serviceArea ? 'Service area is set.' : 'No service area set.',
    },
  ]
  const passed = checks.filter((c) => c.pass === true).length
  return {
    checks,
    optimizationScore: clamp((passed / checks.length) * 100),
    descTerms,
    recentPosts: recentPosts?.length ?? null,
    noDesc: noDesc.map((s) => s.name),
  }
}

function buildScores(profile: Profile, reviews: Reviews) {
  const title = titleCheck(profile.name, profile.city)
  const categories = 1 + profile.additionalCategories.length
  const categoryScore = profile.source === 'gbp' ? clamp((categories / 5) * 100) : null
  const serviceCount = profile.services?.length ?? null
  const serviceScore = serviceCount == null ? null : clamp((serviceCount / 25) * 100)
  const descLen = profile.description?.length ?? 0
  const descHasCategory = !!profile.primaryCategory && (profile.description ?? '').toLowerCase().includes(profile.primaryCategory.toLowerCase().split(' ')[0])
  const descriptionScore = profile.description == null ? null : clamp((Math.min(descLen, 600) / 600) * 80 + (descHasCategory ? 20 : 0))

  const checklist = [
    { label: 'Phone number', done: profile.phone },
    { label: 'Website', done: profile.website },
    { label: 'Opening hours', done: profile.hours },
    { label: 'Description', done: profile.description == null ? null : descLen >= 250 },
    { label: '5+ categories', done: profile.source === 'gbp' ? categories >= 5 : null },
    { label: '25+ services', done: serviceCount == null ? null : serviceCount >= 25 },
    { label: '8+ photos', done: profile.photos == null ? null : profile.photos >= 8 },
    { label: 'Service area', done: profile.serviceArea },
  ]
  const known = checklist.filter((c) => c.done !== null)
  const completion = known.length ? clamp((known.filter((c) => c.done).length / known.length) * 100) : 0
  const reviewScore = clamp(reviews.perWeek * 100)
  const responseScore = reviews.responseRate == null ? null : clamp((reviews.responseRate / 80) * 100)

  return {
    title: { ...title, value: profile.name },
    categories: { count: profile.source === 'gbp' ? categories : null, target: 5, score: categoryScore, list: [profile.primaryCategory, ...profile.additionalCategories].filter(Boolean) },
    services: { count: serviceCount, target: 25, score: serviceScore },
    description: { length: profile.description == null ? null : descLen, target: 600, mentionsCategory: descHasCategory, score: descriptionScore },
    completion: { score: completion, checklist },
    reviews: { perWeek: reviews.perWeek, target: 1, score: reviewScore, synced: reviews.synced },
    response: { rate: reviews.responseRate, target: 80, score: responseScore },
    suspensionRisk: title.risk,
  }
}

/* ---------- summary (Groq) ---------- */

async function writeSummary(facts: Any): Promise<string> {
  const key = Deno.env.get('GROQ_API_KEY')
  if (!key) return ''
  const model = Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-120b'
  const prompt = `You are Local Octo, a friendly local marketing agency. Write an audit summary for the owner of a business, based ONLY on these facts (JSON):
${JSON.stringify(facts)}

Rules:
- Start with "Hi ${facts.business} team, I'm Local Octo and it's nice to meet you." then say you reviewed their Google Business Profile.
- 3 to 4 short paragraphs, plain text, no headings, no bullet points, no markdown.
- Praise what passes, then explain each failing check and what to do, using the real numbers.
- Do not invent numbers or facts. Skip checks whose pass is null.
- End by offering to help manage these improvements.`
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_completion_tokens: 1200,
        ...(model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(25_000),
    })
    const body = await res.json()
    if (!res.ok) return ''
    return String(body?.choices?.[0]?.message?.content ?? '').trim()
  } catch {
    return ''
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

      // Keywords one after another; the grid points of each run in parallel
      const rows: Awaited<ReturnType<typeof rankKeyword>>[] = []
      for (let i = 0; i < keywords.length; i++) rows.push(await rankKeyword(keywords[i], placeId, profile.lat, profile.lng, i < HEATMAP_KEYWORDS))

      // Top competitors: businesses that show up most often and highest at the business location, across all keywords
      const comp = new Map<string, Nearby & { times: number; rankSum: number }>()
      for (const r of rows)
        for (const c of r.nearby.slice(0, 10)) {
          const cur = comp.get(c.placeId) ?? { ...c, times: 0, rankSum: 0 }
          cur.times += 1
          cur.rankSum += c.rank
          comp.set(c.placeId, cur)
        }
      // Sorted by average rank over ALL keywords (a keyword where it isn't in the top 10 counts as 21), so #1 is the strongest overall
      const overall = (c: { rankSum: number; times: number }) => (c.rankSum + (rows.length - c.times) * NOT_FOUND) / rows.length
      const competitors = [...comp.values()]
        .sort((a, b) => overall(a) - overall(b))
        .slice(0, 5)
        .map((c) => ({
          name: c.name,
          address: c.address,
          rating: c.rating,
          reviews: c.reviews,
          averageRank: Math.round((c.rankSum / c.times) * 10) / 10,
          keywords: c.times,
          totalKeywords: rows.length,
        }))

      const reviews = await reviewStats(admin, businessId)
      const terms = targetTerms(keywords, profile)
      const { checks, optimizationScore, descTerms, recentPosts, noDesc } = buildChecks(profile, reviews, terms)
      const scores = buildScores(profile, reviews)
      const top = rows.slice(0, 5)
      const searchRank = Math.round((top.reduce((a, r) => a + r.average, 0) / top.length) * 10) / 10
      const mk = market(profile)
      const serviceCount = profile.services?.length ?? null

      const summary = await writeSummary({
        business: profile.name,
        category: profile.primaryCategory,
        rating: profile.rating,
        reviewsPerWeek: reviews.perWeek,
        reviewsWithoutReply: reviews.synced ? reviews.unreplied : null,
        images: profile.photos,
        googlePostsLast30Days: recentPosts,
        services: serviceCount,
        servicesWithoutDescription: profile.services ? noDesc.length : null,
        averageSearchRank: searchRank,
        checks: checks.map((c) => ({ check: c.label, pass: c.pass, detail: c.detail })),
      })

      const report = {
        version: 2,
        business: { name: profile.name, address: profile.address, rating: profile.rating, reviewCount: profile.reviewCount, category: profile.primaryCategory, lat: profile.lat, lng: profile.lng },
        source: profile.source,
        gbpNote: g ? '' : gbpError || 'Google Business Profile is not connected, so services, posts, photos and service area could not be checked.',
        searchRank,
        optimizationScore,
        market: mk,
        summary,
        checks,
        suggestions: {
          description: profile.description,
          descriptionKeywords: descTerms,
          services: profile.services?.map((s) => s.name) ?? null,
          moreServices: serviceCount == null ? null : Math.max(0, 25 - serviceCount),
          servicesWithoutDescription: profile.services ? noDesc : null,
        },
        scores,
        keywords: rows.map(({ nearby: _n, ...r }) => ({ ...r, impressions: impressions.get(r.keyword) ?? null })),
        competitors,
      }

      const { data, error } = await admin
        .from('business_audits')
        .insert({ business_id: businessId, keywords, report, created_by: user.id })
        .select('id, created_at, share_token')
        .single()
      if (error) throw new Error(error.message)
      return json({ id: data.id, createdAt: data.created_at, shareToken: data.share_token, report })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Audit failed' }, 502)
  }
})
