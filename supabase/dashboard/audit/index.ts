// supabase/dashboard/audit/index.ts
// Self-contained copy of supabase/functions/audit for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: audit   ·   Turn OFF "Verify JWT" for this function.
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
async function isAgency(admin, userId) {
  const { data } = await admin.from("profiles").select("account_type, is_platform_admin").eq("id", userId).maybeSingle();
  return data?.account_type === "agency" || !!data?.is_platform_admin;
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
function oauthConfig() {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set in Supabase secrets");
  return { clientId, clientSecret };
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
async function gbp(token, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers ?? {} } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Google Business Profile HTTP ${res.status}`);
  return body;
}

// supabase/functions/audit/index.ts
var PLACES = "https://places.googleapis.com/v1";
var MAX_KEYWORDS = 10;
var GRID_STEP_KM = 1.5;
var NOT_FOUND = 21;
async function places(path, fields, init = {}) {
  const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set in Supabase secrets");
  const res = await fetch(`${PLACES}/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fields }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? `Google Places HTTP ${res.status}`);
  return body;
}
async function gbpProfile(admin, businessId) {
  const { data: conn } = await admin.from("google_connections").select("location_name, account_name").eq("business_id", businessId).maybeSingle();
  if (!conn?.location_name) return null;
  const { token } = await accessTokenFor(admin, businessId);
  const mask = "title,categories,profile,serviceItems,regularHours,phoneNumbers,websiteUri,storefrontAddress,latlng";
  const l = await gbp(token, `https://mybusinessbusinessinformation.googleapis.com/v1/${conn.location_name}?readMask=${mask}`);
  let photos = null;
  if (conn.account_name) {
    try {
      const m = await gbp(token, `https://mybusiness.googleapis.com/v4/${conn.account_name}/${conn.location_name}/media?pageSize=1`);
      photos = m.totalMediaItemCount ?? (m.mediaItems?.length ?? 0);
    } catch {
      photos = null;
    }
  }
  const addr = l.storefrontAddress;
  return {
    token,
    location: conn.location_name,
    profile: {
      name: l.title ?? "",
      address: addr ? [...addr.addressLines ?? [], addr.locality, addr.administrativeArea].filter(Boolean).join(", ") : "",
      city: addr?.locality ?? "",
      lat: l.latlng?.latitude ?? null,
      lng: l.latlng?.longitude ?? null,
      primaryCategory: l.categories?.primaryCategory?.displayName ?? "",
      additionalCategories: (l.categories?.additionalCategories ?? []).map((c) => c.displayName).filter(Boolean),
      services: (l.serviceItems ?? []).length,
      description: l.profile?.description ?? "",
      phone: !!l.phoneNumbers?.primaryPhone,
      website: !!l.websiteUri,
      hours: !!l.regularHours?.periods?.length,
      photos,
      source: "gbp"
    }
  };
}
async function loadProfile(admin, businessId) {
  const { data: b } = await admin.from("businesses").select("name, address, place_id, phone, website, google_rating, google_review_count").eq("id", businessId).single();
  if (!b) throw new Error("Business not found");
  let g = null;
  let gbpError = "";
  try {
    g = await gbpProfile(admin, businessId);
  } catch (e) {
    gbpError = e instanceof Error ? e.message : "Google Business Profile request failed";
  }
  let p = {};
  if (b.place_id) {
    p = await places(
      `places/${b.place_id}?languageCode=en`,
      "id,displayName,formattedAddress,addressComponents,location,rating,userRatingCount,primaryTypeDisplayName,nationalPhoneNumber,websiteUri,regularOpeningHours,photos,editorialSummary"
    );
  }
  const city = (p.addressComponents ?? []).find((c) => (c.types ?? []).includes("locality"))?.longText ?? "";
  const profile = {
    name: g?.profile.name || p.displayName?.text || b.name,
    address: g?.profile.address || p.formattedAddress || b.address || "",
    city: g?.profile.city || city,
    lat: g?.profile.lat ?? p.location?.latitude ?? null,
    lng: g?.profile.lng ?? p.location?.longitude ?? null,
    rating: p.rating ?? (b.google_rating != null ? Number(b.google_rating) : null),
    reviewCount: p.userRatingCount ?? b.google_review_count ?? null,
    primaryCategory: g?.profile.primaryCategory || p.primaryTypeDisplayName?.text || "",
    additionalCategories: g?.profile.additionalCategories ?? [],
    services: g?.profile.services ?? null,
    description: g ? g.profile.description ?? "" : p.editorialSummary?.text ?? null,
    phone: g ? !!g.profile.phone : !!(p.nationalPhoneNumber || b.phone),
    website: g ? !!g.profile.website : !!(p.websiteUri || b.website),
    hours: g ? !!g.profile.hours : !!p.regularOpeningHours?.periods?.length,
    photos: g?.profile.photos ?? (p.photos ? p.photos.length : null),
    // Places returns at most 10
    source: g ? "gbp" : "places"
  };
  return { profile, placeId: p.id || b.place_id || "", gbp: g, gbpError };
}
async function searchKeywords(token, location) {
  const now = /* @__PURE__ */ new Date();
  const end = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const q = new URLSearchParams({
    "monthlyRange.startMonth.year": String(start.getFullYear()),
    "monthlyRange.startMonth.month": String(start.getMonth() + 1),
    "monthlyRange.endMonth.year": String(end.getFullYear()),
    "monthlyRange.endMonth.month": String(end.getMonth() + 1),
    pageSize: "50"
  });
  const body = await gbp(token, `https://businessprofileperformance.googleapis.com/v1/${location}/searchkeywords/impressions/monthly?${q}`);
  return (body.searchKeywordsCounts ?? []).map((k) => ({ keyword: String(k.searchKeyword ?? "").trim(), impressions: Number(k.insightsValue?.value ?? k.insightsValue?.threshold ?? 0) })).filter((k) => k.keyword).sort((a, b) => b.impressions - a.impressions);
}
function keywordsFromCategories(profile) {
  const cats = [profile.primaryCategory, ...profile.additionalCategories].filter(Boolean).map((c) => c.toLowerCase());
  const out = /* @__PURE__ */ new Set();
  for (const c of cats) {
    if (profile.city) out.add(`${c} in ${profile.city.toLowerCase()}`);
    out.add(`${c} near me`);
    out.add(`best ${c}`);
  }
  return [...out].slice(0, MAX_KEYWORDS);
}
function grid(lat, lng) {
  const dLat = GRID_STEP_KM / 111.32;
  const dLng = GRID_STEP_KM / (111.32 * Math.cos(lat * Math.PI / 180));
  const pts = [];
  for (const r of [1, 0, -1]) for (const c of [-1, 0, 1]) pts.push({ lat: lat + r * dLat, lng: lng + c * dLng });
  return pts;
}
var searchBody = (keyword, p) => JSON.stringify({
  textQuery: keyword,
  languageCode: "en",
  regionCode: "IN",
  pageSize: 20,
  locationBias: { circle: { center: { latitude: p.lat, longitude: p.lng }, radius: 1e3 } }
});
async function rankKeyword(keyword, placeId, lat, lng) {
  const pts = grid(lat, lng);
  const results = await Promise.all(
    pts.map(async (pt, i) => {
      if (i === 4) {
        const body2 = await places("places:searchText", "places.id,places.displayName,places.rating,places.userRatingCount", { method: "POST", body: searchBody(keyword, pt) });
        const list = body2.places ?? [];
        const idx2 = list.findIndex((x) => x.id === placeId);
        const competitors = list.map((x, n) => ({ placeId: x.id, name: x.displayName?.text ?? "", rating: x.rating ?? null, reviews: x.userRatingCount ?? null, rank: n + 1 })).filter((x) => x.placeId !== placeId && (idx2 === -1 ? x.rank <= 3 : x.rank < idx2 + 1));
        return { rank: idx2 === -1 ? NOT_FOUND : idx2 + 1, competitors };
      }
      const body = await places("places:searchText", "places.id", { method: "POST", body: searchBody(keyword, pt) });
      const idx = (body.places ?? []).findIndex((x) => x.id === placeId);
      return { rank: idx === -1 ? NOT_FOUND : idx + 1, competitors: [] };
    })
  );
  const ranks = results.map((r) => r.rank);
  const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  return {
    keyword,
    grid: ranks,
    center: ranks[4],
    average: Math.round(avg * 10) / 10,
    foundIn: ranks.filter((r) => r <= 20).length,
    top3In: ranks.filter((r) => r <= 3).length,
    competitors: results[4].competitors
  };
}
async function reviewStats(admin, businessId) {
  const since = new Date(Date.now() - 84 * 864e5).toISOString();
  const [{ count: recent }, { count: total }, { count: replied }] = await Promise.all([
    admin.from("reviews").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("review_created_at", since),
    admin.from("reviews").select("id", { count: "exact", head: true }).eq("business_id", businessId),
    admin.from("reviews").select("id", { count: "exact", head: true }).eq("business_id", businessId).not("reply_text", "is", null).neq("reply_source", "draft")
  ]);
  return {
    perWeek: Math.round((recent ?? 0) / 12 * 10) / 10,
    synced: total ?? 0,
    responseRate: total ? Math.round((replied ?? 0) / total * 100) : null
  };
}
var clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
function titleCheck(name, city) {
  const t = name.toLowerCase();
  const issues = [];
  if (/\b(best|top|no\.?\s?1|cheap|near me)\b/.test(t)) issues.push("Promotional words in the name");
  if (/\d{6,}/.test(t)) issues.push("Phone number in the name");
  if (city && t.includes(city.toLowerCase())) issues.push("City name in the name");
  if (/[|]/.test(t) || (t.match(/[-,]/g) ?? []).length >= 2) issues.push("Extra keywords added with | , or -");
  if (name.length > 60) issues.push("Name is very long");
  const risk = issues.length >= 2 ? "High" : issues.length === 1 ? "Medium" : "Low";
  return { score: clamp(100 - issues.length * 35), issues, risk };
}
function buildScores(profile, reviews) {
  const title = titleCheck(profile.name, profile.city);
  const categories = 1 + profile.additionalCategories.length;
  const categoryScore = profile.source === "gbp" ? clamp(categories / 5 * 100) : null;
  const serviceScore = profile.services == null ? null : clamp(profile.services / 20 * 100);
  const descLen = profile.description?.length ?? 0;
  const descHasCategory = !!profile.primaryCategory && (profile.description ?? "").toLowerCase().includes(profile.primaryCategory.toLowerCase().split(" ")[0]);
  const descriptionScore = profile.description == null ? null : clamp(Math.min(descLen, 600) / 600 * 80 + (descHasCategory ? 20 : 0));
  const checklist = [
    { label: "Phone number", done: profile.phone },
    { label: "Website", done: profile.website },
    { label: "Opening hours", done: profile.hours },
    { label: "Description", done: profile.description == null ? null : descLen >= 250 },
    { label: "5+ categories", done: profile.source === "gbp" ? categories >= 5 : null },
    { label: "20+ services", done: profile.services == null ? null : profile.services >= 20 },
    { label: "10+ photos", done: profile.photos == null ? null : profile.photos >= 10 },
    { label: "Replies to reviews", done: reviews.responseRate == null ? null : reviews.responseRate >= 80 }
  ];
  const known = checklist.filter((c) => c.done !== null);
  const completion = known.length ? clamp(known.filter((c) => c.done).length / known.length * 100) : 0;
  const reviewScore = clamp(reviews.perWeek / 2 * 100);
  const responseScore = reviews.responseRate == null ? null : clamp(reviews.responseRate / 80 * 100);
  const parts = [title.score, categoryScore, serviceScore, descriptionScore, completion, reviewScore, responseScore].filter((n) => n != null);
  const profileScore = clamp(parts.reduce((a, b) => a + b, 0) / parts.length);
  return {
    profileScore,
    title: { ...title, value: profile.name },
    categories: { count: profile.source === "gbp" ? categories : null, target: 5, score: categoryScore, list: [profile.primaryCategory, ...profile.additionalCategories].filter(Boolean) },
    services: { count: profile.services, target: 20, score: serviceScore },
    description: { length: profile.description == null ? null : descLen, target: 600, mentionsCategory: descHasCategory, score: descriptionScore },
    completion: { score: completion, checklist },
    reviews: { perWeek: reviews.perWeek, target: 2, score: reviewScore, synced: reviews.synced },
    response: { rate: reviews.responseRate, target: 80, score: responseScore },
    suspensionRisk: title.risk
  };
}
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
  if (!await isAgency(admin, user.id) || !await isMember(admin, user.id, businessId)) return json({ error: "Not allowed" }, 403);
  try {
    if (input.action === "suggest") {
      const { profile, gbp: g } = await loadProfile(admin, businessId);
      if (g) {
        try {
          const kw = await searchKeywords(g.token, g.location);
          if (kw.length) return json({ keywords: kw.slice(0, MAX_KEYWORDS).map((k) => k.keyword), source: "google" });
        } catch {
        }
      }
      return json({ keywords: keywordsFromCategories(profile), source: "categories" });
    }
    if (input.action === "run") {
      const keywords = [...new Set((input.keywords ?? []).map((k) => String(k).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_KEYWORDS);
      if (!keywords.length) return json({ error: "Add at least one keyword" }, 400);
      const { profile, placeId, gbp: g, gbpError } = await loadProfile(admin, businessId);
      if (!placeId) return json({ error: "This business has no Google place yet. Connect Google or find the business on Google first." }, 400);
      if (profile.lat == null || profile.lng == null) return json({ error: "Could not get the business location from Google" }, 400);
      let impressions = /* @__PURE__ */ new Map();
      if (g) {
        try {
          impressions = new Map((await searchKeywords(g.token, g.location)).map((k) => [k.keyword.toLowerCase(), k.impressions]));
        } catch {
        }
      }
      const rows = [];
      for (let i = 0; i < keywords.length; i += 3) {
        rows.push(...await Promise.all(keywords.slice(i, i + 3).map((k) => rankKeyword(k, placeId, profile.lat, profile.lng))));
      }
      const comp = /* @__PURE__ */ new Map();
      for (const r of rows)
        for (const c of r.competitors) {
          const cur = comp.get(c.placeId) ?? { ...c, keywords: 0, rankSum: 0 };
          cur.keywords += 1;
          cur.rankSum += c.rank;
          comp.set(c.placeId, cur);
        }
      const competitors = [...comp.values()].sort((a, b) => b.keywords - a.keywords || a.rankSum / a.keywords - b.rankSum / b.keywords).slice(0, 8).map((c) => ({ name: c.name, rating: c.rating, reviews: c.reviews, keywords: c.keywords, averageRank: Math.round(c.rankSum / c.keywords * 10) / 10 }));
      const reviews = await reviewStats(admin, businessId);
      const scores = buildScores(profile, reviews);
      const searchRank = Math.round(rows.reduce((a, r) => a + r.average, 0) / rows.length * 10) / 10;
      const report = {
        version: 1,
        business: { name: profile.name, address: profile.address, rating: profile.rating, reviewCount: profile.reviewCount, category: profile.primaryCategory },
        source: profile.source,
        gbpNote: g ? "" : gbpError || "Google Business Profile is not connected, so services, categories and description could not be checked.",
        gridStepKm: GRID_STEP_KM,
        searchRank,
        scores,
        keywords: rows.map(({ competitors: _c, ...r }) => ({ ...r, impressions: impressions.get(r.keyword) ?? null })),
        competitors
      };
      const { data, error } = await admin.from("business_audits").insert({ business_id: businessId, keywords, report, created_by: user.id }).select("id, created_at").single();
      if (error) throw new Error(error.message);
      return json({ id: data.id, createdAt: data.created_at, report });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Audit failed" }, 502);
  }
});
