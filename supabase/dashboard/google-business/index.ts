// supabase/dashboard/google-business/index.ts
// @ts-nocheck
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
async function getUser(req, admin) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}
async function isMember(admin, userId, businessId) {
  const [{ data: member }, { data: profile }] = await Promise.all([
    admin.from("business_members").select("user_id").eq("business_id", businessId).eq("user_id", userId).maybeSingle(),
    admin.from("profiles").select("is_platform_admin").eq("id", userId).maybeSingle()
  ]);
  return !!member || !!profile?.is_platform_admin;
}
function functionsUrl() {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
}

// supabase/functions/_shared/http.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra }
  });
}
function preflight(req) {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

// supabase/functions/_shared/gbp.ts
var SCOPES = "openid email https://www.googleapis.com/auth/business.manage";
var COLORS = ["#9a4dff", "#7b2ff2", "#b06cff", "#5a1fb0", "#8233ea", "#3d1a7a", "#a866ff", "#6b3fa0"];
var STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
var redirectUri = () => `${functionsUrl()}/google-oauth`;
function oauthConfig() {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set in Supabase secrets");
  return { clientId, clientSecret };
}
var b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secretKey()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}
async function signState(s) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(s)));
  return `${body}.${await hmac(body)}`;
}
async function authUrl(state) {
  const { clientId } = oauthConfig();
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "select_account consent",
    // lets the user pick which Google account; consent always returns a refresh token
    include_granted_scopes: "true",
    state: await signState(state)
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
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
var GoogleDisconnected = class extends Error {
};
async function accessTokenFor(admin, businessId) {
  const { data: conn } = await admin.from("google_connections").select("*").eq("business_id", businessId).maybeSingle();
  if (!conn) throw new GoogleDisconnected("Google Business Profile is not connected");
  const { clientId, clientSecret } = oauthConfig();
  try {
    const t = await tokenRequest({ refresh_token: conn.refresh_token, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" });
    return { token: t.access_token, conn };
  } catch (e) {
    if (e.code === "invalid_grant") {
      await admin.from("google_connections").delete().eq("business_id", businessId);
      throw new GoogleDisconnected("Google access was removed. Connect Google again.");
    }
    throw e;
  }
}
async function revokeToken(token) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {
  });
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
async function linkLocation(admin, businessId, l) {
  await admin.from("google_connections").update({ account_name: l.accountName, location_name: l.locationName, location_title: l.title }).eq("business_id", businessId);
  const { data: b } = await admin.from("businesses").select("name").eq("id", businessId).single();
  const patch = {};
  if (l.placeId) patch.place_id = l.placeId;
  if (l.reviewUrl || l.placeId) patch.review_link = l.reviewUrl ?? `https://search.google.com/local/writereview?placeid=${l.placeId}`;
  if (l.mapsUrl) patch.maps_url = l.mapsUrl;
  else if (l.placeId) patch.maps_url = `https://www.google.com/maps/place/?q=place_id:${l.placeId}`;
  if (l.address) patch.address = l.address;
  if (!b?.name?.trim() && l.title) patch.name = l.title;
  if (Object.keys(patch).length) await admin.from("businesses").update(patch).eq("id", businessId);
}
async function syncReviews(admin, businessId) {
  const { token, conn } = await accessTokenFor(admin, businessId);
  if (!conn.account_name || !conn.location_name) throw new Error("Choose which Google business to use first");
  const base = `https://mybusiness.googleapis.com/v4/${conn.account_name}/${conn.location_name}/reviews`;
  const reviews = [];
  let page = "";
  let average = null;
  let total = null;
  for (let i = 0; i < 40; i++) {
    const body = await gbp(token, `${base}?pageSize=50${page ? `&pageToken=${page}` : ""}`);
    reviews.push(...body.reviews ?? []);
    average = body.averageRating ?? average;
    total = body.totalReviewCount ?? total;
    page = body.nextPageToken ?? "";
    if (!page) break;
  }
  await admin.from("reviews").delete().eq("business_id", businessId).like("google_review_id", "places/%");
  const { data: existing } = await admin.from("reviews").select("google_review_id").eq("business_id", businessId).not("google_review_id", "is", null);
  const known = new Set((existing ?? []).map((r) => r.google_review_id));
  const rows = reviews.filter((r) => r.reviewId && STARS[r.starRating]).map((r, i) => ({
    business_id: businessId,
    google_review_id: r.reviewId,
    author: r.reviewer?.isAnonymous ? "Google user" : r.reviewer?.displayName || "Google user",
    author_photo_url: r.reviewer?.profilePhotoUrl ?? null,
    avatar_color: COLORS[i % COLORS.length],
    rating: STARS[r.starRating],
    text: r.comment ?? "",
    url: "",
    review_created_at: r.createTime ?? (/* @__PURE__ */ new Date()).toISOString(),
    // The reply that is live on Google is the truth
    reply_text: r.reviewReply?.comment ?? null,
    reply_source: r.reviewReply ? "google" : null,
    reply_at: r.reviewReply?.updateTime ?? null
  }));
  const { data: local } = await admin.from("reviews").select("google_review_id, reply_text, reply_source, reply_at").eq("business_id", businessId).in("reply_source", ["draft", "app"]);
  const localMap = new Map((local ?? []).map((d) => [d.google_review_id, d]));
  for (const row of rows) {
    const d = localMap.get(row.google_review_id);
    if (!d) continue;
    if (!row.reply_text && d.reply_source === "draft") Object.assign(row, { reply_text: d.reply_text, reply_source: "draft", reply_at: d.reply_at });
    else if (row.reply_text && d.reply_source === "app" && d.reply_text?.trim() === row.reply_text.trim()) row.reply_source = "app";
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from("reviews").upsert(rows.slice(i, i + 200), { onConflict: "business_id,google_review_id" });
    if (error) throw new Error(error.message);
  }
  const added = known.size ? rows.filter((r) => !known.has(r.google_review_id)).length : 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await admin.from("businesses").update({ google_rating: average, google_review_count: total, google_synced_at: now }).eq("id", businessId);
  await admin.from("google_connections").update({ last_sync_at: now }).eq("business_id", businessId);
  if (added) {
    await admin.from("notifications").insert({
      business_id: businessId,
      type: "new_review",
      title: `${added} new Google review${added > 1 ? "s" : ""}`,
      body: "Synced from your Google Business Profile."
    });
  }
  return { synced: rows.length, added, rating: average, total };
}
async function deleteReply(admin, businessId, reviewRowId) {
  const { data: review } = await admin.from("reviews").select("id, google_review_id").eq("id", reviewRowId).eq("business_id", businessId).maybeSingle();
  if (!review?.google_review_id || review.google_review_id.startsWith("places/")) throw new Error("Sync reviews from Google first");
  const { token, conn } = await accessTokenFor(admin, businessId);
  if (!conn.account_name || !conn.location_name) throw new Error("Choose which Google business to use first");
  await gbp(token, `https://mybusiness.googleapis.com/v4/${conn.account_name}/${conn.location_name}/reviews/${review.google_review_id}/reply`, { method: "DELETE" });
  await admin.from("reviews").update({ reply_text: null, reply_source: null, reply_at: null }).eq("id", review.id);
}
async function postReply(admin, businessId, reviewRowId, comment) {
  const { data: review } = await admin.from("reviews").select("id, google_review_id").eq("id", reviewRowId).eq("business_id", businessId).maybeSingle();
  if (!review?.google_review_id || review.google_review_id.startsWith("places/")) throw new Error("Sync reviews from Google first, then reply");
  const { token, conn } = await accessTokenFor(admin, businessId);
  if (!conn.account_name || !conn.location_name) throw new Error("Choose which Google business to use first");
  const res = await gbp(token, `https://mybusiness.googleapis.com/v4/${conn.account_name}/${conn.location_name}/reviews/${review.google_review_id}/reply`, {
    method: "PUT",
    body: JSON.stringify({ comment })
  });
  const at = res.updateTime ?? (/* @__PURE__ */ new Date()).toISOString();
  await admin.from("reviews").update({ reply_text: comment, reply_source: "app", reply_at: at }).eq("id", review.id);
  return { at };
}

// supabase/functions/google-business/index.ts
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const admin = adminClient();
  const user = await getUser(req, admin);
  if (!user) return json({ error: "Sign in required" }, 401);
  const input = await req.json().catch(() => ({}));
  const businessId = input.businessId;
  if (!businessId) return json({ error: "businessId is required" }, 400);
  if (!await isMember(admin, user.id, businessId)) return json({ error: "Not allowed" }, 403);
  try {
    switch (input.action) {
      case "status": {
        const { data: c } = await admin.from("google_connections").select("google_email, location_name, location_title, last_sync_at").eq("business_id", businessId).maybeSingle();
        return json({
          connected: !!c,
          email: c?.google_email ?? "",
          locationTitle: c?.location_title ?? "",
          needsLocation: !!c && !c.location_name,
          lastSyncAt: c?.last_sync_at ?? null
        });
      }
      case "auth_url": {
        if (!input.returnUrl || !/^https?:\/\//.test(input.returnUrl)) return json({ error: "returnUrl is required" }, 400);
        const url = await authUrl({ b: businessId, u: user.id, r: input.returnUrl, e: Date.now() + 15 * 6e4 });
        return json({ url });
      }
      case "locations": {
        const { token } = await accessTokenFor(admin, businessId);
        return json({ locations: await listLocations(token) });
      }
      case "select_location": {
        const l = input.location;
        if (!l?.accountName?.startsWith("accounts/") || !l.locationName?.startsWith("locations/")) return json({ error: "Pick a location" }, 400);
        const { token } = await accessTokenFor(admin, businessId);
        const match = (await listLocations(token)).find((x) => x.locationName === l.locationName && x.accountName === l.accountName);
        if (!match) return json({ error: "That location is not on the connected Google account" }, 400);
        await linkLocation(admin, businessId, match);
        return json({ ok: true, locationTitle: match.title });
      }
      case "sync":
        return json({ ok: true, ...await syncReviews(admin, businessId) });
      case "reply": {
        const comment = (input.comment ?? "").trim();
        if (!input.reviewId || !comment) return json({ error: "reviewId and comment are required" }, 400);
        if (comment.length > 4e3) return json({ error: "Reply is too long (4,000 characters max)" }, 400);
        return json({ ok: true, ...await postReply(admin, businessId, input.reviewId, comment) });
      }
      case "delete_reply": {
        if (!input.reviewId) return json({ error: "reviewId is required" }, 400);
        await deleteReply(admin, businessId, input.reviewId);
        return json({ ok: true });
      }
      case "disconnect": {
        const { data: c } = await admin.from("google_connections").select("refresh_token").eq("business_id", businessId).maybeSingle();
        if (c?.refresh_token) await revokeToken(c.refresh_token);
        await admin.from("google_connections").delete().eq("business_id", businessId);
        return json({ ok: true });
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof GoogleDisconnected) return json({ error: e.message, disconnected: true }, 409);
    return json({ error: e instanceof Error ? e.message : "Google request failed" }, 502);
  }
});
