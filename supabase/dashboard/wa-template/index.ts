// supabase/dashboard/wa-template/index.ts
// Self-contained copy of supabase/functions/wa-template for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: wa-template   ·   Turn OFF "Verify JWT" for this function.
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

// supabase/functions/_shared/waTemplates.ts
var env = (k) => Deno.env.get(k) ?? "";
var EXAMPLES = { first_name: "Priya", review_link: "https://g.page/r/example/review" };
async function metaConfig(admin, businessId) {
  const { data: row } = await admin.from("business_channels").select("*").eq("business_id", businessId).maybeSingle();
  return {
    wabaId: row?.whatsapp_waba_id || env("WHATSAPP_WABA_ID"),
    token: row?.whatsapp_access_token || env("WHATSAPP_ACCESS_TOKEN"),
    version: env("WHATSAPP_API_VERSION") || "v23.0",
    lang: row?.whatsapp_template_lang || env("WHATSAPP_TEMPLATE_LANG") || "en"
  };
}
function buildTemplateBody(source, vars) {
  let text = source.replace(/\{business_name\}/g, vars.businessName).replace(/\{owner_name\}/g, vars.ownerName || vars.businessName).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const params = [];
  text = text.replace(/\{(first_name|review_link)\}/g, (_m, key) => {
    params.push(key);
    return `{{${params.length}}}`;
  });
  if (/^\{\{\d+\}\}/.test(text)) text = `Hi ${text}`;
  if (/\{\{\d+\}\}[\s.!?,]*$/.test(text)) text = `${text} Thank you!`;
  text = text.replace(/(\{\{\d+\}\})\s*(\{\{\d+\}\})/g, "$1 - $2");
  return { body: text, params, example: params.map((p) => EXAMPLES[p]) };
}
function templateName(businessId, kind) {
  return `lo_${businessId.replace(/-/g, "").slice(0, 10)}_${kind}_${Date.now().toString(36)}`;
}
function mapStatus(meta) {
  switch ((meta ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
      return "paused";
    case "DISABLED":
      return "disabled";
    default:
      return "pending";
  }
}
async function graph(cfg, path, init = {}) {
  const res = await fetch(`https://graph.facebook.com/${cfg.version}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.token}`, ...init.headers ?? {} }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body?.error;
    throw new Error(e?.error_user_msg || e?.message || `Meta HTTP ${res.status}`);
  }
  return body;
}
async function createTemplate(cfg, name, body, example) {
  const components = [];
  components.push({ type: "BODY", text: body, ...example.length ? { example: { body_text: [example] } } : {} });
  const res = await graph(cfg, `${cfg.wabaId}/message_templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, language: cfg.lang, category: "MARKETING", components })
  });
  return { id: String(res.id), status: mapStatus(res.status) };
}
async function findTemplateByName(cfg, name) {
  const res = await graph(cfg, `${cfg.wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=id,name,status,rejected_reason,language&limit=50`);
  const hit = (res.data ?? []).find((t) => t.name === name && (!cfg.lang || t.language === cfg.lang)) ?? (res.data ?? []).find((t) => t.name === name);
  if (!hit) return null;
  const reason = hit.rejected_reason && hit.rejected_reason !== "NONE" ? String(hit.rejected_reason) : null;
  return { id: String(hit.id), status: mapStatus(hit.status), reason, language: hit.language };
}

// supabase/functions/wa-template/index.ts
var COLS = "id, kind, name, language, body, status, reason, created_at, updated_at";
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const admin = adminClient();
  const user = await getUser(req, admin);
  if (!user) return json({ error: "Sign in required" }, 401);
  const { businessId, action = "refresh", kinds } = await req.json().catch(() => ({}));
  if (!businessId) return json({ error: "businessId is required" }, 400);
  if (!await isMember(admin, user.id, businessId)) return json({ error: "Not allowed" }, 403);
  const cfg = await metaConfig(admin, businessId);
  if (!cfg.wabaId || !cfg.token) return json({ error: "WhatsApp is not connected yet (WHATSAPP_WABA_ID / WHATSAPP_ACCESS_TOKEN missing)" }, 400);
  const warnings = [];
  if (action === "standard") {
    const { data: ch } = await admin.from("business_channels").select("*").eq("business_id", businessId).maybeSingle();
    const env2 = (k) => Deno.env.get(k) ?? "";
    const list = [
      { kind: "initial", col: "whatsapp_template_initial", key: "WHATSAPP_TEMPLATE_INITIAL", def: "review_request" },
      { kind: "initial_image", col: "whatsapp_template_initial_image", key: "WHATSAPP_TEMPLATE_INITIAL_IMAGE", def: "review_request_image" },
      { kind: "followup", col: "whatsapp_template_followup", key: "WHATSAPP_TEMPLATE_FOLLOWUP", def: "review_followup" },
      { kind: "followup_image", col: "whatsapp_template_followup_image", key: "WHATSAPP_TEMPLATE_FOLLOWUP_IMAGE", def: "review_followup_image" }
    ];
    const standard = [];
    for (const t of list) {
      const name = ch?.[t.col] || env2(t.key) || t.def;
      try {
        const found = await findTemplateByName(cfg, name);
        standard.push({ kind: t.kind, name, status: found ? found.status : "not_created", reason: found?.reason ?? null });
      } catch (e) {
        standard.push({ kind: t.kind, name, status: "failed", reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return json({ ok: true, standard });
  }
  if (action === "submit") {
    const { data: b } = await admin.from("businesses").select("name, messaging").eq("id", businessId).single();
    if (!b) return json({ error: "Business not found" }, 404);
    const m = b.messaging ?? {};
    const vars = { businessName: m.businessName || b.name, ownerName: m.ownerFirstName || "" };
    const want = new Set(kinds?.length ? kinds : ["initial", "followup"]);
    const jobs = [];
    if (want.has("initial") && m.customMessage) jobs.push({ kind: "initial", source: m.customMessage });
    if (want.has("followup") && m.customFollowUp) jobs.push({ kind: "followup", source: m.customFollowUp });
    for (const job of jobs) {
      const built = buildTemplateBody(job.source, vars);
      const base = { business_id: businessId, language: cfg.lang, body: built.body, params: built.params };
      const name = templateName(businessId, job.kind);
      try {
        if (!built.params.includes("review_link")) throw new Error("The message must include the Review Link");
        const created = await createTemplate(cfg, name, built.body, built.example);
        await admin.from("whatsapp_templates").insert({ ...base, kind: job.kind, name, status: created.status, meta_template_id: created.id });
      } catch (e) {
        await admin.from("whatsapp_templates").insert({ ...base, kind: job.kind, name, status: "failed", reason: e instanceof Error ? e.message : String(e) });
      }
      const photoKind = job.kind === "initial" ? "initial_image" : "followup_image";
      await admin.from("whatsapp_templates").insert({ ...base, kind: photoKind, name: templateName(businessId, photoKind), status: "not_created" });
    }
  }
  const { data: open } = await admin.from("whatsapp_templates").select("id, name").eq("business_id", businessId).in("status", ["not_created", "pending", "paused"]);
  for (const t of open ?? []) {
    try {
      const found = await findTemplateByName(cfg, t.name);
      if (found) {
        await admin.from("whatsapp_templates").update({ status: found.status, reason: found.reason, meta_template_id: found.id, language: found.language }).eq("id", t.id);
      }
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e));
    }
  }
  const { data: rows } = await admin.from("whatsapp_templates").select(COLS).eq("business_id", businessId).order("created_at", { ascending: false }).limit(30);
  return json({ ok: true, templates: rows ?? [], warnings: [...new Set(warnings)] });
});
