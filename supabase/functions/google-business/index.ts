// supabase/functions/google-business/index.ts
// Google Business Profile for one business. Body: { businessId, action, ... }
//  - status                         → { connected, email, locationTitle, needsLocation, lastSyncAt }
//  - auth_url { returnUrl }         → { url } to send the user to Google
//  - locations                      → every location the connected account manages
//  - select_location { location }   → use that location; its place id, review link, Maps link and address come from Google
//  - sync                           → pulls all reviews + rating
//  - reply { reviewId, comment }    → posts the reply on Google
//  - delete_reply { reviewId }      → removes the reply on Google
//  - disconnect                     → revokes access and forgets the connection

import { adminClient, getUser, isMember } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/http.ts'
import { accessTokenFor, authUrl, deleteReply, GoogleDisconnected, linkLocation, listLocations, postReply, revokeToken, syncReviews, type GbpLocation } from '../_shared/gbp.ts'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const admin = adminClient()
  const user = await getUser(req, admin)
  if (!user) return json({ error: 'Sign in required' }, 401)

  const input = (await req.json().catch(() => ({}))) as {
    businessId?: string
    action?: string
    returnUrl?: string
    location?: GbpLocation
    reviewId?: string
    comment?: string
  }
  const businessId = input.businessId
  if (!businessId) return json({ error: 'businessId is required' }, 400)
  if (!(await isMember(admin, user.id, businessId))) return json({ error: 'Not allowed' }, 403)

  try {
    switch (input.action) {
      case 'status': {
        const { data: c } = await admin
          .from('google_connections')
          .select('google_email, location_name, location_title, last_sync_at')
          .eq('business_id', businessId)
          .maybeSingle()
        return json({
          connected: !!c,
          email: c?.google_email ?? '',
          locationTitle: c?.location_title ?? '',
          needsLocation: !!c && !c.location_name,
          lastSyncAt: c?.last_sync_at ?? null,
        })
      }

      case 'auth_url': {
        if (!input.returnUrl || !/^https?:\/\//.test(input.returnUrl)) return json({ error: 'returnUrl is required' }, 400)
        const url = await authUrl({ b: businessId, u: user.id, r: input.returnUrl, e: Date.now() + 15 * 60_000 })
        return json({ url })
      }

      case 'locations': {
        const { token } = await accessTokenFor(admin, businessId)
        return json({ locations: await listLocations(token) })
      }

      case 'select_location': {
        const l = input.location
        if (!l?.accountName?.startsWith('accounts/') || !l.locationName?.startsWith('locations/')) return json({ error: 'Pick a location' }, 400)
        // Check it really belongs to the connected Google account
        const { token } = await accessTokenFor(admin, businessId)
        const match = (await listLocations(token)).find((x) => x.locationName === l.locationName && x.accountName === l.accountName)
        if (!match) return json({ error: 'That location is not on the connected Google account' }, 400)

        await linkLocation(admin, businessId, match)
        return json({ ok: true, locationTitle: match.title })
      }

      case 'sync':
        return json({ ok: true, ...(await syncReviews(admin, businessId)) })

      case 'reply': {
        const comment = (input.comment ?? '').trim()
        if (!input.reviewId || !comment) return json({ error: 'reviewId and comment are required' }, 400)
        if (comment.length > 4000) return json({ error: 'Reply is too long (4,000 characters max)' }, 400)
        return json({ ok: true, ...(await postReply(admin, businessId, input.reviewId, comment)) })
      }

      case 'delete_reply': {
        if (!input.reviewId) return json({ error: 'reviewId is required' }, 400)
        await deleteReply(admin, businessId, input.reviewId)
        return json({ ok: true })
      }

      case 'disconnect': {
        const { data: c } = await admin.from('google_connections').select('refresh_token').eq('business_id', businessId).maybeSingle()
        if (c?.refresh_token) await revokeToken(c.refresh_token)
        await admin.from('google_connections').delete().eq('business_id', businessId)
        return json({ ok: true })
      }

      default:
        return json({ error: 'Unknown action' }, 400)
    }
  } catch (e) {
    if (e instanceof GoogleDisconnected) return json({ error: e.message, disconnected: true }, 409)
    return json({ error: e instanceof Error ? e.message : 'Google request failed' }, 502)
  }
})
