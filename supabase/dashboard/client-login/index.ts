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
      const key2 = keys.default ?? Object.values(keys)[0];
      if (key2) return key2;
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
  if (body.action === "passwords" || body.action === "reset") {
    const bid = String(body.businessId ?? "");
    if (!bid || !await isMember(admin, user.id, bid)) return json({ error: "Pick one of your businesses" }, 403);
    const { data: members } = await admin.from("business_members").select("user_id").eq("business_id", bid);
    const ids = (members ?? []).map((m) => m.user_id);
    const { data: clients } = ids.length ? await admin.from("profiles").select("id").in("id", ids).eq("account_type", "client").eq("is_platform_admin", false) : { data: [] };
    const clientIds = new Set((clients ?? []).map((c) => c.id));
    if (body.action === "passwords") {
      const { data: rows } = clientIds.size ? await admin.from("client_credentials").select("user_id, password_enc").in("user_id", [...clientIds]) : { data: [] };
      const byId = new Map((rows ?? []).map((r) => [r.user_id, r.password_enc]));
      const passwords = {};
      for (const id of clientIds) {
        const enc = byId.get(id);
        passwords[id] = enc ? await decrypt(enc).catch(() => null) : null;
      }
      return json({ passwords });
    }
    const target = String(body.userId ?? "");
    if (!clientIds.has(target)) return json({ error: "This login is not a client of this business" }, 403);
    const fresh = makePassword();
    const { error } = await admin.auth.admin.updateUserById(target, { password: fresh });
    if (error) return json({ error: error.message }, 400);
    await savePassword(admin, target, fresh, user.id);
    return json({ ok: true, password: fresh });
  }
  let businessId = String(body.businessId ?? "");
  const newBusinessName = String(body.newBusinessName ?? "").trim().slice(0, 120);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!newBusinessName && (!businessId || !await isMember(admin, user.id, businessId))) return json({ error: "Pick one of your businesses" }, 403);
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
    await savePassword(admin, userId, password, user.id);
    await admin.from("profiles").upsert({ id: userId, email, full_name: name, account_type: "client" }, { onConflict: "id" });
  }
  if (newBusinessName) {
    const { data: biz, error: bizError } = await admin.from("businesses").insert({ name: newBusinessName, created_by: user.id }).select("id, messaging").single();
    if (bizError || !biz) return json({ error: `Login ${created ? "created" : "found"}, but the business could not be created` }, 500);
    businessId = biz.id;
    await admin.from("businesses").update({ messaging: { ...biz.messaging ?? {}, businessName: newBusinessName } }).eq("id", businessId);
    await admin.from("business_members").insert({ business_id: businessId, user_id: user.id, role: "owner" });
  }
  const { error: memberError } = await admin.from("business_members").upsert({ business_id: businessId, user_id: userId, role: "member" }, { onConflict: "business_id,user_id", ignoreDuplicates: true });
  if (memberError) return json({ error: "Login created, but could not give access to the business" }, 500);
  return json({ ok: true, created, businessId });
});
function makePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => chars[b % chars.length]).join("");
}
var keyPromise = null;
function key() {
  keyPromise ??= (async () => {
    const secret = Deno.env.get("CLIENT_PASSWORD_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`client-login:${secret}`));
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  })();
  return keyPromise;
}
var b64 = (u) => btoa(String.fromCharCode(...u));
var unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function encrypt(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(text)));
  return `${b64(iv)}.${b64(ct)}`;
}
async function decrypt(enc) {
  const [iv, ct] = enc.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(ct));
  return new TextDecoder().decode(pt);
}
async function savePassword(admin, userId, password, by) {
  await admin.from("client_credentials").upsert({ user_id: userId, password_enc: await encrypt(password), updated_by: by, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "user_id" });
}
