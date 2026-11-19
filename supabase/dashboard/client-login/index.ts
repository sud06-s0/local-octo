// supabase/dashboard/client-login/index.ts
// Self-contained copy of supabase/functions/client-login for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: client-login   ·   Turn OFF "Verify JWT" for this function.
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

// supabase/functions/client-login/index.ts
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const admin = adminClient();
  const user = await getUser(req, admin);
  if (!user) return json({ error: "Sign in required" }, 401);
  if (!await isAgency(admin, user.id)) return json({ error: "Only agency accounts can create client logins" }, 403);
  const body = await req.json().catch(() => ({}));
  const businessId = String(body.businessId ?? "");
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!businessId || !await isMember(admin, user.id, businessId)) return json({ error: "Pick one of your businesses" }, 403);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email" }, 400);
  const { data: existing } = await admin.from("profiles").select("id, account_type, is_platform_admin").ilike("email", email).maybeSingle();
  if (existing && (existing.account_type !== "client" || existing.is_platform_admin)) {
    return json({ error: "This email is an agency account. Client logins must use a client email." }, 400);
  }
  let userId = existing?.id;
  let created = false;
  if (!userId) {
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // can sign in straight away, no confirmation email
      user_metadata: { full_name: name }
    });
    if (error || !data.user) return json({ error: error?.message ?? "Could not create the login" }, 400);
    userId = data.user.id;
    created = true;
    await admin.from("profiles").upsert({ id: userId, email, full_name: name, account_type: "client" }, { onConflict: "id" });
  }
  const { error: memberError } = await admin.from("business_members").upsert({ business_id: businessId, user_id: userId, role: "member" }, { onConflict: "business_id,user_id", ignoreDuplicates: true });
  if (memberError) return json({ error: "Login created, but could not give access to the business" }, 500);
  return json({ ok: true, created });
});
