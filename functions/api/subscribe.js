export async function onRequest({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  const allow = isAllowedOrigin(origin) ? origin : "https://kanatae-app.pages.dev";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allow) });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405, allow);
  }

  if (!env.KANATAE_PUSH_SUBS) {
    return json({ ok:false, error:"KV binding not found", expected:"env.KANATAE_PUSH_SUBS" }, 500, allow);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok:false, error:"Invalid JSON" }, 400, allow); }

  const subscription = body?.subscription;
  if (!subscription?.endpoint) {
    return json({ ok:false, error:"subscription.endpoint required" }, 400, allow);
  }

  // hour は 18/21 のみ
  const hour = body.hour === 18 ? 18 : 21;

  // places:
  // - "ALL" を受け取ったら「空配列＝全部」に統一
  // - 未指定も「空配列＝全部」に統一
  const rawPlaces = Array.isArray(body.places) ? body.places : [];
  const places = rawPlaces.includes("ALL") ? [] : rawPlaces;

  const id = await sha256Hex(subscription.endpoint);
  const key = `sub:${id}`;

  const record = {
    subscription,
    endpoint: subscription.endpoint,
    places,   // ← 空配列なら「全部」
    hour,
    updatedAt: new Date().toISOString(),
  };

  await env.KANATAE_PUSH_SUBS.put(key, JSON.stringify(record));
  return json({ ok:true, key, saved: { hour, placesCount: places.length } }, 200, allow);
}

function isAllowedOrigin(origin) {
  return [
    "https://kimura-jane.github.io",
    "https://kanatae-app.pages.dev",
  ].includes(origin);
}
function corsHeaders(allowOrigin) {
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin",
  };
}
function json(obj, status, allowOrigin) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      ...corsHeaders(allowOrigin),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(digest);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
