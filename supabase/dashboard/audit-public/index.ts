// supabase/dashboard/audit-public/index.ts
// Self-contained copy of supabase/functions/audit-public for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: audit-public   ·   Turn OFF "Verify JWT" for this function.
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

// supabase/functions/audit-public/index.ts
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "GET") return json({ error: "Use GET" }, 405);
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!/^[a-f0-9]{24}$/.test(token)) return json({ error: "Report not found" }, 404);
  const { data } = await adminClient().from("business_audits").select("created_at, report").eq("share_token", token).maybeSingle();
  if (!data) return json({ error: "Report not found" }, 404);
  const report = data.report;
  const keywords = (report.keywords ?? []).map(({ ids: _ids, ...k }) => k);
  return json({ createdAt: data.created_at, report: { ...report, keywords } }, 200, { "Cache-Control": "public, max-age=300" });
});
