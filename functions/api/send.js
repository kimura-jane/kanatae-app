// functions/api/send.js
// - spots-feed.json から「明日」の出店を拾う
// - KVの購読者へ Web Push 送信
// - hour(18/21) / places(placeId or ALL) フィルタ対応
// - hour が null または places が ["off"] の購読者はスキップ
//
// 重要:
// - env に以下が必要
//   KANATAE_PUSH_SUBS (KV binding)
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT  (例: "mailto:you@example.com" など)

export async function onRequest({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  const allow = isAllowedOrigin(origin) ? origin : "https://kanatae-app.pages.dev";

  // Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allow) });
  }

  if (request.method !== "POST" && request.method !== "GET") {
    return json({ ok: false, error: "POST or GET only" }, 405, allow);
  }

  // Env check
  const miss = [];
  if (!env.KANATAE_PUSH_SUBS) miss.push("KANATAE_PUSH_SUBS (KV binding)");
  if (!env.VAPID_PUBLIC_KEY) miss.push("VAPID_PUBLIC_KEY");
  if (!env.VAPID_PRIVATE_KEY) miss.push("VAPID_PRIVATE_KEY");
  if (!env.VAPID_SUBJECT) miss.push("VAPID_SUBJECT");
  if (miss.length) {
    return json({ ok: false, error: "Missing env/bindings in Pages project", missing: miss }, 500, allow);
  }

  // Cron から hour 指定（任意）
  let filterHour = null;
  if (request.method === "POST") {
    try {
      const b = await request.json();
      if (b?.hour === 18 || b?.hour === 21) filterHour = b.hour;
    } catch {}
  }

  const tomorrowStr = getTomorrowYmdJST(); // "YYYY-MM-DD"

  // spots-feed.json（できるだけキャッシュに引っかけない）
  let spots = [];
  try {
    const feedRes = await fetch("https://kanatae-app.pages.dev/spots-feed.json", {
      cf: { cacheTtl: 0, cacheEverything: false },
      headers: { "cache-control": "no-store" },
    });
    spots = await feedRes.json();
    if (!Array.isArray(spots)) throw new Error("spots-feed.json is not an array");
  } catch (e) {
    return json({ ok: false, error: "Failed to fetch spots-feed.json", detail: e.message }, 500, allow);
  }

  // 明日の出店
  const tomorrowSpots = spots.filter(s => s?.date === tomorrowStr);

  if (tomorrowSpots.length === 0) {
    return json({
      ok: true,
      message: "No events tomorrow",
      tomorrow: tomorrowStr,
      total: 0, sent: 0, removed: 0, skipped: 0, failed: 0, errors: []
    }, 200, allow);
  }

  const tomorrowPlaceIds = tomorrowSpots.map(s => s.placeId).filter(Boolean);
  const tomorrowSpotInfo = tomorrowSpots[0]; // 通知文はまず1件目（複数対応は後で）

  let cursor = undefined;
  let total = 0, sent = 0, removed = 0, skipped = 0, failed = 0;
  const errors = [];

  // KV 全件走査（最大 50,000 件想定の安全弁）
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

      // hour 正規化: 18/21 以外は null（通知OFF扱い）
      const hourPref = (rec.hour === 18 || rec.hour === 21) ? rec.hour : null;

      // hour が null なら通知OFF → スキップ
      if (hourPref === null) {
        skipped++;
        continue;
      }

      // hourフィルタ：Cron が 18/21 を投げてきたら「一致する購読だけ送る」
      if (filterHour !== null && hourPref !== filterHour) {
        skipped++;
        continue;
      }

      // places フィルタ
      // - places が ["off"] => 通知OFF → スキップ
      // - places が空 => 全部通知
      // - "ALL" => 全部通知（互換）
      // - それ以外 => placeId一致で通知
      const places = Array.isArray(rec.places) ? rec.places : [];

      if (places.includes("off")) {
        skipped++;
        continue;
      }

      const placeOK =
        (places.length === 0) ||
        places.includes("ALL") ||
        places.some(p => tomorrowPlaceIds.includes(p));

      if (!placeOK) { skipped++; continue; }

      try {
        const sub = rec.subscription || { endpoint, keys: rec.keys };
        const r = await sendWebPush(env, sub, tomorrowSpotInfo);

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

  return json({
    ok: true,
    tomorrow: tomorrowStr,
    tomorrowSpots,
    filterHour,
    total, sent, removed, skipped, failed, errors
  }, 200, allow);
}

// ====== JST日付（安全に YYYY-MM-DD） ======
function getTomorrowYmdJST() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = fmt.formatToParts(now);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  if (!y || !m || !d) throw new Error("Failed to format JST date");

  const todayJstMidnight = new Date(`${y}-${m}-${d}T00:00:00+09:00`);
  const tomorrow = new Date(todayJstMidnight);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const parts2 = fmt.formatToParts(tomorrow);
  const y2 = parts2.find(p => p.type === "year")?.value;
  const m2 = parts2.find(p => p.type === "month")?.value;
  const d2 = parts2.find(p => p.type === "day")?.value;
  if (!y2 || !m2 || !d2) throw new Error("Failed to format JST tomorrow");
  return `${y2}-${m2}-${d2}`;
}

// ====== CORS/JSON ======
function isAllowedOrigin(origin) {
  return ["https://kimura-jane.github.io", "https://kanatae-app.pages.dev"].includes(origin);
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

// ====== Web Push ======
async function sendWebPush(env, subscription, spotInfo) {
  const endpoint = subscription.endpoint;
  const aud = new URL(endpoint).origin;
  const jwt = await createVapidJWT(env, aud);
  const publicKey = env.VAPID_PUBLIC_KEY;

  const payload = JSON.stringify({
    title: "おにぎり屋かなたけ",
    body: `明日は${spotInfo.name}に出店します🍙${spotInfo.time ? `（${spotInfo.time}）` : ""}`,
    url: "/"
  });

  if (subscription.keys?.p256dh && subscription.keys?.auth) {
    const encrypted = await encryptPayload(subscription.keys, new TextEncoder().encode(payload));
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
  }

  return fetch(endpoint, {
    method: "POST",
    headers: {
      "TTL": "86400",
      "Authorization": `vapid t=${jwt}, k=${publicKey}`,
      "Content-Length": "0",
    },
  });
}

// ====== Payload Encryption (aes128gcm) ======
async function encryptPayload(keys, payload) {
  const p256dhBytes = b64uToBytes(keys.p256dh);
  const authBytes = b64uToBytes(keys.auth);

  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const localPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", localKeyPair.publicKey));

  const peerPublicKey = await crypto.subtle.importKey(
    "raw",
    p256dhBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    localKeyPair.privateKey,
    256
  ));

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const authInfo = concatBytes(
    new TextEncoder().encode("WebPush: info\0"),
    p256dhBytes,
    localPublicKey
  );

  const ikm = await hkdf(authBytes, sharedSecret, authInfo, 32);
  const cek = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  const paddedPayload = new Uint8Array(payload.length + 1);
  paddedPayload.set(payload, 0);
  paddedPayload[payload.length] = 2;

  const cryptoKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, paddedPayload));

  const recordSize = 4096;
  const header = new Uint8Array(21 + localPublicKey.length);
  header.set(salt, 0);
  header[16] = (recordSize >> 24) & 0xff;
  header[17] = (recordSize >> 16) & 0xff;
  header[18] = (recordSize >> 8) & 0xff;
  header[19] = recordSize & 0xff;
  header[20] = localPublicKey.length;
  header.set(localPublicKey, 21);

  return concatBytes(header, encrypted);
}

async function hkdf(salt, ikm, info, length) {
  const keyMaterial = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    keyMaterial,
    length * 8
  ));
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ====== VAPID JWT (ES256) ======
async function createVapidJWT(env, aud) {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud, exp: now + 43200, sub: env.VAPID_SUBJECT };

  const encHeader = b64u(JSON.stringify(header));
  const encPayload = b64u(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;

  const key = await importVapidPrivateKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  ));

  const sigJose = sigToJose(sig);
  return `${signingInput}.${b64uBytes(sigJose)}`;
}

async function importVapidPrivateKey(publicB64u, privateB64u) {
  const pub = b64uToBytes(publicB64u);
  const priv = b64uToBytes(privateB64u);

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
    ext: true
  };

  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

function sigToJose(sig) {
  if (sig.length === 64) return sig;
  if (sig[0] === 0x30) return derToJose(sig);
  throw new Error("Unknown signature format");
}

function derToJose(der) {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error("Invalid DER");

  let seqLen = der[offset++];
  if (seqLen & 0x80) {
    const lenBytes = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < lenBytes; i++) seqLen = (seqLen << 8) | der[offset++];
  }

  if (der[offset++] !== 0x02) throw new Error("Invalid DER");
  let rLen = der[offset++];
  let r = der.slice(offset, offset + rLen);
  offset += rLen;

  if (der[offset++] !== 0x02) throw new Error("Invalid DER");
  let sLen = der[offset++];
  let s = der.slice(offset, offset + sLen);

  while (r.length > 32 && r[0] === 0) r = r.slice(1);
  while (s.length > 32 && s[0] === 0) s = s.slice(1);

  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

// ====== base64url ======
function b64u(str) { return b64uBytes(new TextEncoder().encode(str)); }

function b64uBytes(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
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
