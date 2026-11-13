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
function page(title, body, status = 404) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8f9f9;color:#1d2320">
<div style="text-align:center;padding:24px"><h1 style="font-size:20px">${title}</h1><p style="color:#5d6762">${body}</p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!/^[a-f0-9]{8,64}$/.test(token)) return page("Link not found", "This review link is not valid.");
  const admin = adminClient();
  const { data: contact } = await admin.from("contacts").select("id, business_id, first_name, last_name, status, clicked_at, businesses(review_link)").eq("token", token).maybeSingle();
  const business = contact?.businesses;
  if (!contact || !business?.review_link) return page("Link not found", "This review link has expired.");
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
  return new Response(null, { status: 302, headers: { Location: business.review_link, "Cache-Control": "no-store" } });
});
