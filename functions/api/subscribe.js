export async function onRequest({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  const allow = isAllowedOrigin(origin) ? origin : "https://kanatae-app.pages.dev";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allow) });
  }

  // ★ GET: 設定取得（既存の登録を返す）
  if (request.method === "GET") {
    if (!env.KANATAE_PUSH_SUBS) {
      return json({ ok: false, error: "KV binding not found" }, 500, allow);
    }
    const url = new URL(request.url);
    const endpoint = url.searchParams.get("endpoint") || "";
    if (!endpoint) {
      return json({ ok: false, error: "endpoint query required" }, 400, allow);
    }
    const id = await sha256Hex(endpoint);
    const key = `sub:${id}`;
    const raw = await env.KANATAE_PUSH_SUBS.get(key);
    if (!raw) {
      return json({ ok: true, registered: false }, 200, allow);
    }
    let rec;
    try { rec = JSON.parse(raw); } catch {
      return json({ ok: true, registered: false }, 200, allow);
    }
    const hourVal = (rec.hour === 18 || rec.hour === 21) ? rec.hour : null;
    const places = Array.isArray(rec.places) ? rec.places : [];
    const isOff = hourVal === null || places.includes("off");
    return json({
      ok: true,
      registered: true,
      pushOn: !isOff,
      hour: hourVal,
      places: places
    }, 200, allow);
  }

  // ★ POST: 設定保存（既存のまま変更なし）
  if (request.method !== "POST") {
    return json({ ok: false, error: "GET or POST only" }, 405, allow);
  }

  if (!env.KANATAE_PUSH_SUBS) {
    return json({ ok: false, error: "KV binding not found", expected: "env.KANATAE_PUSH_SUBS" }, 500, allow);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON" }, 400, allow); }

  const subscription = body?.subscription;
  if (!subscription?.endpoint) {
    return json({ ok: false, error: "subscription.endpoint required" }, 400, allow);
  }

  const hour = (body.hour === 18 || body.hour === 21) ? body.hour : null;

  const rawPlaces = Array.isArray(body.places) ? body.places : [];
  const places = rawPlaces.includes("ALL") ? [] : rawPlaces;

  const id = await sha256Hex(subscription.endpoint);
  const key = `sub:${id}`;

  const record = {
    subscription,
    endpoint: subscription.endpoint,
    places,
    hour,
    updatedAt: new Date().toISOString(),
  };

  await env.KANATAE_PUSH_SUBS.put(key, JSON.stringify(record));
  return json({ ok: true, key, saved: { hour, placesCount: places.length } }, 200, allow);
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
