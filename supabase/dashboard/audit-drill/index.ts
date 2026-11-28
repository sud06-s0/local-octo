// supabase/dashboard/audit-drill/index.ts
// Self-contained copy of supabase/functions/audit-drill for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: audit-drill   ·   Turn OFF "Verify JWT" for this function.
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

// supabase/functions/audit-drill/index.ts
function gridPoint(lat, lng, size, stepKm, i) {
  const dLat = stepKm / 111.32;
  const dLng = stepKm / (111.32 * Math.cos(lat * Math.PI / 180));
  const half = (size - 1) / 2;
  const row = Math.floor(i / size);
  const col = i % size;
  return { lat: lat + (half - row) * dLat, lng: lng + (col - half) * dLng };
}
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "GET") return json({ error: "Use GET" }, 405);
  const q = new URL(req.url).searchParams;
  const token = q.get("t") ?? "";
  const k = Number(q.get("k"));
  const i = Number(q.get("i"));
  if (!/^[a-f0-9]{24}$/.test(token) || !Number.isInteger(k) || !Number.isInteger(i) || k < 0 || i < 0) return json({ error: "Bad request" }, 400);
  const admin = adminClient();
  const { data: audit } = await admin.from("business_audits").select("id, business_id, report").eq("share_token", token).maybeSingle();
  if (!audit) return json({ error: "Report not found" }, 404);
  const report = audit.report;
  const kw = report?.keywords?.[k];
  const lat = report?.business?.lat;
  const lng = report?.business?.lng;
  const size = kw?.size ?? 3;
  if (!kw || lat == null || lng == null || i >= size * size) return json({ error: "Dot not found" }, 404);
  const { data: cached } = await admin.from("audit_drilldowns").select("results").eq("audit_id", audit.id).eq("keyword_idx", k).eq("point_idx", i).maybeSingle();
  const c = cached?.results;
  if (c && !Array.isArray(c) && Array.isArray(c.rows)) return json(c, 200, { "Cache-Control": "public, max-age=3600" });
  const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!key) return json({ error: "GOOGLE_PLACES_API_KEY is not set" }, 500);
  const { data: biz } = await admin.from("businesses").select("place_id").eq("id", audit.business_id).maybeSingle();
  const pt = gridPoint(lat, lng, size, kw.stepKm ?? 1.5, i);
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.rating,places.userRatingCount"
    },
    body: JSON.stringify({
      textQuery: kw.keyword,
      languageCode: "en",
      regionCode: "IN",
      pageSize: 20,
      locationBias: { circle: { center: { latitude: pt.lat, longitude: pt.lng }, radius: 1e3 } }
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: body?.error?.message ?? `Google HTTP ${res.status}` }, 502);
  const list = body.places ?? [];
  const rows = list.slice(0, 20).map((p, n) => ({
    rank: n + 1,
    name: p.displayName?.text ?? "",
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? null,
    you: !!biz?.place_id && p.id === biz.place_id
  }));
  const yourIdx = rows.findIndex((r) => r.you);
  const result = { rows, yourRank: yourIdx === -1 ? 21 : yourIdx + 1, checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
  await admin.from("audit_drilldowns").upsert({ audit_id: audit.id, keyword_idx: k, point_idx: i, results: result });
  return json(result, 200, { "Cache-Control": "public, max-age=3600" });
});
