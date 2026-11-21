"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appPath = fs.existsSync(path.join(root, "www/app.js")) ? "www/app.js" : "app.js";
const helperPath = fs.existsSync(path.join(root, "www/coupon-operations.js"))
  ? "www/coupon-operations.js" : "coupon-operations.js";
const app = fs.readFileSync(path.join(root, appPath), "utf8");
const helper = fs.readFileSync(path.join(root, helperPath), "utf8");
const start = app.indexOf("let megamiCouponActive = false;");
const end = app.indexOf("// ===== カレンダー =====", start);
assert.ok(start !== -1 && end > start, "coupon handlers must exist");

function browser(options = {}) {
  const storage = options.storage || new Map();
  const nativeStorage = options.nativeStorage || new Map();
  const elements = new Map();
  const callbacks = new Map();
  const alerts = [];
  const confirms = [];
  const requests = [];
  const ledger = options.ledger || new Map();
  const points = options.points || { current_points: 42, total_redeemed: 2, megami_coupon_active: 0 };
  let uuid = 0;
  let failAfterCommit = !!options.failAfterCommit;
  let forcedConflict = !!options.forcedConflict;
  let posts = 0;

  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        textContent: "", innerHTML: "", style: { display: "none" },
        disabled: false,
        addEventListener(name, callback) { callbacks.set(id + ":" + name, callback); }
      });
    }
    return elements.get(id);
  }

  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body || "{}");
    requests.push({ url, body });
    if (url.endsWith("/points")) {
      if (options.failPoints) throw Error("points unreachable");
      return { ok: true, status: 200, json: async () => ({ ...points }) };
    }
    posts++;
    if (forcedConflict) {
      forcedConflict = false;
      return { ok: false, status: 409, json: async () =>
        ({ code: "coupon_state_conflict", error: "state changed" }) };
    }
    const action = url.endsWith("/redeem-points") ? "redeem" : "use";
    const key = action + ":" + body.request_id;
    const replayed = ledger.has(key);
    if (!replayed) {
      if (action === "redeem" &&
          (points.current_points < 20 || points.megami_coupon_active)) {
        return { ok: false, status: 409, json: async () => ({ error: "state changed" }) };
      }
      if (action === "use" && !points.megami_coupon_active) {
        return { ok: false, status: 409, json: async () => ({ error: "already used" }) };
      }
      if (body.coupon_generation !== points.total_redeemed) {
        return { ok: false, status: 409, json: async () => ({ error: "generation mismatch" }) };
      }
      ledger.set(key, { ...body });
      if (action === "redeem") {
        points.current_points -= 20;
        points.total_redeemed += 1;
        points.megami_coupon_active = 1;
      } else {
        points.megami_coupon_active = 0;
      }
    }
    if (failAfterCommit) {
      failAfterCommit = false;
      throw Error("response lost after commit");
    }
    return { ok: true, status: 200,
      json: async () => ({ ok: true, replayed, ...points }) };
  };

  const document = {
    getElementById: element,
    querySelectorAll() { return []; }
  };
  const localStorage = {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) {
      if (options.storageFails) throw Error("storage unavailable");
      storage.set(key, value);
    }
  };
  const window = options.native ? { Capacitor: {
    isNativePlatform: () => true,
    Plugins: { Preferences: {
      get: async ({ key }) => ({ value: nativeStorage.get(key) || null }),
      set: async ({ key, value }) => { nativeStorage.set(key, value); }
    } }
  }} : {};
  const context = {
    window, document, localStorage,
    crypto: { randomUUID: () => "op-" + (++uuid) },
    fetch: fetcher, API_BASE: "https://example.invalid", DEVICE_ID: "dev_test",
    alert: message => alerts.push(message),
    confirm: message => { confirms.push(message); return true; },
    Date, console
  };
  vm.runInNewContext(helper + "\n" + app.slice(start, end) +
    "\nthis.testApi={loadPoints,runCouponOperation,updateCouponOperationDisplay};",
    context, { filename: appPath });
  return {
    get api() { return context.testApi; }, requests, alerts, confirms, ledger, points,
    storage, nativeStorage, posts: () => posts, element,
    click: id => callbacks.get(id + ":click")(),
    pending: () => JSON.parse(storage.get("kanatake_coupon_operations_v1") || "null")?.pending || null
  };
}

test("redemption sends durable request_id, current coupon_generation, and consumes 20 only", async () => {
  const b = browser();
  await b.api.loadPoints();
  await b.api.runCouponOperation("redeem");
  const post = b.requests.find(r => r.url.endsWith("/redeem-points"));
  assert.equal(post.body.coupon_generation, 2);
  assert.match(post.body.request_id, /^op-/);
  assert.equal(post.body.required_points, 20);
  assert.equal(b.element("stamp-current").textContent, 22);
  assert.equal(b.points.total_redeemed, 3);
  assert.equal(b.pending(), null);
});

test("timeout after a committed redemption retains ID and retry never consumes another 20", async () => {
  const store = new Map(), ledger = new Map(), points = { current_points: 42, total_redeemed: 2, megami_coupon_active: 0 };
  const first = browser({ storage: store, ledger, points, failAfterCommit: true });
  await first.api.loadPoints();
  await first.api.runCouponOperation("redeem");
  const recorded = first.pending();
  assert.equal(points.current_points, 22);
  assert.ok(recorded);
  assert.equal(recorded.coupon_generation, 2);
  const second = browser({ storage: store, ledger, points });
  await second.api.loadPoints();
  assert.equal(second.posts(), 0); // do not auto-redeem on relaunch
  await second.api.updateCouponOperationDisplay();
  assert.equal(second.element("coupon-operation-retry").style.display, "block");
  await second.api.runCouponOperation("redeem");
  const call = second.requests.find(r => r.url.endsWith("/redeem-points"));
  assert.equal(call.body.request_id, recorded.request_id);
  assert.equal(call.body.coupon_generation, 2);
  assert.equal(points.current_points, 22);
  assert.equal(second.pending(), null);
  assert.match(second.alerts.join(" "), /前回の操作結果/);
});

test("coupon use is never retried automatically and uses same persisted generation", async () => {
  const store = new Map(), ledger = new Map();
  const points = { current_points: 22, total_redeemed: 3, megami_coupon_active: 1 };
  const first = browser({ storage: store, ledger, points, failAfterCommit: true });
  await first.api.loadPoints();
  await first.api.runCouponOperation("use");
  const pending = first.pending();
  assert.equal(pending.action, "use");
  assert.equal(pending.coupon_generation, 3);
  assert.equal(points.megami_coupon_active, 0);
  const next = browser({ storage: store, ledger, points });
  await next.api.loadPoints();
  assert.equal(next.posts(), 0);
  await next.api.runCouponOperation("use");
  assert.equal(next.requests.find(r => r.url.endsWith("/megami-coupon/use")).body.request_id, pending.request_id);
  assert.equal(next.pending(), null);
});

test("409 conflict refreshes points and ends the old pending attempt", async () => {
  const b = browser({ forcedConflict: true });
  await b.api.loadPoints();
  await b.api.runCouponOperation("redeem");
  assert.equal(b.pending(), null);
  assert.equal(b.points.current_points, 42);
  assert.ok(b.requests.filter(r => r.url.endsWith("/points")).length >= 3);
  assert.match(b.alerts.join(" "), /状態を更新/);
});

test("storage failure must stop before any coupon POST", async () => {
  const b = browser({ storageFails: true });
  await b.api.loadPoints();
  await b.api.runCouponOperation("redeem");
  assert.equal(b.posts(), 0);
  assert.equal(b.points.current_points, 42);
});

test("native Preferences preserve pending ID when local storage cannot write", async () => {
  const pref = new Map(), points = { current_points: 42, total_redeemed: 2, megami_coupon_active: 0 };
  const ledger = new Map();
  const b = browser({ native: true, nativeStorage: pref, storageFails: true, points, ledger, failAfterCommit: true });
  await b.api.loadPoints();
  await b.api.runCouponOperation("redeem");
  const saved = JSON.parse(pref.get("kanatake_coupon_operations_v1"));
  assert.ok(saved.pending.request_id);
  assert.equal(points.current_points, 22);
  const fresh = browser({ native: true, nativeStorage: pref, storageFails: true, points, ledger });
  await fresh.api.runCouponOperation("redeem");
  assert.equal(points.current_points, 22);
  assert.equal(fresh.posts(), 1);
});
