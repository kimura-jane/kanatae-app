"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const file = fs.existsSync(path.join(root, "www/app.js")) ? "www/app.js" : "app.js";
const source = fs.readFileSync(path.join(root, file), "utf8");
const from = source.indexOf("async function loadMyCoupons() {");
const until = source.indexOf("// ===== QRスキャン =====", from);
assert.ok(from >= 0 && until > from, "coupon handlers exist");

function setup(rows) {
  const sent = [];
  const buttons = rows.map((item, index) => ({
    dataset: { couponRow: String(index) },
    addEventListener(event, handler) { if (event === "click") this.click = handler; }
  }));
  const area = { style: { display: "none" } };
  const list = {
    innerHTML: "",
    querySelectorAll() { return buttons; }
  };
  const alerts = [];
  const context = {
    document: {
      getElementById(id) {
        return id === "my-coupons-area" ? area : list;
      }
    },
    API_BASE: "https://example.invalid",
    DEVICE_ID: "dev_test",
    fetch: async (url, options) => {
      if (url.includes("/my-coupons")) {
        return { ok: true, status: 200,
          json: async () => ({ coupons: rows }) };
      }
      sent.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    confirm: () => true,
    alert: msg => alerts.push(msg),
    escapeHtml: v => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
    formatDate: () => "2026/11/21",
    console
  };
  vm.runInNewContext(source.slice(from, until) +
    "\nthis.testApi={loadMyCoupons,useMyCoupon};", context, { filename: file });
  return { api: context.testApi, buttons, sent, area, list, alerts };
}

test("two held coupons with the same code are used by distinct numeric IDs", async () => {
  const rows = [
    { id: 7, code: "same-code", name: "A", prize: "P", used: 0 },
    { id: 8, code: "same-code", name: "B", prize: "P", used: 0 }
  ];
  const t = setup(rows);
  await t.api.loadMyCoupons();
  await t.buttons[1].click();
  assert.deepEqual(t.sent[0], { device_id: "dev_test", code: "same-code", coupon_id: 8 });
  assert.equal(t.area.style.display, "block");
});

test("coupon code is not interpolated into an inline JavaScript handler", async () => {
  const t = setup([{ id: 9, code: "X' onclick='bad", name: "Safe", prize: "", used: 0 }]);
  await t.api.loadMyCoupons();
  assert.doesNotMatch(t.list.innerHTML, /onclick=/);
  await t.buttons[0].click();
  assert.equal(t.sent[0].code, "X' onclick='bad");
  assert.equal(t.sent[0].coupon_id, 9);
});

test("used coupons have no actionable button", async () => {
  const t = setup([{ id: 6, code: "X", name: "Used", used: 1 }]);
  await t.api.loadMyCoupons();
  assert.doesNotMatch(t.list.innerHTML, /data-coupon-row=/);
});
