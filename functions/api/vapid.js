// functions/api/vapid.js
export async function onRequest(context) {
  const { request, env } = context;

  const origin = request.headers.get("Origin") || "";
  const allowOrigin = getAllowOrigin(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allowOrigin) });
  }

  if (!env.VAPID_PUBLIC_KEY) {
    return json({ ok: false, error: "VAPID_PUBLIC_KEY is missing in Worker/Pages Variables" }, 500, allowOrigin);
  }

  return json({ ok: true, publicKey: env.VAPID_PUBLIC_KEY }, 200, allowOrigin);
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
