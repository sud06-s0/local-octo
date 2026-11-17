// supabase/dashboard/feedback/index.ts
// @ts-nocheck
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

// supabase/functions/feedback/index.ts
var LABEL = { 5: "Happy", 4: "Good", 2: "Bad", 1: "Worse" };
var MAX_PHOTO = 5 * 1024 * 1024;
async function findTarget(admin, t, b) {
  if (/^[a-f0-9]{8,64}$/.test(t)) {
    const { data } = await admin.from("contacts").select("id, business_id, first_name, businesses(name, review_link)").eq("token", t).maybeSingle();
    const biz = data?.businesses;
    if (data && biz) return { businessId: data.business_id, contactId: data.id, firstName: data.first_name, name: biz.name, reviewLink: biz.review_link };
  }
  if (/^[a-f0-9]{8,64}$/.test(b)) {
    const { data } = await admin.from("businesses").select("id, name, review_link").eq("public_key", b).maybeSingle();
    if (data) return { businessId: data.id, contactId: null, firstName: "", name: data.name, reviewLink: data.review_link };
  }
  return null;
}
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const admin = adminClient();
  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const target2 = await findTarget(admin, q.get("t") ?? "", q.get("b") ?? "");
    if (!target2) return json({ error: "This review link is not valid" }, 404);
    return json({ businessName: target2.name, firstName: target2.firstName, knownContact: !!target2.contactId });
  }
  if (req.method !== "POST") return json({ error: "Use GET or POST" }, 405);
  const input = await req.json().catch(() => ({}));
  const target = await findTarget(admin, input.t ?? "", input.b ?? "");
  if (!target) return json({ error: "This review link is not valid" }, 404);
  const rating = Number(input.rating);
  if (!LABEL[rating]) return json({ error: "Pick one of the faces" }, 400);
  const positive = rating >= 4;
  const text = String(input.text ?? "").trim().slice(0, positive ? 4e3 : 2e3);
  const clean = (v, max) => String(v ?? "").trim().slice(0, max);
  const customerName = target.contactId ? "" : clean(input.name, 120);
  const customerEmail = target.contactId ? "" : clean(input.email, 200);
  const customerPhone = target.contactId ? "" : clean(input.phone, 30);
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) return json({ error: "Please check the email address" }, 400);
  let photoUrl = null;
  if (positive && input.photo) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.photo);
    if (!m) return json({ error: "Photo must be a JPG, PNG or WebP image" }, 400);
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    if (bytes.length > MAX_PHOTO) return json({ error: "Photo is too large (5 MB max)" }, 400);
    const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
    const path = `${target.businessId}/feedback/${crypto.randomUUID()}.${ext}`;
    const { error: error2 } = await admin.storage.from("business-assets").upload(path, bytes, { contentType: m[1] });
    if (error2) return json({ error: "Could not save the photo" }, 500);
    photoUrl = admin.storage.from("business-assets").getPublicUrl(path).data.publicUrl;
  }
  const { error } = await admin.from("review_feedback").insert({
    business_id: target.businessId,
    contact_id: target.contactId,
    rating,
    text,
    photo_url: photoUrl,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone
  });
  if (error) return json({ error: error.message }, 500);
  await admin.from("notifications").insert({
    business_id: target.businessId,
    type: positive ? "new_review" : "low_rating",
    title: `Review page: ${LABEL[rating]}`,
    body: `${target.firstName || customerName || "A customer"} picked ${LABEL[rating]}${text ? `: "${text.slice(0, 120)}"` : ""}`
  });
  return json({ ok: true, reviewLink: positive ? target.reviewLink || null : null });
});
