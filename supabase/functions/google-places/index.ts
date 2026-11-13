// supabase/functions/google-places/index.ts
// "Find your business on Google" with the Places API (New). Needs secret GOOGLE_PLACES_API_KEY.
// Body: { action: 'search', query }                 -> matching businesses
//       { action: 'import', businessId, placeId }   -> saves profile details + rating + latest reviews (Google returns up to 5)

import { adminClient, getUser, isMember } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'

const API = 'https://places.googleapis.com/v1'
const COLORS = ['#2f8c4a', '#c2410c', '#7c3aed', '#0369a1', '#be185d', '#0f766e', '#a16207', '#4338ca']

interface GoogleReview {
  name?: string // places/{place}/reviews/{review}
  rating?: number
  text?: { text?: string }
  originalText?: { text?: string }
  authorAttribution?: { displayName?: string; uri?: string; photoUri?: string }
  publishTime?: string
  googleMapsUri?: string
}

async function places(path: string, init: RequestInit & { fields: string }) {
  const key = Deno.env.get('GOOGLE_PLACES_API_KEY')
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY is not set in Supabase secrets')
  const { fields, ...rest } = init
  const res = await fetch(`${API}/${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fields, ...(rest.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error?.message ?? `Google Places HTTP ${res.status}`)
  return body
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const admin = adminClient()
  const user = await getUser(req, admin)
  if (!user) return json({ error: 'Sign in required' }, 401)

  const input = (await req.json().catch(() => ({}))) as { action?: string; query?: string; businessId?: string; placeId?: string }

  try {
    if (input.action === 'search') {
      const query = (input.query ?? '').trim()
      if (query.length < 3) return json({ results: [] })
      const body = await places('places:searchText', {
        method: 'POST',
        fields: 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount',
        body: JSON.stringify({ textQuery: query, languageCode: 'en', regionCode: 'IN', pageSize: 6 }),
      })
      const results = (body.places ?? []).map((p: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        placeId: p.id,
        name: p.displayName?.text ?? '',
        address: p.formattedAddress ?? '',
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? 0,
      }))
      return json({ results })
    }

    if (input.action === 'import') {
      const { businessId, placeId } = input
      if (!businessId || !placeId || !/^[\w-]{10,}$/.test(placeId)) return json({ error: 'businessId and placeId are required' }, 400)
      if (!(await isMember(admin, user.id, businessId))) return json({ error: 'Not allowed' }, 403)

      const p = await places(`places/${placeId}?languageCode=en`, {
        method: 'GET',
        fields: 'id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,googleMapsUri,rating,userRatingCount,reviews',
      })

      await admin
        .from('businesses')
        .update({
          address: p.formattedAddress ?? '',
          place_id: p.id,
          review_link: `https://search.google.com/local/writereview?placeid=${p.id}`,
          maps_url: p.googleMapsUri ?? '',
          phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? '',
          website: p.websiteUri ?? '',
          google_rating: p.rating ?? null,
          google_review_count: p.userRatingCount ?? null,
          google_synced_at: new Date().toISOString(),
        })
        .eq('id', businessId)

      // Latest reviews (Google returns up to 5). Replies are kept: only Google's own fields are updated.
      const reviews = (p.reviews ?? []) as GoogleReview[]
      const { data: existing } = await admin.from('reviews').select('google_review_id').eq('business_id', businessId).not('google_review_id', 'is', null)
      const known = new Set((existing ?? []).map((r) => r.google_review_id))
      const rows = reviews
        .filter((r) => r.name && r.rating)
        .map((r, i) => ({
          business_id: businessId,
          google_review_id: r.name!,
          author: r.authorAttribution?.displayName || 'Google user',
          author_photo_url: r.authorAttribution?.photoUri ?? null,
          avatar_color: COLORS[i % COLORS.length],
          rating: Math.round(r.rating!),
          text: r.originalText?.text ?? r.text?.text ?? '',
          url: r.googleMapsUri ?? r.authorAttribution?.uri ?? '',
          review_created_at: r.publishTime ?? new Date().toISOString(),
        }))
      if (rows.length) await admin.from('reviews').upsert(rows, { onConflict: 'business_id,google_review_id' })
      const added = rows.filter((r) => !known.has(r.google_review_id)).length

      if (added) {
        await admin.from('notifications').insert({
          business_id: businessId,
          type: 'system',
          title: 'Google reviews imported',
          body: `${added} review${added > 1 ? 's' : ''} imported from Google.`,
        })
      }

      return json({
        ok: true,
        name: p.displayName?.text ?? '',
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? 0,
        imported: rows.length,
        added,
      })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Google request failed' }, 502)
  }
})
