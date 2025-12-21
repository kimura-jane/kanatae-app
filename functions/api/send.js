export async function onRequest({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  const allow = isAllowedOrigin(origin) ? origin : "https://kanatae-app.pages.dev";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allow) });
  }

  if (request.method !== "POST" && request.method !== "GET") {
    return json({ ok: false, error: "POST or GET only" }, 405, allow);
  }

  const miss = [];
  if (!env.KANATAE_PUSH_SUBS) miss.push("KANATAE_PUSH_SUBS (KV binding)");
  if (!env.VAPID_PUBLIC_KEY) miss.push("VAPID_PUBLIC_KEY");
  if (!env.VAPID_PRIVATE_KEY) miss.push("VAPID_PRIVATE_KEY");
  if (!env.VAPID_SUBJECT) miss.push("VAPID_SUBJECT");
  if (miss.length) {
    return json({ ok: false, error: "Missing env/bindings in Pages project", missing: miss }, 500, allow);
  }

  // リクエストからhourを取得（Cronから来る）
  let filterHour = null;
  if (request.method === "POST") {
    try {
      const b = await request.json();
      if (b?.hour === 18 || b?.hour === 21) filterHour = b.hour;
    } catch {}
  }

  // 明日の日付を取得（JST）
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const tomorrow = new Date(jstNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0]; // "2025-12-22" 形式

  // spots-feed.json を取得
  let spots = [];
  try {
    const feedRes = await fetch("https://kanatae-app.pages.dev/spots-feed.json");
    spots = await feedRes.json();
  } catch (e) {
    return json({ ok: false, error: "Failed to fetch spots-feed.json", detail: e.message }, 500, allow);
  }

  // 明日の出店を探す
  const tomorrowSpots = spots.filter(s => s.date === tomorrowStr);
  
  if (tomorrowSpots.length === 0) {
    return json({ 
      ok: true, 
      message: "No events tomorrow", 
      tomorrow: tomorrowStr,
      total: 0, sent: 0, removed: 0, skipped: 0, failed: 0, errors: [] 
    }, 200, allow);
  }

  // 明日の出店場所のplaceIdリスト
  const tomorrowPlaceIds = tomorrowSpots.map(s => s.placeId);
  const tomorrowSpotInfo = tomorrowSpots[0]; // 通知に使う情報（複数あれば最初の1つ）

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

      const places = Array.isArray(rec.places) ? rec.places : [];
      const hour = rec.hour ?? null;

      // hourフィルタ: Cronから指定されたhourと一致するか
      if (filterHour !== null && hour !== null && hour !== filterHour) {
        skipped++;
        continue;
      }

      // placeフィルタ:
      // - places が空 = 「全ての出店」を選択 → 常に通知
      // - places に明日の出店場所が含まれている → 通知
      const placeOK = (places.length === 0) || places.some(p => tomorrowPlaceIds.includes(p));
      if (!placeOK) {
        skipped++;
        continue;
      }

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
    tomorrowSpots: tomorrowSpots,
    filterHour,
    total, sent, removed, skipped, failed, errors 
  }, 200, allow);
}

async function sendWebPush(env, subscription, spotInfo) {
  const endpoint = subscription.endpoint;
  const aud = new URL(endpoint).origin;
  const jwt = await createVapidJWT(env, aud);
  const publicKey = env.VAPID_PUBLIC_KEY;

  // 出店情報を含めた通知内容
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
  } else {
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

  const jwk = { kty: "EC", crv: "P-256", x: b64uBytes(x), y: b64uBytes(y), d: b64uBytes(priv), ext: true };
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
    headers: { ...corsHeaders(allowOrigin), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
