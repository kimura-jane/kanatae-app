export async function onRequest({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  const allow = isAllowedOrigin(origin) ? origin : "https://kanatae-app.pages.dev";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allow) });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405, allow);
  }

  // 必須チェック（ここが無いと 1101 になりやすい）
  const miss = [];
  if (!env.KANATAE_PUSH_SUBS) miss.push("KANATAE_PUSH_SUBS (KV binding)");
  if (!env.VAPID_PUBLIC_KEY) miss.push("VAPID_PUBLIC_KEY");
  if (!env.VAPID_PRIVATE_KEY) miss.push("VAPID_PRIVATE_KEY");
  if (!env.VAPID_SUBJECT) miss.push("VAPID_SUBJECT");
  if (miss.length) {
    return json({ ok:false, error:"Missing env/bindings in Pages project", missing: miss }, 500, allow);
  }

  // 絞り込み（任意）
  // body: { place:"ALL" | "川口さくら病院" | ... , hour:18|21 }
  let filter = { place: "ALL", hour: null };
  try {
    const b = await request.json();
    if (b?.place) filter.place = b.place;
    if (b?.hour === 18 || b?.hour === 21) filter.hour = b.hour;
  } catch {
    // 空でもOK
  }

  let cursor = undefined;
  let total = 0, sent = 0, removed = 0, skipped = 0, failed = 0;

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

      // 絞り込み
      const places = Array.isArray(rec.places) ? rec.places : ["ALL"];
      const hour = rec.hour ?? null;

      const placeOK = (filter.place === "ALL") || places.includes("ALL") || places.includes(filter.place);
      const hourOK  = (filter.hour == null) || (hour === filter.hour);
      if (!placeOK || !hourOK) { skipped++; continue; }

      try {
        const r = await sendWebPushNoPayload(env, endpoint);
        if (r.status === 404 || r.status === 410) {
          await env.KANATAE_PUSH_SUBS.delete(k.name);
          removed++;
        } else if (r.ok) {
          sent++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    if (res.list_complete) break;
  }

  return json({ ok:true, filter, total, sent, removed, skipped, failed }, 200, allow);
}

async function sendWebPushNoPayload(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const jwt = await createVapidJWT(env, aud);
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

  const jwk = { kty:"EC", crv:"P-256", x:b64uBytes(x), y:b64uBytes(y), d:b64uBytes(priv), ext:true };
  return crypto.subtle.importKey("jwk", jwk, { name:"ECDSA", namedCurve:"P-256" }, false, ["sign"]);
}

function derToJose(derSig, joseLen) {
  let o = 0;
  if (derSig[o++] !== 0x30) throw new Error("Invalid DER");
  let seqLen = derSig[o++];
  if (seqLen & 0x80) {
    const n = seqLen & 0x7f;
    seqLen = 0;
    for (let i=0;i<n;i++) seqLen = (seqLen<<8) | derSig[o++];
  }
  if (derSig[o++] !== 0x02) throw new Error("Invalid DER");
  let rLen = derSig[o++]; let r = derSig.slice(o, o+rLen); o += rLen;
  if (derSig[o++] !== 0x02) throw new Error("Invalid DER");
  let sLen = derSig[o++]; let s = derSig.slice(o, o+sLen);

  r = stripLeadingZeros(r); s = stripLeadingZeros(s);
  const out = new Uint8Array(joseLen);
  out.set(leftPad(r, joseLen/2), 0);
  out.set(leftPad(s, joseLen/2), joseLen/2);
  return out;
}
function stripLeadingZeros(bytes){ let i=0; while(i<bytes.length-1 && bytes[i]===0) i++; return bytes.slice(i); }
function leftPad(bytes,len){ if(bytes.length>len) throw new Error("Too long"); const out=new Uint8Array(len); out.set(bytes, len-bytes.length); return out; }

function b64u(str){ return b64uBytes(new TextEncoder().encode(str)); }
function b64uBytes(bytes){
  let bin=""; for(const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function b64uToBytes(s){
  if (!s) throw new Error("Empty base64url");
  s = s.replace(/-/g,"+").replace(/_/g,"/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
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
