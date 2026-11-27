// supabase/functions/_shared/gbp.ts
// Google Business Profile API: OAuth (Connect Google), locations, all reviews, posting replies.
// Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET.
// Redirect URI registered in Google Cloud: {SUPABASE_URL}/functions/v1/google-oauth

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { functionsUrl, secretKey } from './supabase.ts'

export const SCOPES = 'openid email https://www.googleapis.com/auth/business.manage'
const COLORS = ['#9a4dff', '#7b2ff2', '#b06cff', '#5a1fb0', '#8233ea', '#3d1a7a', '#a866ff', '#6b3fa0']
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }

export const redirectUri = () => `${functionsUrl()}/google-oauth`

export function oauthConfig() {
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? ''
  if (!clientId || !clientSecret) throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set in Supabase secrets')
  return { clientId, clientSecret }
}

/* ---------- signed state (businessId, userId, return URL, expiry) ---------- */

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretKey()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))))
}

export interface OAuthState {
  b: string // business id
  u: string // user id
  r: string // where to send the user back
  e: number // expiry (ms)
}

export async function signState(s: OAuthState): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(s)))
  return `${body}.${await hmac(body)}`
}

export async function verifyState(raw: string): Promise<OAuthState | null> {
  const [body, sig] = raw.split('.')
  if (!body || !sig || (await hmac(body)) !== sig) return null
  try {
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as OAuthState
    return s.e > Date.now() ? s : null
  } catch {
    return null
  }
}

export async function authUrl(state: OAuthState): Promise<string> {
  const { clientId } = oauthConfig()
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'select_account consent', // lets the user pick which Google account; consent always returns a refresh token
    include_granted_scopes: 'true',
    state: await signState(state),
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

/* ---------- tokens ---------- */

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body?.error_description || body?.error || `Google token HTTP ${res.status}`) as Error & { code?: string }
    err.code = body?.error
    throw err
  }
  return body as { access_token: string; refresh_token?: string; id_token?: string; expires_in: number }
}

export async function exchangeCode(code: string) {
  const { clientId, clientSecret } = oauthConfig()
  const t = await tokenRequest({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(), grant_type: 'authorization_code' })
  let email = ''
  if (t.id_token) {
    try {
      email = JSON.parse(new TextDecoder().decode(fromB64url(t.id_token.split('.')[1]))).email ?? ''
    } catch {
      // email is only for display
    }
  }
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? '', email }
}

export class GoogleDisconnected extends Error {}

/** Fresh access token for a business. Removes the connection if Google revoked it. */
export async function accessTokenFor(admin: SupabaseClient, businessId: string) {
  const { data: conn } = await admin.from('google_connections').select('*').eq('business_id', businessId).maybeSingle()
  if (!conn) throw new GoogleDisconnected('Google Business Profile is not connected')
  const { clientId, clientSecret } = oauthConfig()
  try {
    const t = await tokenRequest({ refresh_token: conn.refresh_token, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' })
    return { token: t.access_token, conn }
  } catch (e) {
    if ((e as { code?: string }).code === 'invalid_grant') {
      await admin.from('google_connections').delete().eq('business_id', businessId)
      throw new GoogleDisconnected('Google access was removed. Connect Google again.')
    }
    throw e
  }
}

export async function revokeToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {})
}

/* ---------- Business Profile API ---------- */

export async function gbp(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error?.message || `Google Business Profile HTTP ${res.status}`)
  return body
}

export interface GbpLocation {
  accountName: string
  locationName: string
  title: string
  address: string
  placeId: string | null
  reviewUrl: string | null
  mapsUrl: string | null
}

/** Every location the connected Google account can manage, across all its accounts. */
export async function listLocations(token: string): Promise<GbpLocation[]> {
  const out: GbpLocation[] = []
  let accPage = ''
  do {
    const acc = await gbp(token, `https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20${accPage ? `&pageToken=${accPage}` : ''}`)
    for (const a of acc.accounts ?? []) {
      let locPage = ''
      do {
        const q = new URLSearchParams({ readMask: 'name,title,storefrontAddress,metadata', pageSize: '100' })
        if (locPage) q.set('pageToken', locPage)
        const loc = await gbp(token, `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?${q}`)
        for (const l of loc.locations ?? []) {
          const addr = l.storefrontAddress
          out.push({
            accountName: a.name,
            locationName: l.name,
            title: l.title ?? '',
            address: addr ? [...(addr.addressLines ?? []), addr.locality, addr.administrativeArea].filter(Boolean).join(', ') : '',
            placeId: l.metadata?.placeId ?? null,
            reviewUrl: l.metadata?.newReviewUri ?? null,
            mapsUrl: l.metadata?.mapsUri ?? null,
          })
        }
        locPage = loc.nextPageToken ?? ''
      } while (locPage)
    }
    accPage = acc.nextPageToken ?? ''
  } while (accPage)
  return out
}

/**
 * Links the business to one location of the signed-in Google account and takes its details from Google:
 * place id, review link, Maps link and address (and the name, if the business has none).
 */
export async function linkLocation(admin: SupabaseClient, businessId: string, l: GbpLocation) {
  await admin
    .from('google_connections')
    .update({ account_name: l.accountName, location_name: l.locationName, location_title: l.title })
    .eq('business_id', businessId)
  const { data: b } = await admin.from('businesses').select('name').eq('id', businessId).single()
  const patch: Record<string, string> = {}
  if (l.placeId) patch.place_id = l.placeId
  if (l.reviewUrl || l.placeId) patch.review_link = l.reviewUrl ?? `https://search.google.com/local/writereview?placeid=${l.placeId}`
  if (l.mapsUrl) patch.maps_url = l.mapsUrl
  else if (l.placeId) patch.maps_url = `https://www.google.com/maps/place/?q=place_id:${l.placeId}`
  if (l.address) patch.address = l.address
  if (!b?.name?.trim() && l.title) patch.name = l.title
  if (Object.keys(patch).length) await admin.from('businesses').update(patch).eq('id', businessId)
}

/** Pulls every review (up to 2,000) for the connected location into the reviews table. */
export async function syncReviews(admin: SupabaseClient, businessId: string) {
  const { token, conn } = await accessTokenFor(admin, businessId)
  if (!conn.account_name || !conn.location_name) throw new Error('Choose which Google business to use first')

  const base = `https://mybusiness.googleapis.com/v4/${conn.account_name}/${conn.location_name}/reviews`
  const reviews: Array<Record<string, any>> = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  let page = ''
  let average: number | null = null
  let total: number | null = null
  for (let i = 0; i < 40; i++) {
    const body = await gbp(token, `${base}?pageSize=50${page ? `&pageToken=${page}` : ''}`)
    reviews.push(...(body.reviews ?? []))
    average = body.averageRating ?? average
    total = body.totalReviewCount ?? total
    page = body.nextPageToken ?? ''
    if (!page) break
  }

  // Reviews imported earlier from the Places API have different ids; the full list replaces them.
  await admin.from('reviews').delete().eq('business_id', businessId).like('google_review_id', 'places/%')

  const { data: existing } = await admin.from('reviews').select('google_review_id').eq('business_id', businessId).not('google_review_id', 'is', null)
  const known = new Set((existing ?? []).map((r) => r.google_review_id))

  const rows = reviews
    .filter((r) => r.reviewId && STARS[r.starRating])
    .map((r, i) => ({
      business_id: businessId,
      google_review_id: r.reviewId as string,
      author: r.reviewer?.isAnonymous ? 'Google user' : r.reviewer?.displayName || 'Google user',
      author_photo_url: r.reviewer?.profilePhotoUrl ?? null,
      avatar_color: COLORS[i % COLORS.length],
      rating: STARS[r.starRating],
      text: r.comment ?? '',
      url: '',
      review_created_at: r.createTime ?? new Date().toISOString(),
      // The reply that is live on Google is the truth
      reply_text: r.reviewReply?.comment ?? null,
      reply_source: r.reviewReply ? 'google' : null,
      reply_at: r.reviewReply?.updateTime ?? null,
    }))

  // Keep local drafts on reviews with no reply on Google yet, and keep "sent from here" on our own replies
  const { data: local } = await admin
    .from('reviews')
    .select('google_review_id, reply_text, reply_source, reply_at')
    .eq('business_id', businessId)
    .in('reply_source', ['draft', 'app'])
  const localMap = new Map((local ?? []).map((d) => [d.google_review_id, d]))
  for (const row of rows) {
    const d = localMap.get(row.google_review_id)
    if (!d) continue
    if (!row.reply_text && d.reply_source === 'draft') Object.assign(row, { reply_text: d.reply_text, reply_source: 'draft', reply_at: d.reply_at })
    else if (row.reply_text && d.reply_source === 'app' && d.reply_text?.trim() === row.reply_text.trim()) row.reply_source = 'app'
  }

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from('reviews').upsert(rows.slice(i, i + 200), { onConflict: 'business_id,google_review_id' })
    if (error) throw new Error(error.message)
  }
  const added = known.size ? rows.filter((r) => !known.has(r.google_review_id)).length : 0
  const now = new Date().toISOString()

  await admin.from('businesses').update({ google_rating: average, google_review_count: total, google_synced_at: now }).eq('id', businessId)
  await admin.from('google_connections').update({ last_sync_at: now }).eq('business_id', businessId)

  if (added) {
    await admin.from('notifications').insert({
      business_id: businessId,
      type: 'new_review',
      title: `${added} new Google review${added > 1 ? 's' : ''}`,
      body: 'Synced from your Google Business Profile.',
    })
  }
  return { synced: rows.length, added, rating: average, total }
}

/** Removes the owner reply on Google, then locally. */
export async function deleteReply(admin: SupabaseClient, businessId: string, reviewRowId: string) {
  const { data: review } = await admin.from('reviews').select('id, google_review_id').eq('id', reviewRowId).eq('business_id', businessId).maybeSingle()
  if (!review?.google_review_id || review.google_review_id.startsWith('places/')) throw new Error('Sync reviews from Google first')
  const { token, conn } = await accessTokenFor(admin, businessId)
  if (!conn.account_name || !conn.location_name) throw new Error('Choose which Google business to use first')
  await gbp(token, `https://mybusiness.googleapis.com/v4/${conn.account_name}/${conn.location_name}/reviews/${review.google_review_id}/reply`, { method: 'DELETE' })
  await admin.from('reviews').update({ reply_text: null, reply_source: null, reply_at: null }).eq('id', review.id)
}

/** Posts (or updates) the owner reply on Google, then saves it locally. */
export async function postReply(admin: SupabaseClient, businessId: string, reviewRowId: string, comment: string) {
  const { data: review } = await admin.from('reviews').select('id, google_review_id').eq('id', reviewRowId).eq('business_id', businessId).maybeSingle()
  if (!review?.google_review_id || review.google_review_id.startsWith('places/')) throw new Error('Sync reviews from Google first, then reply')
  const { token, conn } = await accessTokenFor(admin, businessId)
  if (!conn.account_name || !conn.location_name) throw new Error('Choose which Google business to use first')
  const res = await gbp(token, `https://mybusiness.googleapis.com/v4/${conn.account_name}/${conn.location_name}/reviews/${review.google_review_id}/reply`, {
    method: 'PUT',
    body: JSON.stringify({ comment }),
  })
  const at = res.updateTime ?? new Date().toISOString()
  await admin.from('reviews').update({ reply_text: comment, reply_source: 'app', reply_at: at }).eq('id', review.id)
  return { at }
}
