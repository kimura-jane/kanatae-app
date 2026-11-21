/* 来店ポイント: オフライン仮受付キュー (v1)
 * サーバー反映前にポイント残高を増やさない。
 * Cloudflare 側には POST /checkin-v2 と request_id による冪等処理が必要。
 */
(function () {
  "use strict";

  const STORAGE_KEY = "kanatake_pending_checkins_v1";
  const CHECKIN_URL = "https://kanatake-api.la-kofu.workers.dev/checkin-v2";
  // 最大90日分の仮受付を保持できるよう余裕を確保。
  // 不受理記録は証拠として保持し、仮受付件数の上限には含めない。
  const MAX_PENDING_RECORDS = 180;
  const TIMEOUT_MS = 10000;
  let savedState = null;
  let storageLock = Promise.resolve();
  let flushPromise = null;
  let enqueuedDuringFlush = false;

  function dateInJst(value) {
    return new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function preferences() {
    if (window.Capacitor && window.Capacitor.isNativePlatform &&
        window.Capacitor.isNativePlatform() && window.Capacitor.Plugins) {
      return window.Capacitor.Plugins.Preferences || null;
    }
    return null;
  }

  function decode(raw) {
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.records) || !Number.isFinite(obj.revision)) return null;
      return {
        revision: obj.revision,
        records: obj.records.filter(function (item) {
          return item && typeof item.id === "string" &&
            typeof item.device_id === "string" &&
            typeof item.qr_data === "string" &&
            typeof item.scanned_date_jst === "string";
        })
      };
    } catch (_) {
      return null;
    }
  }

  async function loadState() {
    if (savedState) return savedState;
    let local = null;
    let native = null;
    try { local = decode(localStorage.getItem(STORAGE_KEY)); } catch (_) {}
    const prefs = preferences();
    if (prefs) {
      try {
        const result = await prefs.get({ key: STORAGE_KEY });
        native = decode(result.value);
      } catch (_) {}
    }
    if (local && native) {
      savedState = native.revision > local.revision ? native : local;
    } else {
      savedState = local || native || { revision: 0, records: [] };
    }
    return savedState;
  }

  async function storeRecords(records) {
    const previous = await loadState();
    const state = {
      revision: Math.max(Date.now(), previous.revision + 1),
      records: records
    };
    const raw = JSON.stringify(state);
    let persisted = false;
    try {
      localStorage.setItem(STORAGE_KEY, raw);
      persisted = true;
    } catch (_) {}
    const prefs = preferences();
    if (prefs) {
      try {
        await prefs.set({ key: STORAGE_KEY, value: raw });
        persisted = true;
      } catch (_) {}
    }
    if (!persisted) throw new Error("仮受付の保存領域を利用できません");
    savedState = state;
  }

  function serialized(task) {
    const work = storageLock.then(task, task);
    storageLock = work.catch(function () {});
    return work;
  }

  async function pendingRecords() {
    return serialized(async function () {
      const state = await loadState();
      return state.records.map(function (record) { return Object.assign({}, record); });
    });
  }

  async function enqueue(input) {
    return serialized(async function () {
      const state = await loadState();
      const qr = input && input.qr_data;
      if (typeof qr !== "string" || !qr.trim() || qr.length > 4096) {
        throw new Error("QRコードの内容を読み取れませんでした");
      }
      if (!input.device_id) throw new Error("端末IDを取得できませんでした");
      const now = new Date();
      const day = dateInJst(now);
      const existing = state.records.find(function (item) {
        return item.device_id === input.device_id &&
          item.scanned_date_jst === day && item.status === "pending";
      });
      if (existing) return { record: Object.assign({}, existing), duplicate: true };
      if (state.records.filter(function (item) { return item.status === "pending"; }).length >= MAX_PENDING_RECORDS) {
        throw new Error("未確定の来店記録が多すぎます。通信回復後に再度お試しください");
      }
      const record = {
        id: crypto.randomUUID(),
        device_id: input.device_id,
        qr_data: qr,
        scanned_at: now.toISOString(),
        scanned_date_jst: day,
        spot_name: typeof input.spot_name === "string" ? input.spot_name : "",
        status: "pending"
      };
      if (Number.isFinite(input.latitude) && Number.isFinite(input.longitude)) {
        record.latitude = input.latitude;
        record.longitude = input.longitude;
        if (Number.isFinite(input.accuracy)) record.accuracy = input.accuracy;
      }
      await storeRecords(state.records.concat(record));
      if (flushPromise) enqueuedDuringFlush = true;
      return { record: Object.assign({}, record), duplicate: false };
    });
  }

  async function submit(record) {
    if (navigator.onLine === false) return { status: "pending" };
    let controller = null;
    let timeout = null;
    try {
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
        timeout = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
      }
      const res = await fetch(CHECKIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: record.device_id,
          request_id: record.id,
          qr_data: record.qr_data,
          scanned_at: record.scanned_at,
          scanned_date_jst: record.scanned_date_jst,
          spot_name: record.spot_name,
          latitude: record.latitude == null ? null : record.latitude,
          longitude: record.longitude == null ? null : record.longitude,
          accuracy: record.accuracy == null ? null : record.accuracy
        }),
        signal: controller ? controller.signal : undefined
      });
      const data = await res.json().catch(function () { return {}; });
      if (res.ok && data.ok === true) {
        return { status: "confirmed", points: data.current_points };
      }
      if (res.status === 409 && data.error === "already checked in today") {
        return { status: "already", points: data.current_points };
      }
      // 新APIの公開前は仮受付を保持し、本番の旧APIに送信しない。
      if (res.status === 404 || res.status === 408 || res.status === 425 ||
          res.status === 429 || res.status >= 500) {
        return { status: "pending" };
      }
      // 期限超過の受付は削除せず、利用者が日時と理由を確認できるようにする。
      return {
        status: "rejected",
        error: res.status === 403 && data.error === "checkin_expired"
          ? "受付期限（90日）を過ぎています。店舗にご確認ください。"
          : String(data.error || "サーバーで受付できませんでした")
      };
    } catch (_) {
      return { status: "pending" };
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  }

  async function flushCore() {
    const result = { confirmed: [], already: [], rejected: [], pending: 0 };
    const snapshot = await pendingRecords();
    for (const record of snapshot) {
      if (record.status !== "pending") continue;
      const outcome = await submit(record);
      // API停止中は次の受付にも連続送信せず、次回の通信回復まで待つ。
      if (outcome.status === "pending") break;
      await serialized(async function () {
        const state = await loadState();
        const index = state.records.findIndex(function (item) { return item.id === record.id; });
        if (index === -1) return;
        const next = state.records.slice();
        if (outcome.status === "confirmed" || outcome.status === "already") {
          next.splice(index, 1);
        } else {
          next[index] = Object.assign({}, next[index], {
            status: "rejected",
            error: outcome.error
          });
        }
        await storeRecords(next);
      });
      if (outcome.status === "confirmed") result.confirmed.push({ id: record.id, points: outcome.points });
      if (outcome.status === "already") result.already.push({ id: record.id, points: outcome.points });
      if (outcome.status === "rejected") result.rejected.push({ id: record.id, error: outcome.error });
    }
    const left = await pendingRecords();
    result.pending = left.filter(function (item) { return item.status === "pending"; }).length;
    result.rejectedCount = left.filter(function (item) { return item.status === "rejected"; }).length;
    return result;
  }

  // 送信中に新しい受付が追加された場合、最初のスナップショットから
  // 漏れた受付を次のラウンドで送信する（上限2回、無限再送はしない）。
  async function flushRounds() {
    const combined = { confirmed: [], already: [], rejected: [], pending: 0, rejectedCount: 0 };
    for (let round = 0; round < 2; round++) {
      enqueuedDuringFlush = false;
      const result = await flushCore();
      combined.confirmed.push(...result.confirmed);
      combined.already.push(...result.already);
      combined.rejected.push(...result.rejected);
      combined.pending = result.pending;
      combined.rejectedCount = result.rejectedCount;
      if (!enqueuedDuringFlush || navigator.onLine === false ||
          (result.pending > 0 && result.confirmed.length === 0 && result.already.length === 0)) {
        break;
      }
    }
    return combined;
  }

  function flush() {
    if (!flushPromise) {
      flushPromise = flushRounds().finally(function () { flushPromise = null; });
    }
    return flushPromise;
  }

  window.KanatakeOfflineCheckin = {
    enqueue: enqueue,
    flush: flush,
    pendingRecords: pendingRecords
  };
})();
