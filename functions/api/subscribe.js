// functions/api/subscribe.js
export async function onRequest(context) {
  const { request, env } = context;

  const origin = request.headers.get("Origin") || "";
  const allowOrigin = getAllowOrigin(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allowOrigin) });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405, allowOrigin);
  }
  if (!env.KANATAE_PUSH_SUBS) {
    return json(
      { ok: false, error: "KV binding not found", expected: "env.KANATAE_PUSH_SUBS" },
      500,
      allowOrigin
    );
  }

  let payload;
  try { payload = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON" }, 400, allowOrigin); }

  const subscription = payload?.subscription;
  if (!subscription?.endpoint) {
    return json({ ok: false, error: "subscription.endpoint required" }, 400, allowOrigin);
  }

  // ここから下は「場所/時間」拡張に耐えるように保存形式を統一
  const places = Array.isArray(payload?.places) ? payload.places : [];
  const mode = payload?.mode === "selected" ? "selected" : "all";
  const hour = (payload?.hour === 18 || payload?.hour === 21) ? payload.hour : null;

  const key = "sub:" + (await sha256Hex(subscription.endpoint));
  const record = {
    subscription,
    mode,          // "all" or "selected"
    places,        // 例: ["川口さくら病院", ...]
    hour,          // 18 or 21 or null
    updatedAt: new Date().toISOString(),
  };

  await env.KANATAE_PUSH_SUBS.put(key, JSON.stringify(record));

  return json({ ok: true, key }, 200, allowOrigin);
}

function getAllowOrigin(origin) {
  const allowed = [
    "https://kimura-jane.github.io",
    "https://kanatae-app.pages.dev",
  ];
  return allowed.includes(origin) ? origin : "";
}

function corsHeaders(allowOrigin) {
  const h = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (allowOrigin) h["Access-Control-Allow-Origin"] = allowOrigin;
  return h;
}

function json(obj, status, allowOrigin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...corsHeaders(allowOrigin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(digest);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
