// supabase/dashboard/google-oauth/index.ts
// Self-contained copy of supabase/functions/google-oauth for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: google-oauth   ·   Turn OFF "Verify JWT" for this function.
// @ts-nocheck  (bundled JavaScript — the typed source lives in supabase/functions)

// supabase/functions/_shared/supabase.ts
import { createClient } from "npm:@supabase/supabase-js@2";
function secretKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const keys = JSON.parse(raw);
      const key = keys.default ?? Object.values(keys)[0];
      if (key) return key;
    } catch {
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacy) throw new Error("No Supabase secret key in environment");
  return legacy;
}
function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL"), secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
function functionsUrl() {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
}

// supabase/functions/_shared/gbp.ts
var redirectUri = () => `${functionsUrl()}/google-oauth`;
function oauthConfig() {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set in Supabase secrets");
  return { clientId, clientSecret };
}
var b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
var fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function hmac(value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secretKey()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}
async function verifyState(raw) {
  const [body, sig] = raw.split(".");
  if (!body || !sig || await hmac(body) !== sig) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return s.e > Date.now() ? s : null;
  } catch {
    return null;
  }
}
async function tokenRequest(params) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error_description || body?.error || `Google token HTTP ${res.status}`);
    err.code = body?.error;
    throw err;
  }
  return body;
}
async function exchangeCode(code) {
  const { clientId, clientSecret } = oauthConfig();
  const t = await tokenRequest({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code" });
  let email = "";
  if (t.id_token) {
    try {
      email = JSON.parse(new TextDecoder().decode(fromB64url(t.id_token.split(".")[1]))).email ?? "";
    } catch {
    }
  }
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? "", email };
}
async function gbp(token, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers ?? {} } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Google Business Profile HTTP ${res.status}`);
  return body;
}
async function listLocations(token) {
  const out = [];
  let accPage = "";
  do {
    const acc = await gbp(token, `https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20${accPage ? `&pageToken=${accPage}` : ""}`);
    for (const a of acc.accounts ?? []) {
      let locPage = "";
      do {
        const q = new URLSearchParams({ readMask: "name,title,storefrontAddress,metadata", pageSize: "100" });
        if (locPage) q.set("pageToken", locPage);
        const loc = await gbp(token, `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?${q}`);
        for (const l of loc.locations ?? []) {
          const addr = l.storefrontAddress;
          out.push({
            accountName: a.name,
            locationName: l.name,
            title: l.title ?? "",
            address: addr ? [...addr.addressLines ?? [], addr.locality, addr.administrativeArea].filter(Boolean).join(", ") : "",
            placeId: l.metadata?.placeId ?? null,
            reviewUrl: l.metadata?.newReviewUri ?? null,
            mapsUrl: l.metadata?.mapsUri ?? null
          });
        }
        locPage = loc.nextPageToken ?? "";
      } while (locPage);
    }
    accPage = acc.nextPageToken ?? "";
  } while (accPage);
  return out;
}

// supabase/functions/google-oauth/index.ts
function back(returnUrl, status, message = "") {
  let url;
  try {
    url = new URL(returnUrl);
  } catch {
    return new Response(message || status, { status: 400 });
  }
  url.searchParams.set("google", status);
  if (message) url.searchParams.set("google_message", message.slice(0, 200));
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}
Deno.serve(async (req) => {
  const q = new URL(req.url).searchParams;
  const state = await verifyState(q.get("state") ?? "");
  if (!state) return new Response("This Google sign-in link has expired. Go back to the app and click Connect again.", { status: 400 });
  if (q.get("error")) return back(state.r, "error", q.get("error") === "access_denied" ? "Google access was not allowed" : q.get("error"));
  const code = q.get("code");
  if (!code) return back(state.r, "error", "Google did not return a code");
  const admin = adminClient();
  try {
    const { accessToken, refreshToken, email } = await exchangeCode(code);
    if (!refreshToken) return back(state.r, "error", "Google did not return offline access. Try Connect again.");
    await admin.from("google_connections").upsert({
      business_id: state.b,
      google_email: email,
      refresh_token: refreshToken,
      account_name: null,
      location_name: null,
      location_title: "",
      connected_by: state.u,
      connected_at: (/* @__PURE__ */ new Date()).toISOString(),
      last_sync_at: null
    });
    const locations = await listLocations(accessToken).catch(() => []);
    if (locations.length === 1) {
      const l = locations[0];
      await admin.from("google_connections").update({ account_name: l.accountName, location_name: l.locationName, location_title: l.title }).eq("business_id", state.b);
      return back(state.r, "connected");
    }
    return back(state.r, locations.length ? "choose" : "error", locations.length ? "" : "No Google Business Profile found on this Google account");
  } catch (e) {
    return back(state.r, "error", e instanceof Error ? e.message : "Google sign-in failed");
  }
});
