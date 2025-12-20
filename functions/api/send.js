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

  const list = await env.KANATAE_PUSH_SUBS.list({ prefix: "sub:" });
  let sent = 0;
  let removed = 0;

  for (const k of list.keys) {
    const raw = await env.KANATAE_PUSH_SUBS.get(k.name);
    if (!raw) continue;

    let sub;
    try { sub = JSON.parse(raw); } catch { continue; }
    if (!sub.endpoint) continue;

    const res = await sendWebPushNoPayload(env, sub.endpoint);

    // endpointが死んでる（410/404）なら掃除
    if (res.status === 404 || res.status === 410) {
      await env.KANATAE_PUSH_SUBS.delete(k.name);
      removed++;
      continue;
    }

    if (res.ok) sent++;
  }

  return json({ ok: true, sent, removed, total: list.keys.length }, 200, allow);
}

async function sendWebPushNoPayload(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const jwt = await createVapidJWT(env, aud);

  // VAPID の公開鍵は base64url 文字列のままヘッダへ
  const publicKey = env.VAPID_PUBLIC_KEY;

  return fetch(endpoint, {
    method: "POST",
    headers: {
      "TTL": "60",
      "Authorization": `vapid t=${jwt}, k=${publicKey}`,
      "Crypto-Key": `p256ecdsa=${publicKey}`,
      "Content-Length": "0",
    },
  });
}

async function createVapidJWT(env, aud) {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud,
    exp: now + 60 * 60 * 12,
    sub: env.VAPID_SUBJECT,
  };

  const encHeader = b64u(JSON.stringify(header));
  const encPayload = b64u(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;

  const key = await importVapidPrivateKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

  const sigDer = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput)
    )
  );

  const sigJose = derToJose(sigDer, 64);
  const encSig = b64uBytes(sigJose);

  return `${signingInput}.${encSig}`;
}

async function importVapidPrivateKey(publicB64u, privateB64u) {
  const pub = b64uToBytes(publicB64u);     // 65 bytes: 0x04 || X(32) || Y(32)
  const priv = b64uToBytes(privateB64u);   // 32 bytes

  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error("Invalid VAPID public key");
  if (priv.length !== 32) throw new Error("Invalid VAPID private key");

  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);

  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: b64uBytes(x),
    y: b64uBytes(y),
    d: b64uBytes(priv),
    ext: true,
  };

  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

function derToJose(derSig, joseLen) {
  // ASN.1 DER ECDSA signature -> JOSE (R||S)
  let offset = 0;
  if (derSig[offset++] !== 0x30) throw new Error("Invalid DER");
  let seqLen = derSig[offset++];
  if (seqLen & 0x80) {
    const n = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < n; i++) seqLen = (seqLen << 8) | derSig[offset++];
  }

  if (derSig[offset++] !== 0x02) throw new Error("Invalid DER");
  let rLen = derSig[offset++];
  let r = derSig.slice(offset, offset + rLen);
  offset += rLen;

  if (derSig[offset++] !== 0x02) throw new Error("Invalid DER");
  let sLen = derSig[offset++];
  let s = derSig.slice(offset, offset + sLen);

  r = stripLeadingZeros(r);
  s = stripLeadingZeros(s);

  const out = new Uint8Array(joseLen);
  out.set(leftPad(r, joseLen / 2), 0);
  out.set(leftPad(s, joseLen / 2), joseLen / 2);
  return out;
}

function stripLeadingZeros(bytes) {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  return bytes.slice(i);
}

function leftPad(bytes, len) {
  if (bytes.length > len) throw new Error("Too long");
  const out = new Uint8Array(len);
  out.set(bytes, len - bytes.length);
  return out;
}

function b64u(str) {
  return b64uBytes(new TextEncoder().encode(str));
}

function b64uBytes(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64uToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
