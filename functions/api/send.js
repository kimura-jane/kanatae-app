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

  // Cron から hour 指定される（任意）
  let filterHour = null;
  if (request.method === "POST") {
    try {
      const b = await request.json();
      if (b?.hour === 18 || b?.hour === 21) filterHour = b.hour;
    } catch {}
  }

  const tomorrowStr = getTomorrowYmdJST(); // "YYYY-MM-DD"

  // spots-feed.json
  let spots = [];
  try {
    const feedRes = await fetch("https://kanatae-app.pages.dev/spots-feed.json", { cf: { cacheTtl: 0, cacheEverything: false } });
    spots = await feedRes.json();
  } catch (e) {
    return json({ ok: false, error: "Failed to fetch spots-feed.json", detail: e.message }, 500, allow);
  }

  const tomorrowSpots = spots.filter(s => s.date === tomorrowStr);

  if (tomorrowSpots.length === 0) {
    return json({
      ok: true,
      message: "No events tomorrow",
      tomorrow: tomorrowStr,
      total: 0, sent: 0, removed: 0, skipped: 0, failed: 0, errors: []
    }, 200, allow);
  }

  const tomorrowPlaceIds = tomorrowSpots.map(s => s.placeId);
  const tomorrowSpotInfo = tomorrowSpots[0]; // 通知文はまず1件目でOK（必要なら後で拡張）

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

      const hour = rec.hour ?? null;

      // hourフィルタ（設定してる人だけが対象）
      if (filterHour !== null && hour !== null && hour !== filterHour) {
        skipped++;
        continue;
      }

      // places フィルタ
      // - places が空配列 => 全部通知
      // - 互換で "ALL" が残ってても全部通知
      // - それ以外 => placeId一致で通知
      const places = Array.isArray(rec.places) ? rec.places : [];
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

// ====== JST日付を安全に ======
function getTomorrowYmdJST() {
  const now = new Date();
  // JST の “今日” を YYYY-MM-DD で取って +1日
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(now);
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  const today = new Date(`${y}-${m}-${d}T00:00:00+09:00`);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const parts2 = fmt.formatToParts(tomorrow);
  const y2 = parts2.find(p => p.type === "year").value;
  const m2 = parts2.find(p => p.type === "month").value;
  const d2 = parts2.find(p => p.type === "day").value;
  return `${y2}-${m2}-${d2}`;
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

// ====== 以下、暗号化/VAPID はお前の実装をそのまま使える ======
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

// ↓↓↓ ここから下（encryptPayload/createVapidJWT/b64u等）はお前の貼ったやつをそのまま置けばOK ↓↓↓
/* encryptPayload, hkdf, concatBytes, createVapidJWT, importVapidPrivateKey, sigToJose,
   derToJose, b64u, b64uBytes, b64uToBytes をそのままコピペ */
