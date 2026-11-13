// supabase/dashboard/widget/index.ts
// Self-contained copy of supabase/functions/widget for pasting into the Supabase dashboard editor.
// Function name in Supabase must be exactly: widget   ·   Turn OFF "Verify JWT" for this function.
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

// supabase/functions/widget/index.ts
var EMBED_JS = String.raw`(function () {
  var s = document.currentScript; if (!s) return;
  var key = s.getAttribute('data-business'); var type = s.getAttribute('data-widget') || 'popup';
  var base = s.src.split('?')[0];
  function el(tag, css, html) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
  function esc(t) { return String(t || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function stars(n, color, size) { var o = ''; for (var i = 1; i <= 5; i++) o += '<span style="color:' + (i <= n ? color : '#d9dddb') + ';font-size:' + size + 'px;line-height:1">★</span>'; return o; }
  var G = '<svg width="26" height="26" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  var FONT = 'font-family:system-ui,-apple-system,Segoe UI,sans-serif;';
  fetch(base + '?format=json&key=' + encodeURIComponent(key)).then(function (r) { return r.json(); }).then(function (d) {
    if (!d || !d.reviews || !d.reviews.length) return;
    var powered = '<div style="font-size:11px;opacity:.75;margin-top:8px">Powered by <b>' + esc(d.poweredBy) + '</b></div>';
    if (type === 'carousel') {
      var c = d.widgets.carousel; var host = document.getElementById('lo-reviews') || s.parentNode.insertBefore(el('div'), s.nextSibling);
      var wrap = el('div', FONT + 'max-width:900px;margin:0 auto;color:' + c.text);
      var head = el('div', 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:' + c.background + ';border-radius:12px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.08)',
        G + '<div style="flex:1;min-width:180px"><div style="font-weight:600;font-size:17px">What our customers are saying on Google!</div><div style="font-size:13px;opacity:.8">' + d.rating.toFixed(1) + ' ★ from ' + d.count + ' reviews</div></div>' +
        (d.mapsUrl ? '<a href="' + esc(d.mapsUrl) + '" target="_blank" rel="noopener" style="background:#1a73e8;color:#fff;text-decoration:none;border-radius:999px;padding:8px 16px;font-size:14px">View on Google Maps</a>' : ''));
      var track = el('div', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-top:14px');
      d.reviews.slice(0, 6).forEach(function (r) {
        track.appendChild(el('div', 'background:' + c.background + ';border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)',
          '<div style="font-weight:600">' + esc(r.author) + '</div><div style="margin:6px 0">' + stars(r.rating, c.star, 20) + '</div>' +
          '<div style="font-size:14px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden">' + esc(r.text || 'Rated ' + r.rating + ' stars on Google') + '</div>'));
      });
      wrap.appendChild(head); wrap.appendChild(track); wrap.appendChild(el('div', 'text-align:center', powered)); host.appendChild(wrap);
    } else {
      var p = d.widgets.popup; var i = 0;
      var box = el('div', FONT + 'position:fixed;bottom:20px;' + (p.position === 'right' ? 'right' : 'left') + ':20px;z-index:2147483000;width:270px;background:' + p.background + ';color:' + p.text + ';border-radius:12px;padding:14px;box-shadow:0 8px 30px rgba(0,0,0,.18);transition:opacity .4s,transform .4s;opacity:0;transform:translateY(12px)');
      var close = el('button', 'position:absolute;top:6px;right:8px;border:0;background:none;font-size:16px;cursor:pointer;color:inherit;opacity:.5', '×');
      close.setAttribute('aria-label', 'Close'); close.onclick = function () { box.remove(); };
      var body = el('div'); box.appendChild(close); box.appendChild(body); document.body.appendChild(box);
      function show() {
        var r = d.reviews[i % d.reviews.length]; i++;
        body.innerHTML = '<a href="' + esc(d.mapsUrl || '#') + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><div style="display:flex;gap:10px;align-items:flex-start">' + G +
          '<div><div style="font-weight:600;font-size:14px">' + esc(r.author.split(' ')[0]) + ' left a review</div><div style="font-size:13px;opacity:.8">Read our ' + d.count + ' reviews</div></div></div>' +
          '<div style="text-align:center;margin-top:8px">' + stars(r.rating, p.star, 24) + '</div><div style="text-align:center">' + powered + '</div></a>';
        box.style.opacity = '1'; box.style.transform = 'translateY(0)';
        setTimeout(function () { box.style.opacity = '0'; box.style.transform = 'translateY(12px)'; }, 7000);
      }
      setTimeout(show, 3000); setInterval(show, 20000);
    }
  }).catch(function () {});
})();`;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  if (url.searchParams.get("format") === "js") {
    return new Response(EMBED_JS, {
      headers: { ...corsHeaders, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" }
    });
  }
  const key = url.searchParams.get("key") ?? "";
  if (!/^[a-f0-9]{24}$/.test(key)) return json({ error: "Invalid key" }, 400);
  const admin = adminClient();
  const { data: b } = await admin.from("businesses").select("id, name, maps_url, widgets, google_rating, google_review_count").eq("public_key", key).maybeSingle();
  if (!b) return json({ error: "Not found" }, 404);
  const [{ data: top }, { data: all }] = await Promise.all([
    admin.from("reviews").select("author, rating, text, review_created_at").eq("business_id", b.id).gte("rating", 4).order("review_created_at", { ascending: false }).limit(12),
    admin.from("reviews").select("rating").eq("business_id", b.id)
  ]);
  const ratings = (all ?? []).map((r) => r.rating);
  const rating = ratings.length ? ratings.reduce((a, n) => a + n, 0) / ratings.length : 0;
  return json(
    {
      name: b.name,
      mapsUrl: /^https?:\/\//i.test(b.maps_url ?? "") ? b.maps_url : "",
      // Prefer Google's own totals (imported with the Places API) over what's stored here
      rating: b.google_rating != null ? Number(b.google_rating) : rating,
      count: b.google_review_count ?? ratings.length,
      widgets: b.widgets,
      poweredBy: Deno.env.get("WIDGET_POWERED_BY") || "Local Octo",
      reviews: (top ?? []).sort((a, c) => Number(!!c.text) - Number(!!a.text))
    },
    200,
    { "Cache-Control": "public, max-age=300" }
  );
});
