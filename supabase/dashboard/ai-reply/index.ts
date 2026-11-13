// supabase/dashboard/ai-reply/index.ts
// Self-contained copy of supabase/functions/ai-reply for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: ai-reply   ·   Turn OFF "Verify JWT" for this function.
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

// supabase/functions/ai-reply/index.ts
function prompt(business, author, rating, text) {
  return [
    `You write replies to Google reviews for a local business called "${business}".`,
    `Write a reply to this ${rating}-star review by ${author}.`,
    text ? `Review text: """${text.slice(0, 2e3)}"""` : "The review has a rating but no text.",
    "Rules: 2-3 sentences, warm and professional, use the reviewer's first name once, mention the business name once.",
    rating <= 3 ? "Apologise sincerely, do not argue or admit legal fault, and invite them to contact the business directly to make it right." : "Thank them specifically for what they mentioned.",
    "Do not use hashtags, emojis, placeholders or quotation marks. Reply with the text only."
  ].join("\n");
}
async function gemini(p) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text: p }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 300 } })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Gemini HTTP ${res.status}`);
  return (body?.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? "").join("").trim();
}
async function openai(p) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0.7, max_tokens: 300, messages: [{ role: "user", content: p }] })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `OpenAI HTTP ${res.status}`);
  return String(body?.choices?.[0]?.message?.content ?? "").trim();
}
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const admin = adminClient();
  const user = await getUser(req, admin);
  if (!user) return json({ error: "Sign in required" }, 401);
  const { reviewId } = await req.json().catch(() => ({}));
  if (!reviewId) return json({ error: "reviewId is required" }, 400);
  const { data: review } = await admin.from("reviews").select("business_id, author, rating, text, businesses(name, ai)").eq("id", reviewId).maybeSingle();
  if (!review) return json({ error: "Review not found" }, 404);
  if (!await isMember(admin, user.id, review.business_id)) return json({ error: "Not allowed" }, 403);
  const b = review.businesses;
  const businessName = b?.ai?.nickname || b?.name || "our business";
  try {
    const p = prompt(businessName, review.author, review.rating, review.text);
    const text = (Deno.env.get("AI_PROVIDER") ?? "gemini").toLowerCase() === "openai" ? await openai(p) : await gemini(p);
    if (!text) throw new Error("Empty reply from AI");
    return json({ text });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "AI request failed" }, 502);
  }
});
