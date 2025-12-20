export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const allow = isAllowedOrigin(origin) ? origin : "https://kimura-jane.github.io";

  // CORS（GitHub Pages から叩くため）
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(allow),
    });
  }

  const body = JSON.stringify({ publicKey: env.VAPID_PUBLIC_KEY || "" });

  return new Response(body, {
    headers: {
      ...corsHeaders(allow),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
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
