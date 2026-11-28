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
var HEATMAP_KEYWORDS = 3;
var HEAT = { size: 7, stepKm: 1 };
var SMALL = { size: 3, stepKm: 1.5 };
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
async function pool(jobs, limit) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    })
  );
  return out;
}
var prettyId = (id) => id.replace(/^.*:/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
async function gbpProfile(admin, businessId) {
  const { data: conn } = await admin.from("google_connections").select("location_name, account_name").eq("business_id", businessId).maybeSingle();
  if (!conn?.location_name) return null;
  const { token } = await accessTokenFor(admin, businessId);
  const mask = "title,categories,profile,serviceItems,regularHours,phoneNumbers,websiteUri,storefrontAddress,latlng,serviceArea";
  const l = await gbp(token, `https://mybusinessbusinessinformation.googleapis.com/v1/${conn.location_name}?readMask=${mask}`);
  const typeNames = /* @__PURE__ */ new Map();
  for (const c of [l.categories?.primaryCategory, ...l.categories?.additionalCategories ?? []])
    for (const t of c?.serviceTypes ?? []) if (t.serviceTypeId) typeNames.set(t.serviceTypeId, t.displayName);
  const services = (l.serviceItems ?? []).map((s) => {
    if (s.freeFormServiceItem) return { name: s.freeFormServiceItem.label?.displayName ?? "", description: s.freeFormServiceItem.label?.description ?? "" };
    const id = s.structuredServiceItem?.serviceTypeId ?? "";
    return { name: typeNames.get(id) ?? prettyId(id), description: s.structuredServiceItem?.description ?? "" };
  }).filter((s) => s.name);
  let photos = null;
  let posts = null;
  if (conn.account_name) {
    const base = `https://mybusiness.googleapis.com/v4/${conn.account_name}/${conn.location_name}`;
    const [m, p] = await Promise.allSettled([gbp(token, `${base}/media?pageSize=1`), gbp(token, `${base}/localPosts?pageSize=100`)]);
    if (m.status === "fulfilled") photos = m.value.totalMediaItemCount ?? m.value.mediaItems?.length ?? 0;
    if (p.status === "fulfilled") posts = (p.value.localPosts ?? []).map((x) => ({ summary: x.summary ?? "", createTime: x.createTime ?? "" }));
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
      services,
      description: l.profile?.description ?? "",
      phone: !!l.phoneNumbers?.primaryPhone,
      website: !!l.websiteUri,
      hours: !!l.regularHours?.periods?.length,
      photos,
      serviceArea: !!(l.serviceArea?.places?.placeInfos?.length || l.serviceArea?.regionCode),
      posts
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
    description: g ? g.profile.description : p.editorialSummary?.text ?? null,
    phone: g ? g.profile.phone : !!(p.nationalPhoneNumber || b.phone),
    website: g ? g.profile.website : !!(p.websiteUri || b.website),
    hours: g ? g.profile.hours : !!p.regularOpeningHours?.periods?.length,
    photos: g?.profile.photos ?? (p.photos ? p.photos.length : null),
    // Places returns at most 10
    serviceArea: g ? g.profile.serviceArea : null,
    posts: g?.profile.posts ?? null,
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
    out.add(`${c} near me`);
    if (profile.city) out.add(`${c} in ${profile.city.toLowerCase()}`);
    out.add(`best ${c}`);
  }
  return [...out].slice(0, MAX_KEYWORDS);
}
var STOP = /* @__PURE__ */ new Set(["near", "me", "best", "top", "in", "the", "a", "an", "and", "for", "of", "at", "to", "with", "my", "open", "now", "cheap", "good"]);
function targetTerms(keywords, profile) {
  const words = [...keywords, profile.primaryCategory, ...profile.additionalCategories].join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w) && w !== profile.city.toLowerCase());
  return [...new Set(words)];
}
var termsIn = (text, terms) => {
  const t = text.toLowerCase();
  return terms.filter((w) => new RegExp(`\\b${w}`).test(t));
};
function gridPoints(lat, lng, size, stepKm) {
  const dLat = stepKm / 111.32;
  const dLng = stepKm / (111.32 * Math.cos(lat * Math.PI / 180));
  const half = (size - 1) / 2;
  const pts = [];
  for (let r = half; r >= -half; r--) for (let c = -half; c <= half; c++) pts.push({ lat: lat + r * dLat, lng: lng + c * dLng });
  return pts;
}
var searchBody = (keyword, p) => JSON.stringify({
  textQuery: keyword,
  languageCode: "en",
  regionCode: "IN",
  pageSize: 20,
  locationBias: { circle: { center: { latitude: p.lat, longitude: p.lng }, radius: 1e3 } }
});
async function rankKeyword(keyword, placeId, lat, lng, heat) {
  const g = heat ? HEAT : SMALL;
  const pts = gridPoints(lat, lng, g.size, g.stepKm);
  const mid = (pts.length - 1) / 2;
  let nearby = [];
  const ranks = await pool(
    pts.map((pt, i) => async () => {
      if (i === mid) {
        const body2 = await places("places:searchText", "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount", {
          method: "POST",
          body: searchBody(keyword, pt)
        });
        const list = body2.places ?? [];
        nearby = list.map((x, n) => ({ placeId: x.id, name: x.displayName?.text ?? "", address: x.formattedAddress ?? "", rating: x.rating ?? null, reviews: x.userRatingCount ?? null, rank: n + 1 }));
        const idx2 = list.findIndex((x) => x.id === placeId);
        return idx2 === -1 ? NOT_FOUND : idx2 + 1;
      }
      const body = await places("places:searchText", "places.id", { method: "POST", body: searchBody(keyword, pt) });
      const idx = (body.places ?? []).findIndex((x) => x.id === placeId);
      return idx === -1 ? NOT_FOUND : idx + 1;
    }),
    16
  );
  const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  const average = Math.round(avg * 10) / 10;
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
    nearby: nearby.filter((x) => x.placeId !== placeId)
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
    perWeek: Math.round((recent ?? 0) / 12 * 100) / 100,
    synced: total ?? 0,
    unreplied: (total ?? 0) - (replied ?? 0),
    responseRate: total ? Math.round((replied ?? 0) / total * 100) : null
  };
}
var METROS = ["bengaluru", "bangalore", "mumbai", "delhi", "new delhi", "kolkata", "chennai", "hyderabad", "pune", "ahmedabad", "gurugram", "gurgaon", "noida", "navi mumbai", "thane"];
var SPEND = [
  { match: /gym|fitness|yoga|crossfit|pilates|zumba/, ticket: 300, share: 0.03 },
  { match: /restaurant|cafe|caf|food|bakery|dhaba|biryani|pizza|sweet/, ticket: 400, share: 0.25 },
  { match: /salon|spa|beauty|barber|parlour|parlor|makeup/, ticket: 500, share: 0.08 },
  { match: /dent|clinic|doctor|hospital|medical|physio|diagnostic|pharmacy/, ticket: 800, share: 0.05 },
  { match: /school|college|coaching|academy|education|tutor|institute|university/, ticket: 3e3, share: 0.01 },
  { match: /hotel|resort|lodge|guest house/, ticket: 3e3, share: 0.01 },
  { match: /car|auto|bike|motor|garage|tyre/, ticket: 1500, share: 0.02 },
  { match: /pet|vet|groom/, ticket: 800, share: 0.01 }
];
function market(profile) {
  const cat = [profile.primaryCategory, ...profile.additionalCategories].join(" ").toLowerCase();
  const s = SPEND.find((x) => x.match.test(cat)) ?? { ticket: 500, share: 0.03 };
  const population = METROS.includes(profile.city.toLowerCase()) ? 6e6 : 1e6;
  const people = Math.round(population * s.share / 1e3) * 1e3;
  return { monthly: people * s.ticket, people, ticket: s.ticket };
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
function buildChecks(profile, reviews, terms) {
  const desc = profile.description ?? "";
  const descTerms = termsIn(desc, terms);
  const monthAgo = Date.now() - 30 * 864e5;
  const recentPosts = profile.posts?.filter((p) => new Date(p.createTime).getTime() >= monthAgo) ?? null;
  const postsWithTerms = recentPosts?.filter((p) => termsIn(p.summary, terms).length > 0).length ?? 0;
  const services = profile.services;
  const noDesc = services?.filter((s) => !s.description.trim()) ?? [];
  const unknown = "Connect Google Business Profile to check this.";
  const checks = [
    {
      key: "description",
      label: "Business Description",
      pass: profile.description == null ? null : descTerms.length >= Math.min(3, terms.length) && desc.length >= 250,
      detail: profile.description == null ? unknown : `${descTerms.length} of your keywords are in the description (${desc.length} characters). Use at least 3 and 250+ characters.`
    },
    {
      key: "reviewFrequency",
      label: "Review Frequency",
      pass: reviews.perWeek >= 1,
      detail: `${reviews.perWeek} new reviews per week. Target: at least 1 per week.`
    },
    {
      key: "rating",
      label: "Google Rating",
      pass: profile.rating == null ? null : profile.rating >= 4,
      detail: profile.rating == null ? "No rating yet." : `${profile.rating.toFixed(1)} stars. Target: 4.0 or more.`
    },
    {
      key: "replies",
      label: "Review Replies",
      pass: reviews.synced ? reviews.unreplied === 0 : null,
      detail: reviews.synced ? reviews.unreplied ? `${reviews.unreplied} reviews have no reply.` : "Every review has a reply." : "Sync reviews from Google to check this."
    },
    {
      key: "images",
      label: "# of Images",
      pass: profile.photos == null ? null : profile.photos >= 8,
      detail: profile.photos == null ? unknown : `${profile.photos} images. Target: at least 8.`
    },
    {
      key: "postFrequency",
      label: "Post Frequency",
      pass: recentPosts == null ? null : recentPosts.length >= 3,
      detail: recentPosts == null ? unknown : `${recentPosts.length} Google posts in the last 30 days. Recommended: one every 5 days (at least 3 a month).`
    },
    {
      key: "postKeywords",
      label: "Post Keyword Optimization",
      pass: recentPosts == null ? null : recentPosts.length > 0 && postsWithTerms >= Math.ceil(recentPosts.length / 2),
      detail: recentPosts == null ? unknown : recentPosts.length ? `${postsWithTerms} of ${recentPosts.length} recent posts use your keywords.` : "No recent posts to check."
    },
    {
      key: "services",
      label: "Services List",
      pass: services == null ? null : services.length >= 25,
      detail: services == null ? unknown : `${services.length} services listed. Target: at least 25.`
    },
    {
      key: "serviceDescriptions",
      label: "Service Descriptions",
      pass: services == null ? null : services.length > 0 && noDesc.length === 0,
      detail: services == null ? unknown : services.length ? `${noDesc.length} of ${services.length} services have no description.` : "No services listed."
    },
    {
      key: "serviceArea",
      label: "Service Area",
      pass: profile.serviceArea,
      detail: profile.serviceArea == null ? unknown : profile.serviceArea ? "Service area is set." : "No service area set."
    }
  ];
  const passed = checks.filter((c) => c.pass === true).length;
  return {
    checks,
    optimizationScore: clamp(passed / checks.length * 100),
    descTerms,
    recentPosts: recentPosts?.length ?? null,
    noDesc: noDesc.map((s) => s.name)
  };
}
function buildScores(profile, reviews) {
  const title = titleCheck(profile.name, profile.city);
  const categories = 1 + profile.additionalCategories.length;
  const categoryScore = profile.source === "gbp" ? clamp(categories / 5 * 100) : null;
  const serviceCount = profile.services?.length ?? null;
  const serviceScore = serviceCount == null ? null : clamp(serviceCount / 25 * 100);
  const descLen = profile.description?.length ?? 0;
  const descHasCategory = !!profile.primaryCategory && (profile.description ?? "").toLowerCase().includes(profile.primaryCategory.toLowerCase().split(" ")[0]);
  const descriptionScore = profile.description == null ? null : clamp(Math.min(descLen, 600) / 600 * 80 + (descHasCategory ? 20 : 0));
  const checklist = [
    { label: "Phone number", done: profile.phone },
    { label: "Website", done: profile.website },
    { label: "Opening hours", done: profile.hours },
    { label: "Description", done: profile.description == null ? null : descLen >= 250 },
    { label: "5+ categories", done: profile.source === "gbp" ? categories >= 5 : null },
    { label: "25+ services", done: serviceCount == null ? null : serviceCount >= 25 },
    { label: "8+ photos", done: profile.photos == null ? null : profile.photos >= 8 },
    { label: "Service area", done: profile.serviceArea }
  ];
  const known = checklist.filter((c) => c.done !== null);
  const completion = known.length ? clamp(known.filter((c) => c.done).length / known.length * 100) : 0;
  const reviewScore = clamp(reviews.perWeek * 100);
  const responseScore = reviews.responseRate == null ? null : clamp(reviews.responseRate / 80 * 100);
  return {
    title: { ...title, value: profile.name },
    categories: { count: profile.source === "gbp" ? categories : null, target: 5, score: categoryScore, list: [profile.primaryCategory, ...profile.additionalCategories].filter(Boolean) },
    services: { count: serviceCount, target: 25, score: serviceScore },
    description: { length: profile.description == null ? null : descLen, target: 600, mentionsCategory: descHasCategory, score: descriptionScore },
    completion: { score: completion, checklist },
    reviews: { perWeek: reviews.perWeek, target: 1, score: reviewScore, synced: reviews.synced },
    response: { rate: reviews.responseRate, target: 80, score: responseScore },
    suspensionRisk: title.risk
  };
}
async function writeSummary(facts) {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) return "";
  const model = Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b";
  const prompt = `You are Local Octo, a friendly local marketing agency. Write an audit summary for the owner of a business, based ONLY on these facts (JSON):
${JSON.stringify(facts)}

Rules:
- Start with "Hi ${facts.business} team, I'm Local Octo and it's nice to meet you." then say you reviewed their Google Business Profile.
- 3 to 4 short paragraphs, plain text, no headings, no bullet points, no markdown.
- Praise what passes, then explain each failing check and what to do, using the real numbers.
- Do not invent numbers or facts. Skip checks whose pass is null.
- End by offering to help manage these improvements.`;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_completion_tokens: 1200,
        ...model.includes("gpt-oss") ? { reasoning_effort: "low" } : {},
        messages: [{ role: "user", content: prompt }]
      }),
      signal: AbortSignal.timeout(25e3)
    });
    const body = await res.json();
    if (!res.ok) return "";
    return String(body?.choices?.[0]?.message?.content ?? "").trim();
  } catch {
    return "";
  }
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
      for (let i = 0; i < keywords.length; i++) rows.push(await rankKeyword(keywords[i], placeId, profile.lat, profile.lng, i < HEATMAP_KEYWORDS));
      const comp = /* @__PURE__ */ new Map();
      for (const r of rows)
        for (const c of r.nearby.slice(0, 10)) {
          const cur = comp.get(c.placeId) ?? { ...c, times: 0, rankSum: 0 };
          cur.times += 1;
          cur.rankSum += c.rank;
          comp.set(c.placeId, cur);
        }
      const overall = (c) => (c.rankSum + (rows.length - c.times) * NOT_FOUND) / rows.length;
      const competitors = [...comp.values()].sort((a, b) => overall(a) - overall(b)).slice(0, 5).map((c) => ({
        name: c.name,
        address: c.address,
        rating: c.rating,
        reviews: c.reviews,
        averageRank: Math.round(c.rankSum / c.times * 10) / 10,
        keywords: c.times,
        totalKeywords: rows.length
      }));
      const reviews = await reviewStats(admin, businessId);
      const terms = targetTerms(keywords, profile);
      const { checks, optimizationScore, descTerms, recentPosts, noDesc } = buildChecks(profile, reviews, terms);
      const scores = buildScores(profile, reviews);
      const top = rows.slice(0, 5);
      const searchRank = Math.round(top.reduce((a, r) => a + r.average, 0) / top.length * 10) / 10;
      const mk = market(profile);
      const serviceCount = profile.services?.length ?? null;
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
        checks: checks.map((c) => ({ check: c.label, pass: c.pass, detail: c.detail }))
      });
      const report = {
        version: 2,
        business: { name: profile.name, address: profile.address, rating: profile.rating, reviewCount: profile.reviewCount, category: profile.primaryCategory, lat: profile.lat, lng: profile.lng },
        source: profile.source,
        gbpNote: g ? "" : gbpError || "Google Business Profile is not connected, so services, posts, photos and service area could not be checked.",
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
          servicesWithoutDescription: profile.services ? noDesc : null
        },
        scores,
        keywords: rows.map(({ nearby: _n, ...r }) => ({ ...r, impressions: impressions.get(r.keyword) ?? null })),
        competitors
      };
      const { data, error } = await admin.from("business_audits").insert({ business_id: businessId, keywords, report, created_by: user.id }).select("id, created_at, share_token").single();
      if (error) throw new Error(error.message);
      return json({ id: data.id, createdAt: data.created_at, shareToken: data.share_token, report });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Audit failed" }, 502);
  }
});
