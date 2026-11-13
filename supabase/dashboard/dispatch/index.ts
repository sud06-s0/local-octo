// supabase/dashboard/dispatch/index.ts
// Self-contained copy of supabase/functions/dispatch for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: dispatch   ·   Turn OFF "Verify JWT" for this function.
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
function functionsUrl() {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
}

// supabase/functions/_shared/waTemplates.ts
async function approvedTemplates(admin, businessId) {
  const { data } = await admin.from("whatsapp_templates").select("kind, name, language, params").eq("business_id", businessId).eq("status", "approved").order("created_at", { ascending: false });
  const out = {};
  for (const r of data ?? []) {
    const kind = r.kind;
    if (!out[kind]) out[kind] = { name: r.name, language: r.language, params: r.params ?? [] };
  }
  return out;
}

// supabase/functions/_shared/send.ts
var env = (k) => Deno.env.get(k) ?? "";
async function loadChannels(admin, businessId) {
  const { data: row } = await admin.from("business_channels").select("*").eq("business_id", businessId).maybeSingle();
  const pick = (col, key, fallback = "") => row?.[col] || env(key) || fallback;
  const waId = pick("whatsapp_phone_number_id", "WHATSAPP_PHONE_NUMBER_ID");
  const waToken = pick("whatsapp_access_token", "WHATSAPP_ACCESS_TOKEN");
  const msgKey = env("MSG91_AUTH_KEY");
  const smsInitial = pick("msg91_sms_template_initial", "MSG91_SMS_TEMPLATE_INITIAL");
  const emailTemplate = pick("msg91_email_template_id", "MSG91_EMAIL_TEMPLATE_ID");
  const emailFrom = pick("email_from", "MSG91_EMAIL_FROM");
  const emailDomain = pick("email_domain", "MSG91_EMAIL_DOMAIN");
  return {
    whatsapp: waId && waToken ? {
      phoneNumberId: waId,
      token: waToken,
      initial: pick("whatsapp_template_initial", "WHATSAPP_TEMPLATE_INITIAL", "review_request"),
      initialImage: pick("whatsapp_template_initial_image", "WHATSAPP_TEMPLATE_INITIAL_IMAGE", "review_request_image"),
      followUp: pick("whatsapp_template_followup", "WHATSAPP_TEMPLATE_FOLLOWUP", "review_followup"),
      lang: pick("whatsapp_template_lang", "WHATSAPP_TEMPLATE_LANG", "en"),
      version: env("WHATSAPP_API_VERSION") || "v23.0"
    } : null,
    sms: msgKey && smsInitial ? { authKey: msgKey, initial: smsInitial, followUp: pick("msg91_sms_template_followup", "MSG91_SMS_TEMPLATE_FOLLOWUP", smsInitial) } : null,
    email: msgKey && emailTemplate && emailFrom && emailDomain ? { authKey: msgKey, from: emailFrom, fromName: pick("email_from_name", "MSG91_EMAIL_FROM_NAME", "Local Octo"), domain: emailDomain, templateId: emailTemplate } : null
  };
}
function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}
function buildText(kind, m, firstName, businessName, link) {
  const vars = { first_name: firstName, business_name: businessName, owner_name: m.ownerFirstName ?? "", review_link: link };
  if (m.mode === "custom") {
    return fill(kind === "follow_up" ? m.customFollowUp || m.customMessage || "" : m.customMessage || "", vars);
  }
  return kind === "follow_up" ? `Hey ${firstName}, just wanted to quickly follow up. We'd really appreciate your feedback! ${link}` : `Hey ${firstName}, we hope you enjoyed your experience with ${businessName}! Would you mind taking a moment to leave a review? Here's the link: ${link}`;
}
async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}
async function sendWhatsApp(ch, to, template, params, headerImage, lang) {
  const components = [];
  if (headerImage) components.push({ type: "header", parameters: [{ type: "image", image: { link: headerImage } }] });
  components.push({ type: "body", parameters: params.map((text) => ({ type: "text", text })) });
  const res = await fetch(`https://graph.facebook.com/${ch.version}/${ch.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ch.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: template,
        language: { code: lang || ch.lang },
        components
      }
    })
  });
  const body = await readJson(res);
  const id = body.messages?.[0]?.id;
  if (!res.ok || !id) {
    const err = body.error;
    return { ok: false, error: err?.message ?? `WhatsApp HTTP ${res.status}` };
  }
  return { ok: true, id };
}
async function sendSms(ch, to, templateId, vars) {
  const res = await fetch("https://control.msg91.com/api/v5/flow", {
    method: "POST",
    headers: { authkey: ch.authKey, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ template_id: templateId, short_url: "0", recipients: [{ mobiles: to, ...vars }] })
  });
  const body = await readJson(res);
  if (!res.ok || body.type === "error") return { ok: false, error: String(body.message ?? `MSG91 SMS HTTP ${res.status}`) };
  return { ok: true, id: String(body.message ?? "") };
}
async function sendEmail(ch, to, name, vars) {
  const res = await fetch("https://control.msg91.com/api/v5/email/send", {
    method: "POST",
    headers: { authkey: ch.authKey, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      recipients: [{ to: [{ email: to, name: name || to }], variables: vars }],
      from: { email: ch.from, name: ch.fromName },
      domain: ch.domain,
      template_id: ch.templateId
    })
  });
  const body = await readJson(res);
  if (!res.ok || body.hasError === true || body.status === "fail") {
    return { ok: false, error: String(body.errors ?? body.message ?? `MSG91 email HTTP ${res.status}`) };
  }
  const data = body.data;
  return { ok: true, id: data?.unique_id ?? "" };
}
async function deliver(input) {
  const ch = await loadChannels(input.admin, input.businessId);
  const isFollow = input.kind === "follow_up";
  const text = buildText(input.kind, input.messaging, input.firstName, input.businessName, input.link);
  const attempts = [];
  if (input.phone && ch.whatsapp) {
    const wa = ch.whatsapp;
    let template = isFollow ? wa.followUp : input.imageUrl ? wa.initialImage : wa.initial;
    let params = [input.firstName, input.businessName, input.link];
    let header = isFollow ? void 0 : input.imageUrl;
    let lang;
    if (input.messaging.mode === "custom") {
      const custom = await approvedTemplates(input.admin, input.businessId);
      const values = { first_name: input.firstName, review_link: input.link };
      const pick = isFollow ? custom.followup : input.imageUrl ? custom.initial_image : custom.initial;
      if (pick) {
        template = pick.name;
        lang = pick.language;
        params = pick.params.map((p) => values[p] ?? "");
        header = !isFollow && input.imageUrl && pick === custom.initial_image ? input.imageUrl : void 0;
      }
    }
    attempts.push({
      channel: "whatsapp",
      recipient: input.phone,
      run: () => sendWhatsApp(wa, input.phone, template, params, header, lang)
    });
  }
  if (input.phone && ch.sms) {
    const sms = ch.sms;
    attempts.push({
      channel: "sms",
      recipient: input.phone,
      run: () => sendSms(sms, input.phone, isFollow ? sms.followUp : sms.initial, { name: input.firstName, business: input.businessName, link: input.link })
    });
  }
  if (input.email && ch.email) {
    const em = ch.email;
    attempts.push({
      channel: "email",
      recipient: input.email,
      run: () => sendEmail(em, input.email, input.firstName, {
        first_name: input.firstName,
        business_name: input.businessName,
        message: text,
        review_link: input.link,
        image_url: isFollow ? "" : input.imageUrl ?? ""
      })
    });
  }
  if (attempts.length === 0) return { ok: false, noChannel: true, error: "No sending channel configured for this contact" };
  let lastError = "";
  for (const a of attempts) {
    let result;
    try {
      result = await a.run();
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    await input.admin.from("messages").insert({
      business_id: input.businessId,
      contact_id: input.contactId,
      channel: a.channel,
      kind: input.kind,
      status: result.ok ? "sent" : "failed",
      recipient: a.recipient,
      provider_message_id: result.id || null,
      error: result.error ?? null,
      sent_at: result.ok ? (/* @__PURE__ */ new Date()).toISOString() : null
    });
    if (result.ok) return { ok: true, channel: a.channel };
    lastError = result.error ?? "Unknown error";
  }
  return { ok: false, error: lastError };
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
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// supabase/functions/_shared/reviewImage.ts
var D = Deno;
D.core ??= {};
D.core.encode ??= (s) => new TextEncoder().encode(s);
function contactImageUrl(token) {
  return `${functionsUrl()}/review-image?t=${token}`;
}

// supabase/functions/dispatch/index.ts
var FOLLOW_UP_GAP_DAYS = Number(Deno.env.get("FOLLOW_UP_GAP_DAYS") ?? 3);
var PER_RUN = Number(Deno.env.get("DISPATCH_PER_RUN") ?? 100);
var PER_BUSINESS = Number(Deno.env.get("DISPATCH_PER_BUSINESS") ?? 20);
var CONCURRENCY = 5;
Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET") ?? "";
  const given = req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("secret") ?? "";
  if (!secret || !safeEqual(given, secret)) return json({ error: "Unauthorized" }, 401);
  const admin = adminClient();
  const { data, error } = await admin.rpc("claim_due_contacts", { p_limit: PER_RUN, p_per_business: PER_BUSINESS });
  if (error) return json({ error: error.message }, 500);
  const rows = data ?? [];
  const linkBase = Deno.env.get("LINK_BASE_URL") || `${functionsUrl()}/r`;
  const stats = { claimed: rows.length, sent: 0, failed: 0, finished: 0 };
  const handle = async (row) => {
    const maxFollowUps = row.messaging?.followUpsEnabled === false ? 0 : Number(row.scheduling?.followUps ?? 2);
    const kind = row.requests_sent === 0 ? "initial" : "follow_up";
    if (kind === "follow_up" && row.requests_sent > maxFollowUps) {
      await admin.from("contacts").update({ next_send_at: null }).eq("id", row.contact_id);
      stats.finished++;
      return;
    }
    const result = await deliver({
      admin,
      businessId: row.business_id,
      contactId: row.contact_id,
      kind,
      firstName: row.first_name,
      email: row.email,
      phone: row.phone,
      businessName: row.business_name,
      messaging: row.messaging ?? {},
      link: `${linkBase}?t=${row.token}`,
      // Photo with the customer's name (business photo, or the demo photo if none uploaded)
      imageUrl: kind === "initial" && row.messaging?.personalizedImage ? contactImageUrl(row.token) : void 0
    });
    const now = /* @__PURE__ */ new Date();
    if (result.ok) {
      const sent = row.requests_sent + 1;
      const next = sent <= maxFollowUps ? new Date(now.getTime() + FOLLOW_UP_GAP_DAYS * 864e5).toISOString() : null;
      await admin.from("contacts").update({ requests_sent: sent, last_sent_at: now.toISOString(), next_send_at: next, status: "sent" }).eq("id", row.contact_id).in("status", ["pending", "sent"]);
      stats.sent++;
    } else {
      let next = null;
      if (!result.noChannel) {
        const since = new Date(now.getTime() - 864e5).toISOString();
        const { count } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("contact_id", row.contact_id).eq("status", "failed").gte("created_at", since);
        if ((count ?? 0) < 3) next = new Date(now.getTime() + 36e5).toISOString();
      }
      await admin.from("contacts").update({ next_send_at: next }).eq("id", row.contact_id);
      stats.failed++;
    }
  };
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(handle));
  }
  return json({ ok: true, ...stats, at: (/* @__PURE__ */ new Date()).toISOString() });
});
