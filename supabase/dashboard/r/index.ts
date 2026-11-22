// supabase/dashboard/r/index.ts
// Self-contained copy of supabase/functions/r for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: r   ·   Turn OFF "Verify JWT" for this function.
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

// supabase/functions/r/index.ts
var BOT = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slack|telegram|discord|skype|linkedin/i;
function toReviewPage(token) {
  const appUrl = (Deno.env.get("APP_URL") || "https://review.localocto.com").replace(/\/+$/, "");
  return new Response(null, { status: 302, headers: { Location: `${appUrl}/review?t=${encodeURIComponent(token)}`, "Cache-Control": "no-store" } });
}
Deno.serve(async (req) => {
  const raw = new URL(req.url).searchParams.get("t") ?? "";
  const token = raw.split("-").pop() ?? "";
  if (!/^[a-f0-9]{8,64}$/.test(token)) return toReviewPage(token);
  const admin = adminClient();
  const { data: contact } = await admin.from("contacts").select("id, business_id, first_name, last_name, status, clicked_at, businesses(review_link)").eq("token", token).maybeSingle();
  if (!contact) {
    const { data: biz } = await admin.from("businesses").select("public_key").eq("public_key", token).maybeSingle();
    if (biz) {
      const appUrl = (Deno.env.get("APP_URL") || "https://review.localocto.com").replace(/\/+$/, "");
      return new Response(null, { status: 302, headers: { Location: `${appUrl}/review?b=${encodeURIComponent(token)}`, "Cache-Control": "no-store" } });
    }
  }
  const business = contact?.businesses;
  if (!contact || !business?.review_link) return toReviewPage(token);
  const isBot = BOT.test(req.headers.get("user-agent") ?? "");
  if (!isBot && !contact.clicked_at) {
    await admin.from("contacts").update({
      clicked_at: (/* @__PURE__ */ new Date()).toISOString(),
      next_send_at: null,
      status: contact.status === "reviewed" ? "reviewed" : "clicked"
    }).eq("id", contact.id);
    await admin.from("notifications").insert({
      business_id: contact.business_id,
      type: "link_clicked",
      title: "Review link clicked",
      body: `${`${contact.first_name} ${contact.last_name}`.trim()} opened your review link.`
    });
  }
  return toReviewPage(token);
});
