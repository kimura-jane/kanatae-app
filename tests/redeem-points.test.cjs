"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const filename = fs.existsSync(path.join(root, "www/app.js")) ? "www/app.js" : "app.js";
const source = fs.readFileSync(path.join(root, filename), "utf8");
const start = source.indexOf('document.getElementById("redeem-btn").addEventListener("click", async () => {');
const end = source.indexOf('\n\ndocument.getElementById("megami-use-btn").addEventListener', start);
assert.ok(start >= 0 && end > start, "redeem handler exists");

function environment(config = {}) {
  let handler = null, requests = 0, release = null;
  const btn = { disabled: false, style: { display: "block" } };
  const stamp = { textContent: String(config.starting ?? 42) };
  const alerts = [], stamps = [], prompts = [];
  let coupon = false;
  const mockDocument = {
    getElementById(name) {
      if (name === "redeem-btn") return {
        get disabled() { return btn.disabled; },
        set disabled(v) { btn.disabled = v; },
        get style() { return btn.style; },
        addEventListener(name, fn) { if (name === "click") handler = fn; }
      };
      if (name === "stamp-current") return stamp;
      throw new Error("unexpected element " + name);
    }
  };
  const fetchImpl = async () => {
    requests += 1;
    if (config.wait) await new Promise(resolve => { release = resolve; });
    const status = config.status || 200;
    return { ok: status === 200, status, json: async () => status === 200
      ? { ok: true, ...(config.returnPoints === false ? {} : { current_points: config.remainder ?? 22 }) }
      : { error: "already used" }
    };
  };
  const context = {
    document: mockDocument,
    API_BASE: "https://example.invalid",
    DEVICE_ID: "dev_test",
    fetch: fetchImpl,
    confirm: txt => { prompts.push(txt); return true; },
    alert: txt => alerts.push(txt),
    updateStampUI: points => { stamps.push(points); stamp.textContent = String(points); },
    updateMegamiCouponUI: () => {},
    loadPoints: async () => {
      if (config.loadFails) return false;
      stamp.textContent = String(config.refreshedPoints ?? 22);
      stamps.push(config.refreshedPoints ?? 22);
      return true;
    }
  };
  Object.defineProperty(context, "megamiCouponActive", {
    get() { return coupon; }, set(v) { coupon = v; }
  });
  vm.runInNewContext(source.slice(start, end), context, { filename });
  return { trigger: () => handler(), get requests() { return requests; },
    get disabled() { return btn.disabled; }, get coupon() { return coupon; },
    get display() { return btn.style.display; },
    get stamp() { return stamp.textContent; }, stamps, alerts, prompts,
    release: () => { assert.equal(typeof release, "function"); release(); }
  };
}

test("redeem keeps remainder (42→22) and says 20 points are used, not reset", async () => {
  const e = environment();
  await e.trigger();
  assert.equal(e.stamp, "22");
  assert.equal(e.coupon, true);
  assert.equal(e.requests, 1);
  assert.match(e.prompts[0], /20ポイント/);
  assert.doesNotMatch(e.prompts[0], /0にリセット/);
});

test("redeem refreshes authoritative balance when response omits current_points", async () => {
  const e = environment({ returnPoints: false, refreshedPoints: 22 });
  await e.trigger();
  assert.equal(e.stamp, "22");
  assert.deepEqual(e.stamps, [22]);
});

test("redeem does not display a fake balance on failed refresh", async () => {
  const e = environment({ returnPoints: false, loadFails: true });
  await e.trigger();
  assert.equal(e.stamp, "確認中");
  assert.equal(e.display, "none");
});

test("failed redemption does not erase points or mark coupon active", async () => {
  const e = environment({ status: 409 });
  await e.trigger();
  assert.equal(e.stamp, "42");
  assert.equal(e.coupon, false);
  assert.equal(e.requests, 1);
});

test("concurrent taps send only one redemption request", async () => {
  const e = environment({ wait: true });
  const first = e.trigger();
  const second = e.trigger();
  await second;
  assert.equal(e.requests, 1);
  assert.equal(e.disabled, true);
  e.release();
  await first;
  assert.equal(e.disabled, false);
});
