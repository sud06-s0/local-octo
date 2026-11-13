// supabase/dashboard/contacts-webhook/index.ts
// Self-contained copy of supabase/functions/contacts-webhook for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: contacts-webhook   ·   Turn OFF "Verify JWT" for this function.
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
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// supabase/functions/contacts-webhook/index.ts
var MAX = 500;
var str = (v) => typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const key = req.headers.get("x-api-key") ?? req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!key.startsWith("lo_live_")) return json({ error: "Missing or invalid API key" }, 401);
  const admin = adminClient();
  const { data: business } = await admin.from("businesses").select("id").eq("api_key_hash", await sha256Hex(key)).maybeSingle();
  if (!business) return json({ error: "Missing or invalid API key" }, 401);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  const list = Array.isArray(body) ? body : Array.isArray(body?.contacts) ? body.contacts : [body];
  if (list.length > MAX) return json({ error: `Send at most ${MAX} contacts per request` }, 413);
  const counts = { added: 0, updated: 0, cooldown: 0, invalid: 0 };
  for (const c of list) {
    let first = str(c.first_name ?? c.firstName ?? c.name);
    let last = str(c.last_name ?? c.lastName);
    if (!last && first.includes(" ")) [first, last] = [first.split(" ")[0], first.split(" ").slice(1).join(" ")];
    const { data, error } = await admin.rpc("upsert_contact", {
      p_business: business.id,
      p_first: first,
      p_last: last,
      p_email: str(c.email),
      p_phone: str(c.phone ?? c.mobile ?? c.whatsapp),
      p_dnc: c.do_not_contact === true || c.doNotContact === true,
      p_source: "webhook",
      p_consent: true
    });
    const result = error ? "invalid" : String(data);
    counts[result] = (counts[result] ?? 0) + 1;
  }
  return json({ ok: true, received: list.length, ...counts });
});
