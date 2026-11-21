/* 女神のほほえみ：サーバー操作の冪等キーを永続保存する。
 * 操作結果不明時は新しいIDを発行せず、利用者が同じIDで再試行する。
 * クーポン「使用」は店主の前でのみ再試行するため自動送信しない。
 */
(function () {
  "use strict";

  const STORAGE_KEY = "kanatake_coupon_operations_v1";
  let cached = null;
  let lock = Promise.resolve();

  function preferences() {
    const capacitor = window.Capacitor;
    if (capacitor && capacitor.isNativePlatform &&
        capacitor.isNativePlatform() && capacitor.Plugins) {
      return capacitor.Plugins.Preferences || null;
    }
    return null;
  }

  function parse(raw) {
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw);
      if (!obj || !Number.isSafeInteger(obj.revision) || obj.revision < 0) return null;
      const op = obj.pending;
      if (op !== null && op !== undefined &&
          (!op || !["redeem", "use"].includes(op.action) ||
           typeof op.device_id !== "string" ||
           typeof op.request_id !== "string" ||
           !/^[A-Za-z0-9_-]{1,128}$/.test(op.request_id) ||
           !Number.isSafeInteger(op.coupon_generation) || op.coupon_generation < 0)) {
        return null;
      }
      return { revision: obj.revision, pending: op || null };
    } catch (_) {
      return null;
    }
  }

  async function load() {
    if (cached) return cached;
    let local = null;
    let native = null;
    try { local = parse(localStorage.getItem(STORAGE_KEY)); } catch (_) {}
    const prefs = preferences();
    if (prefs) {
      try {
        const result = await prefs.get({ key: STORAGE_KEY });
        native = parse(result.value);
      } catch (_) {}
    }
    cached = local && native
      ? (native.revision > local.revision ? native : local)
      : (local || native || { revision: 0, pending: null });
    return cached;
  }

  async function save(pending) {
    const previous = await load();
    const state = {
      revision: Math.max(Date.now(), previous.revision + 1),
      pending: pending || null
    };
    const raw = JSON.stringify(state);
    let saved = false;
    try { localStorage.setItem(STORAGE_KEY, raw); saved = true; } catch (_) {}
    const prefs = preferences();
    if (prefs) {
      try { await prefs.set({ key: STORAGE_KEY, value: raw }); saved = true; } catch (_) {}
    }
    if (!saved) throw new Error("特典操作を端末に保存できません。もう一度お試しください。");
    cached = state;
  }

  function serialized(job) {
    const next = lock.then(job, job);
    lock = next.catch(function () {});
    return next;
  }

  function get(deviceId) {
    return serialized(async function () {
      const state = await load();
      const op = state.pending;
      if (!op) return null;
      if (op.device_id !== deviceId) {
        throw new Error("別の端末IDの未確認操作があります。アプリの設定をご確認ください。");
      }
      return Object.assign({}, op);
    });
  }

  function begin(action, deviceId, generation) {
    return serialized(async function () {
      const state = await load();
      if (state.pending) {
        if (state.pending.device_id !== deviceId ||
            state.pending.action !== action) {
          throw new Error("前回の特典操作が未確認です。先に結果を確認してください。");
        }
        return { operation: Object.assign({}, state.pending), resumed: true };
      }
      if (!["redeem", "use"].includes(action) ||
          typeof deviceId !== "string" || !deviceId ||
          !Number.isSafeInteger(generation) || generation < 0) {
        throw new Error("ポイント情報を確認できませんでした。通信状態をご確認ください。");
      }
      const operation = {
        action: action, device_id: deviceId,
        request_id: crypto.randomUUID(),
        coupon_generation: generation,
        created_at: new Date().toISOString()
      };
      await save(operation); // 必ずPOSTより先に保存する。
      return { operation: Object.assign({}, operation), resumed: false };
    });
  }

  function finish(operation) {
    return serialized(async function () {
      const state = await load();
      if (state.pending &&
          state.pending.request_id === operation.request_id &&
          state.pending.action === operation.action &&
          state.pending.device_id === operation.device_id) {
        await save(null);
      }
    });
  }

  window.KanatakeCouponOperations = Object.freeze({
    get: get, begin: begin, finish: finish
  });
})();
