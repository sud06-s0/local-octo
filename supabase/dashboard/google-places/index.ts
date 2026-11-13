// supabase/dashboard/google-places/index.ts
// Self-contained copy of supabase/functions/google-places for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: google-places   ·   Turn OFF "Verify JWT" for this function.
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

// supabase/functions/google-places/index.ts
var API = "https://places.googleapis.com/v1";
var COLORS = ["#2f8c4a", "#c2410c", "#7c3aed", "#0369a1", "#be185d", "#0f766e", "#a16207", "#4338ca"];
async function places(path, init) {
  const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set in Supabase secrets");
  const { fields, ...rest } = init;
  const res = await fetch(`${API}/${path}`, {
    ...rest,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fields, ...rest.headers ?? {} }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? `Google Places HTTP ${res.status}`);
  return body;
}
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const admin = adminClient();
  const user = await getUser(req, admin);
  if (!user) return json({ error: "Sign in required" }, 401);
  const input = await req.json().catch(() => ({}));
  try {
    if (input.action === "search") {
      const query = (input.query ?? "").trim();
      if (query.length < 3) return json({ results: [] });
      const body = await places("places:searchText", {
        method: "POST",
        fields: "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount",
        body: JSON.stringify({ textQuery: query, languageCode: "en", regionCode: "IN", pageSize: 6 })
      });
      const results = (body.places ?? []).map((p) => ({
        // eslint-disable-line @typescript-eslint/no-explicit-any
        placeId: p.id,
        name: p.displayName?.text ?? "",
        address: p.formattedAddress ?? "",
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? 0
      }));
      return json({ results });
    }
    if (input.action === "import") {
      const { businessId, placeId } = input;
      if (!businessId || !placeId || !/^[\w-]{10,}$/.test(placeId)) return json({ error: "businessId and placeId are required" }, 400);
      if (!await isMember(admin, user.id, businessId)) return json({ error: "Not allowed" }, 403);
      const p = await places(`places/${placeId}?languageCode=en`, {
        method: "GET",
        fields: "id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,googleMapsUri,rating,userRatingCount,reviews"
      });
      await admin.from("businesses").update({
        address: p.formattedAddress ?? "",
        place_id: p.id,
        review_link: `https://search.google.com/local/writereview?placeid=${p.id}`,
        maps_url: p.googleMapsUri ?? "",
        phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? "",
        website: p.websiteUri ?? "",
        google_rating: p.rating ?? null,
        google_review_count: p.userRatingCount ?? null,
        google_synced_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", businessId);
      const reviews = p.reviews ?? [];
      const { data: existing } = await admin.from("reviews").select("google_review_id").eq("business_id", businessId).not("google_review_id", "is", null);
      const known = new Set((existing ?? []).map((r) => r.google_review_id));
      const rows = reviews.filter((r) => r.name && r.rating).map((r, i) => ({
        business_id: businessId,
        google_review_id: r.name,
        author: r.authorAttribution?.displayName || "Google user",
        author_photo_url: r.authorAttribution?.photoUri ?? null,
        avatar_color: COLORS[i % COLORS.length],
        rating: Math.round(r.rating),
        text: r.originalText?.text ?? r.text?.text ?? "",
        url: r.googleMapsUri ?? r.authorAttribution?.uri ?? "",
        review_created_at: r.publishTime ?? (/* @__PURE__ */ new Date()).toISOString()
      }));
      if (rows.length) await admin.from("reviews").upsert(rows, { onConflict: "business_id,google_review_id" });
      const added = rows.filter((r) => !known.has(r.google_review_id)).length;
      if (added) {
        await admin.from("notifications").insert({
          business_id: businessId,
          type: "system",
          title: "Google reviews imported",
          body: `${added} review${added > 1 ? "s" : ""} imported from Google.`
        });
      }
      return json({
        ok: true,
        name: p.displayName?.text ?? "",
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? 0,
        imported: rows.length,
        added
      });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Google request failed" }, 502);
  }
});
