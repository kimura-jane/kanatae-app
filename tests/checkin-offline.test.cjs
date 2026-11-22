"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const queueFile = fs.existsSync(path.join(root, "www/checkin-offline.js"))
  ? "www/checkin-offline.js" : "checkin-offline.js";
const queueSource = fs.readFileSync(path.join(root, queueFile), "utf8");

function fixture(options = {}) {
  const storage = options.storage || new Map();
  const preferences = options.preferences || new Map();
  const calls = options.calls || [];
  let online = options.online === undefined ? false : options.online;
  let responseStatus = options.responseStatus || 200;
  let counter = 0;
  const fetcher = options.fetcher || (async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: responseStatus === 200,
      status: responseStatus,
      json: async () => responseStatus === 200
        ? { ok: true, current_points: 11 }
        : { error: responseStatus === 409 ? "already checked in today" : "invalid" }
    };
  });
  const localStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value)
  };
  const window = options.native
    ? { Capacitor: {
        isNativePlatform: () => true,
        Plugins: { Preferences: {
          get: async ({ key }) => ({ value: preferences.get(key) || null }),
          set: async ({ key, value }) => { preferences.set(key, value); }
        } }
      } }
    : {};
  const navigator = {};
  Object.defineProperty(navigator, "onLine", { get: () => online });
  const sandbox = {
    window, navigator, localStorage, fetch: fetcher,
    setTimeout, clearTimeout, AbortController,
    crypto: { randomUUID: () => "test-id-" + (++counter) },
    Date, console
  };
  vm.runInNewContext(queueSource, sandbox, { filename: queueFile });
  return {
    api: window.KanatakeOfflineCheckin, calls, storage, preferences,
    setOnline: value => { online = value; },
    setStatus: value => { responseStatus = value; },
    reopen() { return fixture({ storage, preferences, online, responseStatus, native: options.native, calls }); }
  };
}

test("offline: saves QR receipt without GPS, including after relaunch", async () => {
  const f = fixture({ native: true });
  const first = await f.api.enqueue({ device_id: "dev_test", qr_data: "QR-A" });
  const duplicate = await f.api.enqueue({ device_id: "dev_test", qr_data: "QR-B" });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.record.id, first.record.id);
  assert.equal((await f.api.flush()).pending, 1);
  assert.equal(f.calls.length, 0);
  const restored = await f.reopen().api.pendingRecords();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].qr_data, "QR-A");
  assert.equal(restored[0].latitude, undefined);
});

test("HTTP 200: confirms exactly once and keeps request_id stable", async () => {
  const f = fixture();
  const receipt = await f.api.enqueue({ device_id: "dev_test", qr_data: "QR-A" });
  f.setOnline(true);
  const done = await f.api.flush();
  assert.equal(done.confirmed.length, 1);
  assert.equal(done.confirmed[0].id, receipt.record.id);
  assert.equal(f.calls[0].body.request_id, receipt.record.id);
  assert.equal(f.calls[0].body.latitude, null);
  assert.equal((await f.api.pendingRecords()).length, 0);
  await f.api.flush();
  assert.equal(f.calls.length, 1);
});

test("HTTP 404: preserves queue and stops bulk retry storm", async () => {
  const f = fixture({ responseStatus: 404 });
  await f.api.enqueue({ device_id: "dev_test", qr_data: "QR-A" });
  // Manually create a second dated pending record to simulate previous-day offline receipts.
  const key = "kanatake_pending_checkins_v1";
  const state = JSON.parse(f.storage.get(key));
  state.records.push({ ...state.records[0], id: "older-id", scanned_date_jst: "2026-11-19", scanned_at: "2026-11-19T01:00:00Z" });
  f.storage.set(key, JSON.stringify({ revision: state.revision + 1, records: state.records }));
  const reopened = f.reopen();
  reopened.setOnline(true);
  const result = await reopened.api.flush();
  assert.equal(result.pending, 2);
  assert.equal(f.calls.length, 1);
});

test("HTTP 409: considers already-checked-in final without adding local points", async () => {
  const f = fixture({ responseStatus: 409, online: true });
  await f.api.enqueue({ device_id: "dev_test", qr_data: "QR-A" });
  const result = await f.api.flush();
  assert.equal(result.already.length, 1);
  assert.equal(result.confirmed.length, 0);
  assert.equal((await f.api.pendingRecords()).length, 0);
});

test("HTTP 403: retains rejected record for user follow-up", async () => {
  const f = fixture({ responseStatus: 403, online: true });
  await f.api.enqueue({ device_id: "dev_test", qr_data: "QR-A" });
  const result = await f.api.flush();
  assert.equal(result.rejected.length, 1);
  const records = await f.api.pendingRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "rejected");
});

test("new receipt during a flush is also submitted", async () => {
  let release;
  const calls = [];
  const f = fixture({
    online: true, calls,
    fetcher: async (url, init) => {
      const request = JSON.parse(init.body);
      calls.push(request);
      if (calls.length === 1) await new Promise(resolve => { release = resolve; });
      return { ok: true, status: 200, json: async () => ({ ok: true, current_points: 2 }) };
    }
  });
  await f.api.enqueue({ device_id: "dev_test", qr_data: "QR-A" });
  const pendingFlush = f.api.flush();
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  assert.equal(typeof release, "function");
  const today = new Date().toISOString().slice(0, 10);
  await f.api.enqueue({ device_id: "dev_other", qr_data: "QR-B" });
  release();
  const summary = await pendingFlush;
  assert.equal(summary.confirmed.length, 2);
  assert.equal(calls.length, 2);
  assert.equal((await f.api.pendingRecords()).length, 0);
});
