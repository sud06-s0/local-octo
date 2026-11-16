// supabase/functions/google-oauth/index.ts
// Redirect URI for "Connect Google" (must match Google Cloud → Clients → Authorised redirect URIs).
// Google sends the user here with ?code&state. We save the refresh token, pick the location if the
// account has only one, and send the user back to the app with ?google=connected | choose | error.

import { adminClient } from '../_shared/supabase.ts'
import { exchangeCode, listLocations, verifyState } from '../_shared/gbp.ts'

function back(returnUrl: string, status: string, message = '') {
  let url: URL
  try {
    url = new URL(returnUrl)
  } catch {
    return new Response(message || status, { status: 400 })
  }
  url.searchParams.set('google', status)
  if (message) url.searchParams.set('google_message', message.slice(0, 200))
  return new Response(null, { status: 302, headers: { Location: url.toString() } })
}

Deno.serve(async (req) => {
  const q = new URL(req.url).searchParams
  const state = await verifyState(q.get('state') ?? '')
  if (!state) return new Response('This Google sign-in link has expired. Go back to the app and click Connect again.', { status: 400 })
  if (q.get('error')) return back(state.r, 'error', q.get('error') === 'access_denied' ? 'Google access was not allowed' : q.get('error')!)

  const code = q.get('code')
  if (!code) return back(state.r, 'error', 'Google did not return a code')

  const admin = adminClient()
  try {
    const { accessToken, refreshToken, email } = await exchangeCode(code)
    if (!refreshToken) return back(state.r, 'error', 'Google did not return offline access. Try Connect again.')

    await admin.from('google_connections').upsert({
      business_id: state.b,
      google_email: email,
      refresh_token: refreshToken,
      account_name: null,
      location_name: null,
      location_title: '',
      connected_by: state.u,
      connected_at: new Date().toISOString(),
      last_sync_at: null,
    })

    // One location → use it straight away. Several → the app asks which one.
    const locations = await listLocations(accessToken).catch(() => [])
    if (locations.length === 1) {
      const l = locations[0]
      await admin
        .from('google_connections')
        .update({ account_name: l.accountName, location_name: l.locationName, location_title: l.title })
        .eq('business_id', state.b)
      return back(state.r, 'connected')
    }
    return back(state.r, locations.length ? 'choose' : 'error', locations.length ? '' : 'No Google Business Profile found on this Google account')
  } catch (e) {
    return back(state.r, 'error', e instanceof Error ? e.message : 'Google sign-in failed')
  }
})
