// functions/api/send.js
export async function onRequest(context) {
  const { request, env } = context;

  // ---- CORS
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = getAllowOrigin(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allowOrigin) });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405, allowOrigin);
  }

  // ---- 最低限の防御（悪用防止）
  // Cloudflare に ADMIN_TOKEN を設定したら、それが無いと送れないようにする
  const adminToken = env.ADMIN_TOKEN || "";
  if (adminToken) {
    const got = request.headers.get("X-Admin-Token") || "";
    if (got !== adminToken) {
      return json({ ok: false, error: "Unauthorized" }, 401, allowOrigin);
    }
  }

  // ---- 必須envチェック
  const miss = missingEnv(env);
  if (miss.length) {
    return json({ ok: false, error: "Missing env", missing: miss }, 500, allowOrigin);
  }
  if (!env.KANATAE_PUSH_SUBS) {
    return json(
      { ok: false, error: "KV binding not found", expected: "env.KANATAE_PUSH_SUBS" },
      500,
      allowOrigin
    );
  }

  // ---- body（任意）: { endpoint?: string }
  // endpoint があれば単体送信、なければ全員に送信
  let body = null;
  try { body = await request.json(); } catch { body = null; }

  const KV = env.KANATAE_PUSH_SUBS;

  // 単体送信
  if (body && body.endpoint) {
    const r = await sendWebPushNoPayload(env, body.endpoint);
    return json(
      { ok: r.ok, status: r.status, endpoint: body.endpoint },
      r.ok ? 200 : 502,
      allowOrigin
    );
  }

  // 全体送信（KVはページングあり）
  let sent = 0;
  let removed = 0;
  let total = 0;

  let cursor = undefined;
  for (let page = 0; page < 50; page++) {
    const list = await KV.list({ prefix: "sub:", limit: 1000, cursor });
    total += list.keys.length;

    for (const k of list.keys) {
      const raw = await KV.get(k.name);
      if (!raw) continue;

      let rec;
      try { rec = JSON.parse(raw); } catch { continue; }

      // subscribe.js が {subscription:...} を保存する想定
      const endpoint = rec?.subscription?.endpoint || rec?.endpoint || null;
      if (!endpoint) continue;

      const res = await sendWebPushNoPayload(env, endpoint);

      // endpointが死んでる（410/404）なら掃除
      if (res.status === 404 || res.status === 410) {
        await KV.delete(k.name);
        removed++;
        continue;
      }
      if (res.ok) sent++;
    }

    if (list.list_complete) break;
    cursor = list.cursor;
  }

  return json({ ok: true, sent, removed, total }, 200, allowOrigin);
}

async function sendWebPushNoPayload(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const jwt = await createVapidJWT(env, aud);
  const publicKey = env.VAPID_PUBLIC_KEY; // base64url

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

function missingEnv(env) {
  const need = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
  return need.filter((k) => !env[k]);
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
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
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

function derToJose(derSig, joseLen) {
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
