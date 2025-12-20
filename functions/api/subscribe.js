export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const allow = isAllowedOrigin(origin) ? origin : "https://kimura-jane.github.io";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allow) });
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405, allow);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400, allow);
  }

  const sub = payload && payload.subscription;
  if (!sub || !sub.endpoint) {
    return json({ ok: false, error: "subscription.endpoint required" }, 400, allow);
  }

  // endpoint をキーにすると長すぎる場合があるのでSHA-256で短くする
  const key = "sub:" + (await sha256Hex(sub.endpoint));
  await env.KANATAE_PUSH_SUBS.put(key, JSON.stringify(sub));

  return json({ ok: true }, 200, allow);
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
  };
}

function json(obj, status, allowOrigin) {
  return new Response(JSON.stringify(obj), {
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
