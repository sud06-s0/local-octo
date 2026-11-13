// supabase/dashboard/whatsapp-webhook/index.ts
// Self-contained copy of supabase/functions/whatsapp-webhook for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: whatsapp-webhook   ·   Turn OFF "Verify JWT" for this function.
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
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// supabase/functions/whatsapp-webhook/index.ts
var STOP_WORDS = /^\s*(stop|unsubscribe|cancel|opt\s?out|end|quit)\s*$/i;
var STATUS_MAP = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
var TEMPLATE_MAP = { APPROVED: "approved", REJECTED: "rejected", PAUSED: "paused", DISABLED: "disabled", PENDING: "pending" };
async function validSignature(raw, header) {
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!secret) return true;
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(hex, header.slice(7));
}
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await req.text();
  if (!await validSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Bad signature", { status: 401 });
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("ok", { status: 200 });
  }
  const admin = adminClient();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      if (change.field === "message_template_status_update" && value.message_template_id) {
        const status = TEMPLATE_MAP[(value.event ?? "").toUpperCase()];
        if (status) {
          const id = String(value.message_template_id).replace(/\D/g, "");
          const name = /^[a-z0-9_]+$/.test(value.message_template_name ?? "") ? value.message_template_name : "";
          await admin.from("whatsapp_templates").update({ status, meta_template_id: id, reason: value.reason && value.reason !== "NONE" ? value.reason : null }).or(name ? `meta_template_id.eq.${id},name.eq.${name}` : `meta_template_id.eq.${id}`);
        }
        continue;
      }
      for (const s of value.statuses ?? []) {
        const status = STATUS_MAP[s.status];
        if (!status) continue;
        await admin.from("messages").update({ status, error: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? null }).eq("provider_message_id", s.id);
      }
      for (const m of value.messages ?? []) {
        const text = m.text?.body ?? m.button?.text ?? "";
        if (!STOP_WORDS.test(text)) continue;
        let query = admin.from("contacts").update({ do_not_contact: true, status: "stopped", next_send_at: null, stopped_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("phone", m.from);
        const phoneId = value.metadata?.phone_number_id;
        if (phoneId) {
          const { data: owners } = await admin.from("business_channels").select("business_id").eq("whatsapp_phone_number_id", phoneId);
          if (owners && owners.length) query = query.in("business_id", owners.map((o) => o.business_id));
        }
        await query;
      }
    }
  }
  return new Response("ok", { status: 200 });
});
