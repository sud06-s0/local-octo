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

// supabase/functions/_shared/waTemplates.ts
var env = (k) => Deno.env.get(k) ?? "";
var EXAMPLES = { first_name: "Priya", review_link: "https://g.page/r/example/review", business_name: "Sharma Dental Clinic", owner_name: "Rahul" };
var SAMPLE_PHOTO_URL = () => env("DEFAULT_REVIEW_IMAGE_URL") || "https://review.localocto.com/default-personal.jpg";
var STANDARD_TEMPLATES = [
  { kind: "initial", col: "whatsapp_template_initial", key: "WHATSAPP_TEMPLATE_INITIAL", def: "review_request", body: "Hi {{1}}, thanks for choosing {{2}}! Would you mind taking a moment to leave us a Google review? {{3}} Thank you!" },
  { kind: "initial_image", col: "whatsapp_template_initial_image", key: "WHATSAPP_TEMPLATE_INITIAL_IMAGE", def: "review_request_image", body: "Hi {{1}}, thanks for choosing {{2}}! Would you mind taking a moment to leave us a Google review? {{3}} Thank you!" },
  { kind: "followup", col: "whatsapp_template_followup", key: "WHATSAPP_TEMPLATE_FOLLOWUP", def: "review_followup", body: "Hi {{1}}, just a quick reminder from {{2}} \u2014 your feedback means a lot to us! {{3}} Thank you!" }
];
var STANDARD_EXAMPLE = ["Priya", "Sharma Dental Clinic", "https://g.page/r/example/review"];
async function metaConfig(admin, businessId) {
  const { data: row } = await admin.from("business_channels").select("*").eq("business_id", businessId).maybeSingle();
  return {
    wabaId: row?.whatsapp_waba_id || env("WHATSAPP_WABA_ID"),
    token: row?.whatsapp_access_token || env("WHATSAPP_ACCESS_TOKEN"),
    version: env("WHATSAPP_API_VERSION") || "v23.0",
    lang: row?.whatsapp_template_lang || env("WHATSAPP_TEMPLATE_LANG") || "en"
  };
}
function buildTemplateBody(source, _vars) {
  let text = source.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const params = [];
  text = text.replace(/\{(first_name|review_link|business_name|owner_name)\}/g, (_m, key) => {
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
async function appIdFromToken(cfg) {
  if (env("WHATSAPP_APP_ID")) return env("WHATSAPP_APP_ID");
  try {
    const app = await graph(cfg, "app?fields=id");
    if (app?.id) return String(app.id);
  } catch {
  }
  const dbg = await graph(cfg, `debug_token?input_token=${encodeURIComponent(cfg.token)}`);
  const id = dbg?.data?.app_id;
  if (!id) throw new Error("Could not read the Meta app from the access token");
  return String(id);
}
async function uploadSamplePhoto(cfg) {
  const appId = await appIdFromToken(cfg);
  const img = await fetch(SAMPLE_PHOTO_URL());
  if (!img.ok) throw new Error(`Could not load the sample photo (${img.status})`);
  const bytes = new Uint8Array(await img.arrayBuffer());
  const type = img.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const ext = type === "image/png" ? "png" : "jpg";
  const session = await graph(cfg, `${appId}/uploads?file_name=sample.${ext}&file_length=${bytes.length}&file_type=${encodeURIComponent(type)}`, { method: "POST" });
  if (!session?.id) throw new Error("Meta did not start the photo upload");
  const res = await fetch(`https://graph.facebook.com/${cfg.version}/${session.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${cfg.token}`, file_offset: "0" },
    body: bytes
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.h) throw new Error(body?.error?.error_user_msg || body?.error?.message || `Photo upload failed (HTTP ${res.status})`);
  return String(body.h);
}
async function createTemplate(cfg, name, body, example, headerHandle, category = "MARKETING") {
  const components = [];
  if (headerHandle) components.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [headerHandle] } });
  components.push({ type: "BODY", text: body, ...example.length ? { example: { body_text: [example] } } : {} });
  const res = await graph(cfg, `${cfg.wabaId}/message_templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, language: cfg.lang, category, components })
  });
  return { id: String(res.id), status: mapStatus(res.status), category: res.category ? String(res.category).toLowerCase() : category.toLowerCase() };
}
async function deleteTemplate(cfg, name, metaId) {
  const q = `name=${encodeURIComponent(name)}${metaId ? `&hsm_id=${encodeURIComponent(metaId)}` : ""}`;
  try {
    await graph(cfg, `${cfg.wabaId}/message_templates?${q}`, { method: "DELETE" });
  } catch (e) {
    if (!/not found|does not exist|nonexisting|could not be found/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
}
async function findTemplateByName(cfg, name) {
  const res = await graph(cfg, `${cfg.wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=id,name,status,rejected_reason,language,category&limit=50`);
  const hit = (res.data ?? []).find((t) => t.name === name && (!cfg.lang || t.language === cfg.lang)) ?? (res.data ?? []).find((t) => t.name === name);
  if (!hit) return null;
  const reason = hit.rejected_reason && hit.rejected_reason !== "NONE" ? String(hit.rejected_reason) : null;
  return { id: String(hit.id), status: mapStatus(hit.status), reason, language: hit.language, category: hit.category ? String(hit.category).toLowerCase() : null };
}

// supabase/functions/wa-template/index.ts
var cleanName = (v) => (v ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
var COLS = "id, business_id, kind, name, language, body, params, status, reason, category, is_default, created_at, updated_at, businesses(name)";
var errText = (e) => e instanceof Error ? e.message : String(e);
function photoHandle(cfg) {
  let p = null;
  return () => p ??= uploadSamplePhoto(cfg);
}
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const admin = adminClient();
  const user = await getUser(req, admin);
  if (!user) return json({ error: "Sign in required" }, 401);
  const { businessId, action = "refresh", kinds, templateId, standardKinds } = await req.json().catch(() => ({}));
  if (!businessId) return json({ error: "businessId is required" }, 400);
  if (!await isMember(admin, user.id, businessId)) return json({ error: "Not allowed" }, 403);
  const cfg = await metaConfig(admin, businessId);
  const agency = await isAgency(admin, user.id);
  if (!cfg.wabaId || !cfg.token) return json({ error: "WhatsApp is not connected yet (WHATSAPP_WABA_ID / WHATSAPP_ACCESS_TOKEN missing)" }, 400);
  const getPhoto = photoHandle(cfg);
  const warnings = [];
  if (action === "delete_standard") {
    if (!agency) return json({ error: "Only the agency can delete templates" }, 403);
    const { data: ch } = await admin.from("business_channels").select("*").eq("business_id", businessId).maybeSingle();
    for (const t of STANDARD_TEMPLATES.filter((x) => standardKinds?.includes(x.kind))) {
      const name = ch?.[t.col] || (Deno.env.get(t.key) ?? "") || t.def;
      try {
        await deleteTemplate(cfg, name);
      } catch (e) {
        return json({ error: `WhatsApp could not delete ${name}: ${errText(e)}` }, 400);
      }
    }
  }
  if (action === "standard" || action === "submit_standard" || action === "delete_standard") {
    const { data: ch } = await admin.from("business_channels").select("*").eq("business_id", businessId).maybeSingle();
    const env2 = (k) => Deno.env.get(k) ?? "";
    const standard = [];
    for (const t of STANDARD_TEMPLATES) {
      const name = ch?.[t.col] || env2(t.key) || t.def;
      try {
        let found = await findTemplateByName(cfg, name);
        const wanted = standardKinds?.length ? standardKinds.includes(t.kind) : t.kind !== "followup";
        if (!found && action === "submit_standard" && wanted) {
          const header = t.kind.endsWith("_image") ? await getPhoto() : void 0;
          const created = await createTemplate(cfg, name, t.body, STANDARD_EXAMPLE, header);
          found = { id: created.id, status: created.status, reason: null, language: cfg.lang, category: created.category };
        }
        standard.push({ kind: t.kind, name, status: found ? found.status : "not_created", reason: found?.reason ?? null, category: found?.category ?? null });
      } catch (e) {
        standard.push({ kind: t.kind, name, status: "failed", reason: errText(e), category: null });
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
    const cat = (c) => c === "utility" ? "UTILITY" : "MARKETING";
    const jobs = [];
    if (want.has("initial") && m.waMessage) jobs.push({ kind: "initial", source: m.waMessage, name: cleanName(m.waTemplateName), category: cat(m.waCategory) });
    if (want.has("second") && m.waSecondMessage) jobs.push({ kind: "initial_image", source: m.waSecondMessage, name: cleanName(m.waSecondTemplateName), category: cat(m.waSecondCategory) });
    if (want.has("followup") && m.waFollowUp) jobs.push({ kind: "followup", source: m.waFollowUp, name: cleanName(m.waFollowUpTemplateName), category: cat(m.waFollowUpCategory) });
    for (const job of jobs) {
      const built = buildTemplateBody(job.source, vars);
      const base = { business_id: businessId, language: cfg.lang, body: built.body, params: built.params };
      for (const kind of [job.kind]) {
        const name = job.name || templateName(businessId, kind);
        try {
          if (!built.params.includes("review_link")) throw new Error("The message must include the Review Link");
          const header = kind === "initial_image" ? await getPhoto() : void 0;
          const created = await createTemplate(cfg, name, built.body, built.example, header, job.category);
          await admin.from("whatsapp_templates").insert({ ...base, kind, name, status: created.status, category: created.category, meta_template_id: created.id });
        } catch (e) {
          await admin.from("whatsapp_templates").insert({ ...base, kind, name, status: "failed", reason: errText(e) });
        }
      }
    }
  }
  if (action === "delete") {
    let q = admin.from("whatsapp_templates").select("id, name, meta_template_id").eq("id", templateId ?? "");
    if (!agency) q = q.eq("business_id", businessId);
    const { data: t } = await q.maybeSingle();
    if (!t) return json({ error: "Template not found" }, 404);
    const { count } = await admin.from("whatsapp_templates").select("id", { count: "exact", head: true }).eq("name", t.name).neq("id", t.id);
    try {
      if (!count) await deleteTemplate(cfg, t.name, t.meta_template_id);
    } catch (e) {
      return json({ error: `WhatsApp could not delete it: ${errText(e)}` }, 400);
    }
    await admin.from("whatsapp_templates").delete().eq("id", t.id);
  }
  if (action === "set_default") {
    if (!agency) return json({ error: "Only the agency can set the default" }, 403);
    const { data: t } = await admin.from("whatsapp_templates").select("id, kind, is_default").eq("id", templateId ?? "").maybeSingle();
    if (!t) return json({ error: "Template not found" }, 404);
    await admin.from("whatsapp_templates").update({ is_default: false }).eq("kind", t.kind).neq("id", t.id);
    await admin.from("whatsapp_templates").update({ is_default: !t.is_default }).eq("id", t.id);
  }
  let openQ = admin.from("whatsapp_templates").select("id, name").or("status.in.(not_created,pending,paused),and(status.eq.approved,category.is.null)");
  if (!agency) openQ = openQ.eq("business_id", businessId);
  const { data: open } = await openQ;
  for (const t of open ?? []) {
    try {
      const found = await findTemplateByName(cfg, t.name);
      if (found) {
        await admin.from("whatsapp_templates").update({ status: found.status, reason: found.reason, meta_template_id: found.id, language: found.language, category: found.category }).eq("id", t.id);
      }
    } catch (e) {
      warnings.push(errText(e));
    }
  }
  let listQ = admin.from("whatsapp_templates").select(COLS).order("created_at", { ascending: false }).limit(agency ? 200 : 30);
  if (!agency) listQ = listQ.eq("business_id", businessId);
  const { data: rows } = await listQ;
  return json({ ok: true, templates: rows ?? [], warnings: [...new Set(warnings)] });
});
