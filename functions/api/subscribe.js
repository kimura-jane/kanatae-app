export async function onRequest(context) {
  const { request, env } = context;

  // CORS（GitHub Pagesから叩けるようにする）
  const origin = request.headers.get('Origin') || '';
  const allow = new Set([
    'https://kimura-jane.github.io',
    'https://kanatae-app.pages.dev'
  ]);

  const corsHeaders = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Origin': allow.has(origin) ? origin : 'https://kimura-jane.github.io',
    'Vary': 'Origin'
  };

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const body = await request.json().catch(() => null);
  const sub = body && body.subscription;

  if (!sub || !sub.endpoint) {
    return new Response('Bad Request', { status: 400, headers: corsHeaders });
  }

  // KVが必要（保存先）
  // PagesのKV binding名を PUSH_KV にしてある前提
  if (!env.PUSH_KV) {
    return new Response('KV (PUSH_KV) not bound', { status: 500, headers: corsHeaders });
  }

  // endpointをキー化（長いのでSHA-256で短くする）
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(sub.endpoint));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  const key = `sub:${hex}`;

  await env.PUSH_KV.put(key, JSON.stringify(sub));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders }
  });
}
