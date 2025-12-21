export async function onRequest({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  const allow = isAllowedOrigin(origin) ? origin : "https://kanatae-app.pages.dev";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allow) });
  }

  // GET も許可（テスト用）
  if (request.method !== "POST" && request.method !== "GET") {
    return json({ ok: false, error: "POST or GET only" }, 405, allow);
  }

  // 必須チェック
  const miss = [];
  if (!env.KANATAE_PUSH_SUBS) miss.push("KANATAE_PUSH_SUBS (KV binding)");
  if (!env.VAPID_PUBLIC_KEY) miss.push("VAPID_PUBLIC_KEY");
  if (!env.VAPID_PRIVATE_KEY) miss.push("VAPID_PRIVATE_KEY");
  if (!env.VAPID_SUBJECT) miss.push("VAPID_SUBJECT");
  if (miss.length) {
    return json({ ok: false, error: "Missing env/bindings in Pages project", missing: miss }, 500, allow);
  }

  // 絞り込み（任意）
  let filter = { place: "ALL", hour: null };
  if (request.method === "POST") {
    try {
      const b = await request.json();
      if (b?.place) filter.place = b.place;
      if (b?.hour === 18 || b?.hour === 21) filter.hour = b.hour;
    } catch {
      // 空でもOK
    }
  }

  let cursor = undefined;
  let total = 0, sent = 0, removed = 0, skipped = 0, failed = 0;
  const errors = [];

  for (let page = 0; page < 50; page++) {
    const res = await env.KANATAE_PUSH_SUBS.list({ prefix: "sub:", cursor, limit: 1000 });
    cursor = res.cursor;

    for (const k of res.keys) {
      total++;
      const raw = await env.KANATAE_PUSH_SUBS.get(k.name);
      if (!raw) { skipped++; continue; }

      let rec;
      try { rec = JSON.parse(raw); } catch { skipped++; continue; }

      const endpoint = rec?.endpoint || rec?.subscription?.endpoint;
      if (!endpoint) { skipped++; continue; }

      // 絞り込み（places が空配列の場合は「全て通知」扱い）
      const places = Array.isArray(rec.places) ? rec.places : ["ALL"];
      const hour = rec.hour ?? null;

      const placeOK = (filter.place === "ALL") || (places.length === 0) || places.includes("ALL") || places.includes(filter.place);
      const hourOK = (filter.hour == null) || (hour === filter.hour);
      if (!placeOK || !hourOK) { skipped++; continue; }

      try {
        const r = await sendWebPush(env, rec.subscription || { endpoint, keys: rec.keys });
        if (r.status === 404 || r.status === 410) {
          await env.KANATAE_PUSH_SUBS.delete(k.name);
          removed++;
        } else if (r.ok) {
          sent++;
        } else {
          const errText = await r.text().catch(() => "");
          errors.push({ endpoint: endpoint.slice(0, 60), status: r.status, body: errText.slice(0, 200) });
          failed++;
        }
      } catch (e) {
        errors.push({ endpoint: endpoint.slice(0, 60), error: e.message || String(e) });
        failed++;
      }
    }

    if (res.list_complete) break;
  }

  return json({ ok: true, filter, total, sent, removed, skipped, failed, errors }, 200, allow);
}

async function sendWebPush(env, subscription) {
  const endpoint = subscription.endpoint;
  const aud = new URL(endpoint).origin;
  const jwt = await createVapidJWT(env, aud);
  const publicKey = env.VAPID_PUBLIC_KEY;

  // ペイロード付きで送信
  const payload = JSON.stringify({
    title: "おにぎり屋かなたけ",
    body: "明日の出店のお知らせです🍙",
    url: "/"
  });

  const payloadBytes = new TextEncoder().encode(payload);

  // 暗号化が必要な場合はkeysを使う、なければペイロードなし
  if (subscription.keys && subscription.keys.p256dh && subscription.keys.auth) {
    // 暗号化ペイロード送信
    const encrypted = await encryptPayload(subscription.keys, payloadBytes);
    
    return fetch(endpoint, {
      method: "POST",
      headers: {
        "TTL": "86400",
        "Authorization": `vapid t=${jwt}, k=${publicKey}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
      },
      body: encrypted,
    });
  } else {
    // ペイロードなし送信
    return fetch(endpoint, {
      method: "POST",
      headers: {
        "TTL": "86400",
        "Authorization": `vapid t=${jwt}, k=${publicKey}`,
        "Content-Length": "0",
      },
    });
  }
}

async function encryptPayload(keys, payload) {
  const p256dhBytes = b64uToBytes(keys.p256dh);
  const authBytes = b64uToBytes(keys.auth);

  // ローカル鍵ペア生成
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const localPublicKey = await crypto.subtle.exportKey("raw", localKeyPair.publicKey);
  const localPublicKeyBytes = new Uint8Array(localPublicKey);

  // 相手の公開鍵をインポート
  const peerPublicKey = await crypto.subtle.importKey(
    "raw",
    p256dhBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // 共有シークレット
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    localKeyPair.privateKey,
    256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // salt生成
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF で IKM 生成
  const authInfo = concatBytes(
    new TextEncoder().encode("WebPush: info\0"),
    p256dhBytes,
    localPublicKeyBytes
  );

  const ikm = await hkdf(authBytes, sharedSecret, authInfo, 32);

  // Content encryption key と nonce
  const contentInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");

  const cek = await hkdf(salt, ikm, contentInfo, 16);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  // パディング（1バイトのデリミタ + パディング）
  const paddingLength = 0;
  const paddedPayload = new Uint8Array(payload.length + 1 + paddingLength);
  paddedPayload.set(payload, 0);
  paddedPayload[payload.length] = 2; // デリミタ

  // AES-GCM 暗号化
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    cek,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    cryptoKey,
    paddedPayload
  );

  // ヘッダー構築（aes128gcm形式）
  const recordSize = 4096;
  const header = new Uint8Array(16 + 4 + 1 + localPublicKeyBytes.length);
  header.set(salt, 0);
  header[16] = (recordSize >> 24) & 0xff;
  header[17] = (recordSize >> 16) & 0xff;
  header[18] = (recordSize >> 8) & 0xff;
  header[19] = recordSize & 0xff;
  header[20] = localPublicKeyBytes.length;
  header.set(localPublicKeyBytes, 21);

  return concatBytes(header, new Uint8Array(encrypted));
}

async function hkdf(salt, ikm, info, length) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    ikm,
    { name: "HKDF" },
    false,
    ["deriveBits"]
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt,
      info: info,
    },
    keyMaterial,
    length * 8
  );

  return new Uint8Array(derived);
}

function concatBytes(...arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

async function createVapidJWT(env, aud) {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud, exp: now + 60 * 60 * 12, sub: env.VAPID_SUBJECT };

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
  const pub = b64uToBytes(publicB64u);
  const priv = b64uToBytes(privateB64u);

  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error("Invalid VAPID public key");
  if (priv.length !== 32) throw new Error("Invalid VAPID private key");

  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);

  const jwk = { kty: "EC", crv: "P-256", x: b64uBytes(x), y: b64uBytes(y), d: b64uBytes(priv), ext: true };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

function derToJose(derSig, joseLen) {
  let o = 0;
  if (derSig[o++] !== 0x30) throw new Error("Invalid DER");
  let seqLen = derSig[o++];
  if (seqLen & 0x80) {
    const n = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < n; i++) seqLen = (seqLen << 8) | derSig[o++];
  }
  if (derSig[o++] !== 0x02) throw new Error("Invalid DER");
  let rLen = derSig[o++]; let r = derSig.slice(o, o + rLen); o += rLen;
  if (derSig[o++] !== 0x02) throw new Error("Invalid DER");
  let sLen = derSig[o++]; let s = derSig.slice(o, o + sLen);

  r = stripLeadingZeros(r); s = stripLeadingZeros(s);
  const out = new Uint8Array(joseLen);
  out.set(leftPad(r, joseLen / 2), 0);
  out.set(leftPad(s, joseLen / 2), joseLen / 2);
  return out;
}

function stripLeadingZeros(bytes) { let i = 0; while (i < bytes.length - 1 && bytes[i] === 0) i++; return bytes.slice(i); }
function leftPad(bytes, len) { if (bytes.length > len) throw new Error("Too long"); const out = new Uint8Array(len); out.set(bytes, len - bytes.length); return out; }

function b64u(str) { return b64uBytes(new TextEncoder().encode(str)); }
function b64uBytes(bytes) {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64uToBytes(s) {
  if (!s) throw new Error("Empty base64url");
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
