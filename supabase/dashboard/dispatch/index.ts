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
async function approvedTemplates(admin, businessId, chosen = {}) {
  const { data } = await admin.from("whatsapp_templates").select("id, business_id, kind, name, language, params, is_default").eq("status", "approved").order("created_at", { ascending: false }).limit(500);
  const rows = data ?? [];
  const as = (r) => ({ name: r.name, language: r.language, params: r.params ?? [] });
  const out = {};
  const pickedInitial = chosen.initial ? rows.find((r) => r.id === chosen.initial && r.kind === "initial") : void 0;
  const pickedFollow = chosen.followup ? rows.find((r) => r.id === chosen.followup && r.kind === "followup") : void 0;
  const own = rows.filter((r) => r.business_id === businessId);
  const initial = pickedInitial ?? own.find((r) => r.kind === "initial");
  if (initial) {
    out.initial = as(initial);
    const photo = rows.find((r) => r.kind === "initial_image" && r.name === `${initial.name}_photo`) ?? (pickedInitial ? void 0 : own.find((r) => r.kind === "initial_image"));
    if (photo) out.initial_image = as(photo);
  }
  const defaultFollow = rows.find((r) => r.kind === "followup" && r.is_default);
  const follow = pickedFollow ?? defaultFollow ?? own.find((r) => r.kind === "followup");
  if (follow) out.followup = as(follow);
  return out;
}
async function defaultFollowUp(admin) {
  const { data } = await admin.from("whatsapp_templates").select("name, language, params").eq("kind", "followup").eq("status", "approved").eq("is_default", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { name: data.name, language: data.language, params: data.params ?? [] } : null;
}

// supabase/functions/_shared/email.ts
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function reviewEmailHtml(opts) {
  const { businessName, message, link, imageUrl } = opts;
  const linkHtml = `<a href="${esc(link)}" style="color:#7c3aed;font-weight:600">Leave a review</a>`;
  const body = message.split(link).map((part) => esc(part).replace(/\n/g, "<br>")).join(linkHtml);
  return `<!DOCTYPE html><html><body style="margin:0;background:#f6f5fa;font-family:Arial,Helvetica,sans-serif;color:#1f1b2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5fa;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
${imageUrl ? `<tr><td><img src="${esc(imageUrl)}" alt="" width="520" style="display:block;width:100%;height:auto;border:0"></td></tr>` : ""}
<tr><td style="padding:28px 28px 8px;font-size:16px;line-height:1.6">${body}</td></tr>
<tr><td align="center" style="padding:16px 28px 32px">
<a href="${esc(link)}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 32px;border-radius:10px">Leave a review</a>
</td></tr>
<tr><td style="padding:0 28px 24px;font-size:12px;color:#8a8597;text-align:center">${esc(businessName)}</td></tr>
</table></td></tr></table></body></html>`;
}
async function sendGmail(cfg, msg) {
  const client = new SMTPClient({
    connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: cfg.user, password: cfg.pass } }
  });
  try {
    const name = msg.fromName.replace(/["\r\n]/g, "").trim() || "Reviews";
    await client.send({ from: `"${name}" <${cfg.from || cfg.user}>`, to: msg.to, subject: msg.subject, content: msg.text, html: msg.html });
    return { ok: true, id: "" };
  } catch (e) {
    return { ok: false, error: `Gmail: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    try {
      await client.close();
    } catch {
    }
  }
}

// supabase/functions/_shared/send.ts
function enabledChannels(m) {
  const c = m.channels;
  if (!c) return { whatsapp: true, sms: false, email: false };
  return { whatsapp: c.whatsapp === true, sms: c.sms === true, email: c.email === true };
}
var env = (k) => Deno.env.get(k) ?? "";
async function loadChannels(admin, businessId) {
  const { data: row } = await admin.from("business_channels").select("*").eq("business_id", businessId).maybeSingle();
  const pick = (col, key, fallback = "") => row?.[col] || env(key) || fallback;
  const waId = pick("whatsapp_phone_number_id", "WHATSAPP_PHONE_NUMBER_ID");
  const waToken = pick("whatsapp_access_token", "WHATSAPP_ACCESS_TOKEN");
  const msgKey = env("MSG91_AUTH_KEY");
  const smsInitial = pick("msg91_sms_template_initial", "MSG91_SMS_TEMPLATE_INITIAL", "6b02bf24e1174c82ca0e0792");
  const gmailUser = env("GMAIL_USER");
  const gmailPass = env("GMAIL_APP_PASSWORD").replace(/\s/g, "");
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
    sms: msgKey && smsInitial ? { authKey: msgKey, initial: smsInitial, followUp: pick("msg91_sms_template_followup", "MSG91_SMS_TEMPLATE_FOLLOWUP", "6b02be340483eded070eb952") } : null,
    email: gmailUser && gmailPass ? { user: gmailUser, pass: gmailPass, from: env("GMAIL_FROM") || void 0 } : null
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
function smsVars(firstName, businessName, link) {
  const cut = (v) => Array.from(v).slice(0, 40).join("");
  let code = "";
  try {
    const u = new URL(link);
    code = u.searchParams.get("t") || u.searchParams.get("b") || "";
  } catch {
  }
  const slug = businessName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return {
    name: cut(firstName),
    business: cut(businessName),
    token: cut(slug && code ? `${slug}-${code}` : code)
  };
}
function smsWindowOpen(now = /* @__PURE__ */ new Date()) {
  const ist = new Date(now.getTime() + 330 * 6e4);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 10 * 60 && mins < 21 * 60;
}
async function sendSms(ch, to, templateId, vars) {
  const res = await fetch("https://control.msg91.com/api/v5/flow", {
    method: "POST",
    headers: { authkey: ch.authKey, accept: "application/json", "content-type": "application/json" },
    // MSG91 wants the country code without '+' (e.g. 919876543210); numbers are stored as +919876543210
    // DLT templates are Promotional on numeric header 677650: MSG91 needs route 1 (promotional), otherwise it uses
    // the transactional route and the SMS fails. MSG91_SMS_ROUTE / MSG91_SMS_SENDER secrets override.
    body: JSON.stringify({
      template_id: templateId,
      short_url: "0",
      route: env("MSG91_SMS_ROUTE") || "1",
      sender: env("MSG91_SMS_SENDER") || "677650",
      recipients: [{ mobiles: to.replace(/\D/g, ""), ...vars }]
    })
  });
  const body = await readJson(res);
  if (!res.ok || body.type === "error") return { ok: false, error: String(body.message ?? `MSG91 SMS HTTP ${res.status}`) };
  return { ok: true, id: String(body.message ?? "") };
}
function withTitle(firstName, gender) {
  if (gender === "male") return `${firstName} Sir`;
  if (gender === "female") return `${firstName} Ma'am`;
  return firstName;
}
async function deliver(input) {
  const ch = await loadChannels(input.admin, input.businessId);
  const isFollow = input.kind === "follow_up";
  const text = buildText(input.kind, input.messaging, input.firstName, input.businessName, input.link);
  const on = input.only ? { whatsapp: input.only === "whatsapp", sms: input.only === "sms", email: input.only === "email" } : enabledChannels(input.messaging);
  const attempts = [];
  if (input.phone && on.whatsapp && ch.whatsapp) {
    const wa = ch.whatsapp;
    const photo = isFollow ? void 0 : input.imageUrl;
    let template = isFollow ? wa.followUp : photo ? wa.initialImage : wa.initial;
    const waName = input.messaging.useTitle === false ? input.firstName : withTitle(input.firstName, input.gender);
    let params = [waName, input.businessName, input.link];
    const header = photo;
    let lang;
    const values = {
      first_name: waName,
      review_link: input.link,
      business_name: input.businessName,
      owner_name: input.messaging.ownerFirstName || input.businessName
    };
    const pick = input.messaging.waMode === "custom" ? (await approvedTemplates(input.admin, input.businessId, { initial: input.messaging.waTemplateId, followup: input.messaging.waFollowUpTemplateId }))[isFollow ? "followup" : photo ? "initial_image" : "initial"] : isFollow ? await defaultFollowUp(input.admin) : void 0;
    if (pick) {
      template = pick.name;
      lang = pick.language;
      params = pick.params.map((p) => values[p] ?? "");
    }
    attempts.push({
      channel: "whatsapp",
      recipient: input.phone,
      run: () => sendWhatsApp(wa, input.phone, template, params, header, lang)
    });
  }
  if (input.phone && on.sms && ch.sms) {
    const sms = ch.sms;
    attempts.push({
      channel: "sms",
      recipient: input.phone,
      run: async () => input.messaging.smsTiming !== "now" && !smsWindowOpen() ? { ok: false, error: "SMS not sent: promotional SMS only go out 10 AM\u20139 PM" } : await sendSms(sms, input.phone, isFollow ? sms.followUp : sms.initial, smsVars(input.messaging.useTitle === false ? input.firstName : withTitle(input.firstName, input.gender), input.businessName, input.link))
    });
  }
  if (input.email && on.email && ch.email) {
    const em = ch.email;
    attempts.push({
      channel: "email",
      recipient: input.email,
      run: () => sendGmail(em, {
        to: input.email,
        fromName: input.businessName,
        subject: isFollow ? `A quick reminder from ${input.businessName}` : `How was your visit to ${input.businessName}?`,
        text,
        html: reviewEmailHtml({ businessName: input.businessName, message: text, link: input.link, imageUrl: input.imageUrl })
      })
    });
  }
  if (attempts.length === 0) {
    const missing = [
      on.whatsapp && input.phone && !ch.whatsapp && "WhatsApp",
      on.sms && input.phone && !ch.sms && "SMS",
      on.email && input.email && !ch.email && "Email"
    ].filter(Boolean);
    if (input.only === "email" && !input.email) return { ok: false, noChannel: true, error: "Enter an email address to test email" };
    if (input.only && input.only !== "email" && !input.phone) return { ok: false, noChannel: true, error: "Enter a phone number to test WhatsApp or SMS" };
    return {
      ok: false,
      noChannel: true,
      error: missing.length ? `${missing.join(", ")} not connected yet` : "No channel turned on for this contact (Messaging page: WhatsApp / SMS / Email)"
    };
  }
  let lastError = "";
  const sentOn = [];
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
    if (result.ok) sentOn.push(a.channel);
    else lastError = `${a.channel === "whatsapp" ? "WhatsApp" : a.channel === "sms" ? "SMS" : "Email"}: ${result.error ?? "Unknown error"}`;
  }
  if (sentOn.length) return { ok: true, channel: sentOn[0], channels: sentOn, error: lastError || void 0 };
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
var RENDER_VERSION = "2";
function photoVersion(photoUrl) {
  let h = 2166136261;
  for (const c of `${RENDER_VERSION}|${photoUrl ?? ""}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}
function contactImageUrl(token, photoUrl, gender) {
  return `${functionsUrl()}/review-image?t=${token}&v=${photoVersion(`${photoUrl ?? ""}|${gender ?? ""}`)}`;
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
    const manual = row.send_kind === "initial" || row.send_kind === "follow_up";
    const kind = manual ? row.send_kind : row.requests_sent === 0 ? "initial" : "follow_up";
    if (!manual && kind === "follow_up" && row.requests_sent > maxFollowUps) {
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
      gender: row.gender,
      email: row.email,
      phone: row.phone,
      businessName: row.business_name,
      messaging: row.messaging ?? {},
      link: `${linkBase}?t=${row.token}`,
      // Photo with the customer's name (business photo, or the demo photo if none uploaded)
      // Personalised photo on the first message only; follow-ups are text
      imageUrl: kind === "initial" && row.messaging?.personalizedImage ? contactImageUrl(row.token, row.messaging?.imageDataUrl, row.messaging?.useTitle === false ? "" : row.gender) : void 0
    });
    const now = /* @__PURE__ */ new Date();
    if (result.ok) {
      const sent = row.requests_sent + 1;
      const open = row.status === "pending" || row.status === "sent";
      const next = open && sent <= maxFollowUps ? new Date(now.getTime() + FOLLOW_UP_GAP_DAYS * 864e5).toISOString() : null;
      await admin.from("contacts").update({ requests_sent: sent, last_sent_at: now.toISOString(), next_send_at: next, send_kind: "", ...open ? { status: "sent" } : {} }).eq("id", row.contact_id);
      stats.sent++;
    } else {
      let next = null;
      if (!result.noChannel) {
        const since = new Date(now.getTime() - 864e5).toISOString();
        const { count } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("contact_id", row.contact_id).eq("status", "failed").gte("created_at", since);
        if ((count ?? 0) < 3) next = new Date(now.getTime() + 36e5).toISOString();
      }
      await admin.from("contacts").update({ next_send_at: next, ...next ? {} : { send_kind: "" } }).eq("id", row.contact_id);
      stats.failed++;
    }
  };
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(handle));
  }
  return json({ ok: true, ...stats, at: (/* @__PURE__ */ new Date()).toISOString() });
});
