
/* ===== 設定 ===== */
const API_BASE = "https://kanatake-api.la-kofu.workers.dev";
const PUSH_API_BASE = "https://kanatae-push.la-kofu.workers.dev";
const ASSETS_BASE = "";
const APP_URL = "https://kimura-jane.github.io/kanatae-app";
const SHARE_URL = "https://kimura-jane.github.io/kanatae-app";
const MENU_IMAGE_BASE = "https://raw.githubusercontent.com/kimura-jane/kanatake-v2/main/gazo/";
const CHOICE_IMAGES = {
  "お茶": "https://raw.githubusercontent.com/kimura-jane/kanatake-v2/main/www/IMG_5006.jpeg",
  "ラムネ": "https://raw.githubusercontent.com/kimura-jane/kanatake-v2/main/www/IMG_5012.jpeg",
  "ダンゴ": "https://raw.githubusercontent.com/kimura-jane/kanatake-v2/main/www/IMG_5007.jpeg"
};
const CHOICE_EMOJI = {
  "お茶": "🍵 お茶",
  "ラムネ": "🥤 ラムネ",
  "ダンゴ": "🍡 ダンゴ"
};

// ===== 端末ID（localStorage のみ） =====
const DEVICE_ID_KEY = "kanatake_device_id";
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) id = sessionStorage.getItem(DEVICE_ID_KEY);
  if (!id) id = "dev_" + crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  sessionStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}
let DEVICE_ID = getDeviceId();

// ===== 出店データ読み込み（spots-feed.json をマスターとして使用） =====
// カレンダー用: window.spotsAllByYear（全件・年ごと）
// マップ用: window.spots（今日以降のみ）
async function loadSpotsFeed() {
  try {
    const res = await fetch("spots-feed.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const feed = await res.json();
    const dowChars = ["日","月","火","水","木","金","土"];

    // カレンダー用: 年ごと・"6/27(土)" 形式
    const byYear = {};
    feed.forEach(item => {
      if (!item || !item.date) return;
      const [y, m, d] = item.date.split("-").map(Number);
      if (!y || !m || !d) return;
      const dow = dowChars[new Date(y, m - 1, d).getDay()];
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push({ ...item, date: `${m}/${d}(${dow})` });
    });
    window.spotsAllByYear = byYear;

    // 今日のJST日付を YYYY-MM-DD で組み立て（toISOStringはUTCになるので使わない）
    const now = new Date();
    const todayISO = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;

    // マップ用: 今日以降のみ・"06/27" 形式
    window.spots = feed
      .filter(item => item && item.date && item.date >= todayISO)
      .map(item => {
        const [y, m, d] = item.date.split("-").map(Number);
        return {
          ...item,
          date: `${String(m).padStart(2,"0")}/${String(d).padStart(2,"0")}`,
          year: y
        };
      });
  } catch (e) {
    console.error("loadSpotsFeed failed:", e);
    window.spots = [];
    window.spotsAllByYear = {};
  }
}

// ===== ページナビ =====
const navBtns = document.querySelectorAll(".nav-btn");
const pages = document.querySelectorAll(".page");
let currentPage = "home";
let mapInitialized = false;
let mapInstance = null;
let markersArray = [];

navBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    switchPage(btn.dataset.page);
  });
});

function switchPage(page) {
  currentPage = page;
  navBtns.forEach(b => b.classList.toggle("active", b.dataset.page === page));
  pages.forEach(p => p.classList.toggle("active", p.id === `page-${page}`));
  if (page === "home" && !mapInitialized) {
    setTimeout(() => { initMap(); mapInitialized = true; }, 100);
  }
  if (page === "home" && mapInstance) {
    setTimeout(() => mapInstance.invalidateSize(), 100);
  }
  if (page === "reviews") loadReviews();
  if (page === "settings") loadCheckinHistory();
  if (page === "coupon") {
    loadMyCoupons();
    updateCouponOperationDisplay();
  }
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.scrollTop = 0;
}

// ★ サーバーから通知設定を読み込んでUIに反映
async function loadPushSettings() {
  try {
    // ネイティブ（iOS Capacitor）の場合 → APNs設定をdevice_idで取得
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.apnsToken) {
      var res = await fetch(PUSH_API_BASE + "/apns-settings?device_id=" + encodeURIComponent(DEVICE_ID));
      var data = await res.json();
      if (!data.ok || !data.registered) return;

      if (data.pushOn) {
        var onRadio = document.querySelector('input[name="pushOnOff"][value="on"]');
        if (onRadio) onRadio.checked = true;
      } else {
        var offRadio = document.querySelector('input[name="pushOnOff"][value="off"]');
        if (offRadio) offRadio.checked = true;
      }

      if (data.hour === 18 || data.hour === 21) {
        var hourRadio = document.querySelector('input[name="notifyHour"][value="' + data.hour + '"]');
        if (hourRadio) hourRadio.checked = true;
      }

      var places = data.places || [];
      var hasOff = places.includes("off");
      if (!hasOff && places.length > 0) {
        var customRadio = document.querySelector('input[name="placeMode"][value="custom"]');
        if (customRadio) customRadio.checked = true;
        document.querySelectorAll(".placeChk").forEach(function(chk) {
          chk.checked = places.includes(chk.value);
        });
      } else {
        var allRadio = document.querySelector('input[name="placeMode"][value="all"]');
        if (allRadio) allRadio.checked = true;
      }

      var statusEl = document.getElementById("pushStatus");
      if (statusEl && data.pushOn) {
        statusEl.className = "result-text success";
        statusEl.textContent = "✅ 通知ON（サーバーに保存済み）";
      }
      return;
    }

    // ブラウザ Web Push の場合 → endpointで取得
    if (!("serviceWorker" in navigator)) return;
    var reg = await navigator.serviceWorker.ready;
    if (!reg || !reg.pushManager) return;
    var sub = await reg.pushManager.getSubscription();
    if (!sub || !sub.endpoint) return;

    var res2 = await fetch(PUSH_API_BASE + "/subs/get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
    var data2 = await res2.json();
    if (!data2.ok || !data2.registered) return;

    if (data2.pushOn) {
      var onRadio2 = document.querySelector('input[name="pushOnOff"][value="on"]');
      if (onRadio2) onRadio2.checked = true;
    } else {
      var offRadio2 = document.querySelector('input[name="pushOnOff"][value="off"]');
      if (offRadio2) offRadio2.checked = true;
    }

    if (data2.hour === 18 || data2.hour === 21) {
      var hourRadio2 = document.querySelector('input[name="notifyHour"][value="' + data2.hour + '"]');
      if (hourRadio2) hourRadio2.checked = true;
    }

    var places2 = data2.places || [];
    var hasOff2 = places2.includes("off");
    if (!hasOff2 && places2.length > 0) {
      var customRadio2 = document.querySelector('input[name="placeMode"][value="custom"]');
      if (customRadio2) customRadio2.checked = true;
      document.querySelectorAll(".placeChk").forEach(function(chk) {
        chk.checked = places2.includes(chk.value);
      });
    } else {
      var allRadio2 = document.querySelector('input[name="placeMode"][value="all"]');
      if (allRadio2) allRadio2.checked = true;
    }

    var statusEl2 = document.getElementById("pushStatus");
    if (statusEl2 && data2.pushOn) {
      statusEl2.className = "result-text success";
      statusEl2.textContent = "✅ 通知ON（サーバーに保存済み）";
    }
  } catch (e) {
    console.warn("loadPushSettings failed:", e);
  }
}

// ===== 初期化 =====
document.addEventListener("DOMContentLoaded", async () => {
  DEVICE_ID = getDeviceId();
  await loadSpotsFeed();
  await registerDevice();
  document.getElementById("device-id-display").textContent = DEVICE_ID;
  initStampGrid();
  await loadPoints();
  await updateCouponOperationDisplay();
  await loadNotices();
  initMenuModal();
  initCalendarRangeAndStartMonth();
  renderCalendar();
  setTimeout(() => {
    if (!mapInitialized) { initMap(); mapInitialized = true; }
  }, 300);
  await checkWelcomeCoupon();
  await checkBirthdayCoupon();
  await loadMyCoupons();
  await loadBirthMonth();
  await registerSW().catch(() => {});
  await loadPushSettings();
  syncPlaceUI();
});

// ===== メニュー拡大モーダル =====
function initMenuModal() {
  const modal = document.getElementById("menuModal");
  const modalImg = document.getElementById("menuModalImg");
  const modalName = document.getElementById("menuModalName");
  const closeBtn = document.getElementById("menuModalClose");
  if (!modal || !modalImg || !closeBtn) return;
  document.querySelectorAll(".menu-hotspot").forEach(el => {
    el.addEventListener("click", () => {
      const file = el.dataset.menu;
      const name = el.dataset.name;
      if (!file) return;
      modalImg.src = MENU_IMAGE_BASE + file + ".jpeg";
      modalImg.alt = name;
      modalName.textContent = name;
      modal.classList.add("active");
    });
  });
  document.querySelectorAll(".menu-noriben-item").forEach(el => {
    el.addEventListener("click", () => {
      const file = el.dataset.menu;
      const name = el.dataset.name;
      if (!file) return;
      modalImg.src = MENU_IMAGE_BASE + file + ".jpeg";
      modalImg.alt = name;
      modalName.textContent = name;
      modal.classList.add("active");
    });
  });
  closeBtn.addEventListener("click", () => { modal.classList.remove("active"); });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("active");
  });
}

// ===== 場所 UI 制御（新・ラジオボタン方式） =====
function syncPlaceUI() {
  var onOffRadios = document.querySelectorAll('input[name="pushOnOff"]');
  var detail = document.getElementById("pushSettingsDetail");
  if (!onOffRadios.length || !detail) return;

  function applyOnOff() {
    var val = document.querySelector('input[name="pushOnOff"]:checked');
    detail.style.display = (val && val.value === "on") ? "block" : "none";
  }
  onOffRadios.forEach(function(r) { r.addEventListener("change", applyOnOff); });
  applyOnOff();

  var modeRadios = document.querySelectorAll('input[name="placeMode"]');
  var placeChks = document.querySelectorAll(".placeChk");
  var placeList = document.getElementById("placeList");

  function applyPlaceMode() {
    var mode = document.querySelector('input[name="placeMode"]:checked');
    var isCustom = mode && mode.value === "custom";
    placeChks.forEach(function(c) {
      c.disabled = !isCustom;
      if (!isCustom) c.checked = false;
    });
    if (placeList) placeList.style.opacity = isCustom ? "1" : "0.4";
  }
  modeRadios.forEach(function(r) { r.addEventListener("change", applyPlaceMode); });
  applyPlaceMode();
}

// ===== デバイス登録 =====
async function registerDevice() {
  try {
    await fetch(`${API_BASE}/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: DEVICE_ID })
    });
  } catch (e) {
    console.warn("device register failed:", e);
  }
}

// ===== お知らせ =====
async function loadNotices() {
  const el = document.getElementById("notices-list");
  const moreBtn = document.getElementById("notices-more-btn");
  try {
    const res = await fetch(`${API_BASE}/notices?all=1`);
    const data = await res.json();
    if (!data.notices || data.notices.length === 0) {
      el.innerHTML = '<p class="loading-text">お知らせはありません</p>';
      moreBtn.style.display = "none";
      return;
    }
    const notices = data.notices;
    const latest = notices[0];
    const older = notices.slice(1);
    let html = `<div class="notice-item">
      <span class="notice-date">${formatDate(latest.created_at)}</span>
      <div class="notice-body">${renderNoticeBody(latest.body)}</div>
    </div>`;
    if (older.length > 0) {
      html += `<div class="notices-older-toggle" id="notices-older-toggle">▼ 過去のお知らせ（${older.length}件）</div>`;
      html += `<div id="notices-older-list" style="display:none;">`;
      older.forEach(n => {
        html += `<div class="notice-item">
          <span class="notice-date">${formatDate(n.created_at)}</span>
          <div class="notice-body">${renderNoticeBody(n.body)}</div>
        </div>`;
      });
      html += `</div>`;
    }
    el.innerHTML = html;
    moreBtn.style.display = "none";
    const toggle = document.getElementById("notices-older-toggle");
    if (toggle) {
      toggle.addEventListener("click", function() {
        const list = document.getElementById("notices-older-list");
        if (list.style.display === "none") {
          list.style.display = "block";
          toggle.textContent = "▲ 過去のお知らせを閉じる";
        } else {
          list.style.display = "none";
          toggle.textContent = `▼ 過去のお知らせ（${older.length}件）`;
        }
      });
    }
    if (el.querySelector(".twitter-tweet")) loadTwitterWidget();
  } catch (e) {
    el.innerHTML = '<p class="loading-text">読み込みに失敗しました</p>';
  }
}

// ★★★ お知らせ本文レンダリング（X埋め込み維持＋URL自動リンク化） ★★★
function renderNoticeBody(text) {
  if (!text) return "";
  const escaped = escapeHtml(text);

  // ① まずXツイートURLを検出してプレースホルダに退避（<a>化されないように）
  const tweetPlaceholders = [];
  const xRegex = /https?:\/\/(x\.com|twitter\.com)\/\w+\/status\/(\d+)[^\s]*/g;
  let step1 = escaped.replace(xRegex, (url) => {
    const idx = tweetPlaceholders.length;
    tweetPlaceholders.push(`<div class="notice-embed"><blockquote class="twitter-tweet"><a href="${url}"></a></blockquote></div>`);
    return `\u0000TWEET${idx}\u0000`;
  });

  // ② それ以外の URL をリンク化（末尾の句読点はリンク対象外）
  const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
  let step2 = step1.replace(urlRegex, (url) => {
    const trailing = url.match(/[。、.,\)\]!?]+$/);
    let cleanUrl = url;
    let tail = "";
    if (trailing) {
      cleanUrl = url.slice(0, -trailing[0].length);
      tail = trailing[0];
    }
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="notice-link">${cleanUrl}</a>${tail}`;
  });

  // ③ プレースホルダをツイート埋め込みに戻す
  return step2.replace(/\u0000TWEET(\d+)\u0000/g, (_, i) => tweetPlaceholders[Number(i)]);
}

function loadTwitterWidget() {
  if (window.twttr) { window.twttr.widgets.load(); return; }
  const s = document.createElement("script");
  s.src = "https://platform.twitter.com/widgets.js";
  s.async = true;
  document.head.appendChild(s);
}

document.getElementById("notices-more-btn").addEventListener("click", () => { loadNotices(); });

// ===== スタンプ / ポイント =====
let megamiCouponActive = false;
let couponGeneration = null;
let couponOperationBusy = false;

function initStampGrid() {
  const grid = document.getElementById("stamp-grid");
  let html = "";
  for (let i = 0; i < 20; i++) {
    html += `<div class="stamp-dot"></div>`;
  }
  grid.innerHTML = html;
}

function applyPointsState(data) {
  if (!data || !Number.isSafeInteger(data.current_points) ||
      data.current_points < 0 || !Number.isSafeInteger(data.total_redeemed) ||
      data.total_redeemed < 0) return false;
  couponGeneration = data.total_redeemed;
  megamiCouponActive = !!data.megami_coupon_active;
  updateStampUI(data.current_points);
  updateMegamiCouponUI();
  return true;
}

async function fetchPointsSnapshot() {
  const res = await fetch(`${API_BASE}/points`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: DEVICE_ID })
  });
  if (!res.ok) throw new Error("points HTTP " + res.status);
  const data = await res.json();
  if (!applyPointsState(data)) throw new Error("invalid points response");
  return data;
}

async function loadPoints() {
  try {
    await fetchPointsSnapshot();
    return true;
  } catch (e) {
    console.warn("load points failed:", e);
    return false;
  }
}

function updateStampUI(points) {
  document.getElementById("stamp-current").textContent = points;
  const dots = document.querySelectorAll(".stamp-dot");
  dots.forEach((dot, i) => { dot.classList.toggle("filled", i < points); });
  document.getElementById("redeem-btn").style.display = (points >= 20 && !megamiCouponActive) ? "block" : "none";
}

function updateMegamiCouponUI() {
  document.getElementById("megami-coupon-area").style.display = megamiCouponActive ? "block" : "none";
}

// 「使用済み」は店頭操作のため自動再送しない。通信復旧後も利用者が明示して再確認する。
async function updateCouponOperationDisplay() {
  const status = document.getElementById("coupon-operation-status");
  const retry = document.getElementById("coupon-operation-retry");
  if (!status || !retry || !window.KanatakeCouponOperations || !DEVICE_ID) return;
  try {
    const pending = await window.KanatakeCouponOperations.get(DEVICE_ID);
    retry.style.display = pending ? "block" : "none";
    status.textContent = pending
      ? "前回の" + (pending.action === "redeem" ? "特典交換" : "クーポン使用") +
        "を確認できていません。再確認してください。"
      : "";
    retry.textContent = pending ? "前回の操作を再確認" : "";
    if (pending) document.getElementById("redeem-btn").style.display = "none";
  } catch (e) {
    status.textContent = e.message || "特典操作の保存状態を確認できません";
    retry.style.display = "none";
  }
}

async function runCouponOperation(action) {
  if (couponOperationBusy) return;
  const store = window.KanatakeCouponOperations;
  if (!store || !DEVICE_ID) {
    alert("特典操作の準備ができませんでした。アプリを再起動してください。");
    return;
  }
  couponOperationBusy = true;
  const redeemButton = document.getElementById("redeem-btn");
  const useButton = document.getElementById("megami-use-btn");
  redeemButton.disabled = true;
  useButton.disabled = true;
  try {
    const pending = await store.get(DEVICE_ID);
    if (pending && pending.action !== action) {
      alert("前回の特典操作が未確認です。先に「前回の操作を再確認」を押してください。");
      return;
    }
    if (pending) {
      const note = action === "use"
        ? "前回の使用処理を再確認します。店主の目の前で行ってください。"
        : "前回の交換結果を、同じ受付番号で再確認します。";
      if (!confirm(note)) return;
    } else {
      const prompt = action === "redeem"
        ? "20ポイントで「女神のほほえみ」と交換しますか？\n交換後も20ポイントを超えた分は残ります。"
        : "⚠️ 「女神のほほえみ」を使用済みにしますか？\n店主の目の前で押してください。";
      if (!confirm(prompt)) return;
    }

    let operation = pending;
    if (!operation) {
      // 古い世代の操作IDを再利用しないよう、作成直前に最新の残高を読む。
      const points = await fetchPointsSnapshot();
      if (action === "redeem" && (points.current_points < 20 || !!points.megami_coupon_active)) {
        alert("現在は交換できません。ポイントとクーポンの状態をご確認ください。");
        return;
      }
      if (action === "use" && !points.megami_coupon_active) {
        alert("利用できる「女神のほほえみ」クーポンがありません。");
        return;
      }
      const prepared = await store.begin(action, DEVICE_ID, points.total_redeemed);
      operation = prepared.operation;
      // 別の同時操作が開始された場合は混同しない。
      if (operation.action !== action) throw new Error("別の特典操作が未確認です。");
    }

    const url = action === "redeem" ? "/redeem-points" : "/megami-coupon/use";
    let response, data;
    try {
      response = await fetch(API_BASE + url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: DEVICE_ID,
          request_id: operation.request_id,
          coupon_generation: operation.coupon_generation,
          ...(action === "redeem" ? { required_points: 20 } : {})
        })
      });
      data = await response.json();
    } catch (_) {
      alert("通信結果を確認できませんでした。受付番号を保存しています。次回、同じ操作を再確認してください。");
      return;
    }
    if (response.ok && data && data.ok === true) {
      await store.finish(operation);
      if (!applyPointsState(data) && !(await loadPoints())) {
        document.getElementById("stamp-current").textContent = "確認中";
        redeemButton.style.display = "none";
      }
      alert(data.replayed
        ? "✅ 前回の操作結果を確認しました。"
        : action === "redeem"
          ? "🎉 特典を交換しました。クーポンタブをご確認ください。"
          : "✅ 使用済みにしました。ありがとうございます！");
    } else if (response.status === 409 || (response.status >= 400 && response.status < 500 &&
               ![408, 425, 429].includes(response.status))) {
      await store.finish(operation);
      await loadPoints();
      alert("特典の状態を更新しました。内容をご確認ください。" +
        (data && data.error ? "\n" + data.error : ""));
    } else {
      alert("サーバーの応答を確認できませんでした。操作を保存しています。後で再確認してください。");
    }
  } catch (e) {
    console.warn("coupon operation failed:", e);
    alert("特典操作を確認できませんでした。" +
      (e && e.message ? "\n" + e.message : ""));
  } finally {
    couponOperationBusy = false;
    redeemButton.disabled = false;
    useButton.disabled = false;
    await updateCouponOperationDisplay();
  }
}

document.getElementById("redeem-btn").addEventListener("click", function () {
  runCouponOperation("redeem");
});

document.getElementById("megami-use-btn").addEventListener("click", function () {
  runCouponOperation("use");
});

document.getElementById("coupon-operation-retry").addEventListener("click", async function () {
  const store = window.KanatakeCouponOperations;
  if (!store || couponOperationBusy) return;
  try {
    const pending = await store.get(DEVICE_ID);
    if (pending) await runCouponOperation(pending.action);
    else await updateCouponOperationDisplay();
  } catch (e) {
    alert(e.message || "保存した特典操作を確認できませんでした");
  }
});

// ===== カレンダー =====
let currentYear, currentMonth;
let minYM = null, maxYM = null;

function ymToNum(y, m) { return y * 100 + m; }

function clampYM(y, m) {
  if (!minYM || !maxYM) return { y, m };
  const n = ymToNum(y, m);
  if (n < ymToNum(minYM.y, minYM.m)) return { y: minYM.y, m: minYM.m };
  if (n > ymToNum(maxYM.y, maxYM.m)) return { y: maxYM.y, m: maxYM.m };
  return { y, m };
}

function getAllSpotsFlat() {
  if (window.spotsAllByYear && typeof window.spotsAllByYear === "object") {
    const flat = [];
    Object.keys(window.spotsAllByYear).forEach(y => {
      (window.spotsAllByYear[y] || []).forEach(s => flat.push({ ...s, year: Number(y) }));
    });
    return flat;
  }
  if (Array.isArray(window.spots) && window.spots.length) return window.spots;
  return [];
}

function getSpotsForYM(year, month) {
  if (window.spotsAllByYear && window.spotsAllByYear[year]) {
    return window.spotsAllByYear[year].filter(s => {
      const m = (s.date || "").match(/(\d+)\//);
      return m && parseInt(m[1], 10) === month;
    });
  }
  return getAllSpotsFlat().filter(s => {
    if (s.year != null && Number(s.year) !== year) return false;
    const m = (s.date || "").match(/(\d+)\//);
    return m && parseInt(m[1], 10) === month;
  });
}

function getEventsForMonth(year, month) {
  const spots = getSpotsForYM(year, month);
  const events = {};
  spots.forEach(s => {
    const m = (s.date || "").match(/(\d+)\/(\d+)/);
    if (!m) return;
    const d = parseInt(m[2], 10);
    if (!events[d]) events[d] = [];
    events[d].push(s);
  });
  return events;
}

function computeMinMaxYM() {
  const list = getAllSpotsFlat();
  let minN = Infinity, maxN = -Infinity;
  list.forEach(s => {
    const y = Number(s.year);
    if (!isFinite(y)) return;
    const m = (s.date || "").match(/(\d+)\//);
    if (!m) return;
    const month = parseInt(m[1], 10);
    if (month < 1 || month > 12) return;
    const n = ymToNum(y, month);
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  });
  if (!isFinite(minN)) { minYM = null; maxYM = null; return; }
  minYM = { y: Math.floor(minN / 100), m: minN % 100 };
  maxYM = { y: Math.floor(maxN / 100), m: maxN % 100 };
}

function initCalendarRangeAndStartMonth() {
  computeMinMaxYM();
  const t = new Date();
  const d = clampYM(t.getFullYear(), t.getMonth() + 1);
  currentYear = d.y;
  currentMonth = d.m;
}

function getShortName(name) {
  const shortcuts = {
    '川口さくら病院': 'さくら病院',
    '獨協大学 草加キャンパス': '獨協大学',
    'さいたま市役所 浦和本庁舎': 'さいたま市役所',
    'ダイナム戸ヶ崎店': 'ダイナム'
  };
  return shortcuts[name] || (name || "").substring(0, 6);
}

function renderCalendar() {
  const title = document.getElementById("calendarTitle");
  const grid = document.getElementById("calendarGrid");
  title.textContent = `${currentYear}年${currentMonth}月`;
  const firstDay = new Date(currentYear, currentMonth - 1, 1);
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const startDow = firstDay.getDay();
  const events = getEventsForMonth(currentYear, currentMonth);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === currentYear && today.getMonth() + 1 === currentMonth;
  const todayDate = today.getDate();
  let html = ["日","月","火","水","木","金","土"].map(d => `<div class="calendar-dow">${d}</div>`).join("");
  for (let i = 0; i < startDow; i++) html += '<div class="calendar-day empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const hasEvent = !!(events[d] && events[d].length);
    const isToday = isCurrentMonth && d === todayDate;
    let cls = "calendar-day";
    if (hasEvent) cls += " has-event";
    if (isToday) cls += " today";
    const place = hasEvent ? `<div class="calendar-place">${getShortName(events[d][0].name)}</div>` : "";
    html += `<div class="${cls}" data-day="${d}"><div class="calendar-date">${d}</div>${place}</div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll(".calendar-day.has-event").forEach(el => {
    el.addEventListener("click", () => {
      const day = parseInt(el.dataset.day, 10);
      showEventModal(day, events[day]);
    });
  });
  const prevBtn = document.getElementById("prevMonth");
  const nextBtn = document.getElementById("nextMonth");
  if (minYM && maxYM) {
    prevBtn.disabled = ymToNum(currentYear, currentMonth) <= ymToNum(minYM.y, minYM.m);
    nextBtn.disabled = ymToNum(currentYear, currentMonth) >= ymToNum(maxYM.y, maxYM.m);
  }
}

function showEventModal(day, eventList) {
  const event = eventList[0];
  document.getElementById("modalDate").textContent = `${currentYear}年${currentMonth}月${day}日`;
  document.getElementById("modalTitle").textContent = event.name;
  document.getElementById("modalTime").textContent = event.time || "時間未定";
  const mapLink = document.getElementById("modalMap");
  if (event.lat && event.lng) {
    mapLink.href = `https://www.google.com/maps?q=${event.lat},${event.lng}`;
    mapLink.style.display = "block";
  } else {
    mapLink.style.display = "none";
  }
  document.getElementById("modal").classList.add("active");
}

document.getElementById("modal").addEventListener("click", e => {
  if (e.target.id === "modal" || e.target.id === "modalClose") {
    document.getElementById("modal").classList.remove("active");
  }
});

document.getElementById("prevMonth").addEventListener("click", () => {
  if (minYM && ymToNum(currentYear, currentMonth) <= ymToNum(minYM.y, minYM.m)) return;
  currentMonth--;
  if (currentMonth < 1) { currentMonth = 12; currentYear--; }
  const c = clampYM(currentYear, currentMonth);
  currentYear = c.y; currentMonth = c.m;
  renderCalendar();
});

document.getElementById("nextMonth").addEventListener("click", () => {
  if (maxYM && ymToNum(currentYear, currentMonth) >= ymToNum(maxYM.y, maxYM.m)) return;
  currentMonth++;
  if (currentMonth > 12) { currentMonth = 1; currentYear++; }
  const c = clampYM(currentYear, currentMonth);
  currentYear = c.y; currentMonth = c.m;
  renderCalendar();
});

// ===== マップ =====
function initMap() {
  if (!window.L) return;
  const mapEl = document.getElementById("map");
  if (!mapEl) return;
  mapInstance = L.map("map").setView([35.82, 139.80], 11);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "© OSM © CARTO"
  }).addTo(mapInstance);
  const iconUrl = ASSETS_BASE ? `${ASSETS_BASE}/icon.png` : "icon.png";
  const icon = L.icon({ iconUrl: iconUrl, iconSize: [40, 40], iconAnchor: [20, 30], popupAnchor: [0, -26] });
  const spots = Array.isArray(window.spots) ? window.spots : [];
  const list = document.getElementById("spotList");
  list.innerHTML = "";
  markersArray = [];
  spots.forEach((s, i) => {
    if (s.lat && s.lng) {
      const m = L.marker([s.lat, s.lng], { icon }).addTo(mapInstance).bindPopup(
        `<strong>${s.name}</strong><br>${s.date || ""}${s.time ? " ・ " + s.time : ""}<br>` +
        `<a href="https://www.google.com/maps?q=${s.lat},${s.lng}" target="_blank">Googleマップで開く</a>`
      );
      markersArray[i] = m;
    }
    const li = document.createElement("li");
    li.innerHTML = `<span class="spot-name">${s.name}</span> <span class="badge">${s.date || ""}</span>`;
    li.addEventListener("click", () => {
      if (markersArray[i]) {
        mapInstance.setView(markersArray[i].getLatLng(), 14, { animate: true });
        markersArray[i].openPopup();
      }
    });
    list.appendChild(li);
  });
  const existing = markersArray.filter(Boolean);
  if (existing.length) mapInstance.fitBounds(L.featureGroup(existing).getBounds().pad(0.15));
}

// ===== 今日の出店場所を探す =====
function getTodaySpot() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  if (Array.isArray(window.spots)) {
    for (const s of window.spots) {
      if (!s.lat || !s.lng) continue;
      const m = (s.date || "").match(/(\d+)\/(\d+)/);
      if (m && parseInt(m[1], 10) === month && parseInt(m[2], 10) === day) return s;
    }
  }
  if (window.spotsAllByYear) {
    const year = now.getFullYear();
    const arr = window.spotsAllByYear[year] || [];
    for (const s of arr) {
      if (!s.lat || !s.lng) continue;
      const m = (s.date || "").match(/(\d+)\/(\d+)/);
      if (m && parseInt(m[1], 10) === month && parseInt(m[2], 10) === day) return s;
    }
  }
  return null;
}

// ===== 初回クーポン =====
let welcomeSelectedChoice = null;

async function checkWelcomeCoupon() {
  const content = document.getElementById("welcome-coupon-content");
  const used = document.getElementById("welcome-coupon-used");
  try {
    const res = await fetch(`${API_BASE}/welcome-coupon/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: DEVICE_ID })
    });
    const data = await res.json();
    if (data.used) {
      content.style.display = "none";
      used.style.display = "block";
    } else {
      content.style.display = "block";
      used.style.display = "none";
    }
  } catch (e) {
    console.warn("welcome coupon check failed:", e);
    content.style.display = "block";
    used.style.display = "none";
  }
}

document.querySelectorAll("#welcome-choices .welcome-choice-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#welcome-choices .welcome-choice-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    welcomeSelectedChoice = btn.dataset.choice;
    document.getElementById("welcome-confirm-btn").style.display = "block";
    document.getElementById("choice-hint").style.display = "none";
  });
});

document.getElementById("welcome-confirm-btn").addEventListener("click", async () => {
  if (!welcomeSelectedChoice) return;
  if (!confirm(`⚠️ 1回限りです！\n\n「${welcomeSelectedChoice}」をもらいますか？\n\n店主の目の前で押してください。`)) return;
  try {
    const res = await fetch(`${API_BASE}/welcome-coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: DEVICE_ID, choice: welcomeSelectedChoice })
    });
    const data = await res.json();
    if (data.ok) {
      document.getElementById("welcome-coupon-content").style.display = "none";
      document.getElementById("welcome-coupon-show").style.display = "block";
      document.getElementById("welcome-coupon-img").src = CHOICE_IMAGES[welcomeSelectedChoice] || "";
      document.getElementById("welcome-coupon-item").textContent = CHOICE_EMOJI[welcomeSelectedChoice] || welcomeSelectedChoice;
    } else if (data.error === "already used") {
      document.getElementById("welcome-coupon-content").style.display = "none";
      document.getElementById("welcome-coupon-used").style.display = "block";
    } else {
      alert("エラー: " + (data.error || "不明なエラー"));
    }
  } catch (e) {
    alert("通信エラーが発生しました");
  }
});

// ===== 誕生日クーポン =====
let birthdaySelectedChoice = null;

async function checkBirthdayCoupon() {
  try {
    const res = await fetch(`${API_BASE}/birthday-coupon/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: DEVICE_ID })
    });
    const data = await res.json();
    if (!data.registered || !data.is_birth_month) {
      document.getElementById("birthday-coupon-area").style.display = "none";
      return;
    }
    document.getElementById("birthday-coupon-area").style.display = "block";
    if (data.used_this_year) {
      document.getElementById("birthday-coupon-content").style.display = "none";
      document.getElementById("birthday-coupon-used").style.display = "block";
    }
  } catch (e) {
    console.warn("birthday coupon check failed:", e);
  }
}

document.querySelectorAll("#birthday-choices .birthday-choice-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#birthday-choices .birthday-choice-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    birthdaySelectedChoice = btn.dataset.choice;
    document.getElementById("birthday-confirm-btn").style.display = "block";
    document.getElementById("birthday-choice-hint").style.display = "none";
  });
});

document.getElementById("birthday-confirm-btn").addEventListener("click", async () => {
  if (!birthdaySelectedChoice) return;
  if (!confirm(`⚠️ 年1回限りです！\n\n「${birthdaySelectedChoice}」をもらいますか？\n\n店主の目の前で押してください。`)) return;
  try {
    const res = await fetch(`${API_BASE}/birthday-coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: DEVICE_ID, choice: birthdaySelectedChoice })
    });
    const data = await res.json();
    if (data.ok) {
      document.getElementById("birthday-coupon-content").style.display = "none";
      document.getElementById("birthday-coupon-show").style.display = "block";
      document.getElementById("birthday-coupon-img").src = CHOICE_IMAGES[birthdaySelectedChoice] || "";
      document.getElementById("birthday-coupon-item").textContent = CHOICE_EMOJI[birthdaySelectedChoice] || birthdaySelectedChoice;
    } else if (data.error === "already used this year") {
      document.getElementById("birthday-coupon-content").style.display = "none";
      document.getElementById("birthday-coupon-used").style.display = "block";
    } else {
      alert("エラー: " + (data.error || "不明なエラー"));
    }
  } catch (e) {
    alert("通信エラーが発生しました");
  }
});

// ===== FiNANCiEクーポン（コード引換） =====
document.getElementById("coupon-code-btn").addEventListener("click", async () => {
  const code = document.getElementById("coupon-code-input").value.trim();
  const resultEl = document.getElementById("coupon-code-result");
  if (!code) {
    resultEl.className = "result-text error";
    resultEl.textContent = "コードを入力してください";
    return;
  }
  resultEl.className = "result-text loading";
  resultEl.textContent = "確認中…";
  try {
    const res = await fetch(`${API_BASE}/redeem-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: DEVICE_ID, code })
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.className = "result-text success";
      resultEl.textContent = `🎉 「${data.name || data.prize}」を取得しました！`;
      document.getElementById("coupon-code-input").value = "";
      loadMyCoupons();
    } else {
      resultEl.className = "result-text error";
      const msgs = { "invalid code": "無効なコードです", "already used": "このコードは使用済みです" };
      resultEl.textContent = "❌ " + (msgs[data.error] || data.error);
    }
  } catch (e) {
    resultEl.className = "result-text error";
    resultEl.textContent = "❌ 通信エラー";
  }
});

// ===== 保有クーポン =====
async function loadMyCoupons() {
  const area = document.getElementById("my-coupons-area");
  const list = document.getElementById("my-coupons-list");
  if (!area || !list) return;
  try {
    const res = await fetch(`${API_BASE}/my-coupons?device_id=${encodeURIComponent(DEVICE_ID)}`);
    const data = await res.json();
    if (!data.coupons || data.coupons.length === 0) {
      area.style.display = "none";
      return;
    }
    area.style.display = "block";
    list.innerHTML = data.coupons.map(c => {
      const isUsed = !!c.used;
      return `<div class="my-coupon-card ${isUsed ? 'used' : ''}">
        ${c.image ? `<img class="my-coupon-img" src="${c.image}" alt="">` : ""}
        <div class="my-coupon-info">
          <div class="my-coupon-name">${escapeHtml(c.name)}</div>
          <div class="my-coupon-prize">${escapeHtml(c.prize)}</div>
          <div class="my-coupon-status">${isUsed ? `✅ 使用済み（${formatDate(c.used_at)}）` : `取得: ${formatDate(c.acquired_at)}`}</div>
          ${!isUsed ? `<button class="btn btn-primary btn-sm" onclick="useMyCoupon('${c.code}')">使用済みにする</button>` : ""}
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    console.warn("loadMyCoupons failed:", e);
    if (area) area.style.display = "none";
  }
}

async function useMyCoupon(code) {
  if (!confirm("⚠️ このクーポンを使用済みにしますか？\n店主の目の前で押してください。")) return;
  try {
    const res = await fetch(`${API_BASE}/use-coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: DEVICE_ID, code })
    });
    const data = await res.json();
    if (data.ok) {
      alert("✅ 使用済みにしました！");
      loadMyCoupons();
    } else {
      alert("❌ " + (data.error || "エラーが発生しました"));
    }
  } catch (e) {
    alert("❌ 通信エラー");
  }
}

// ===== QRスキャン =====
let html5QrCode = null;
let qrProcessing = false;

document.getElementById("qr-start-btn").addEventListener("click", async () => {
  if (qrProcessing) return;
  const resultEl = document.getElementById("qr-result");
  resultEl.className = "result-text";
  resultEl.textContent = "";
  if (!window.Html5Qrcode) {
    resultEl.className = "result-text error";
    resultEl.textContent = "❌ QRスキャナーの読み込みに失敗しました";
    return;
  }
  if (html5QrCode) {
    try { await html5QrCode.stop(); } catch (e) {}
    html5QrCode = null;
  }
  html5QrCode = new Html5Qrcode("qr-reader");
  try {
    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      async (decodedText) => {
        // 読み取り通知は連続発火するため、同じQRを並行処理しない。
        if (qrProcessing) return;
        qrProcessing = true;
        const reader = html5QrCode;
        try {
          if (reader) await reader.stop();
        } catch (e) {
          console.warn("QR stop failed:", e);
        }
        if (html5QrCode === reader) html5QrCode = null;
        try {
          await processCheckin(decodedText);
        } catch (e) {
          console.error("QR check-in failed:", e);
          resultEl.className = "result-text error";
          resultEl.textContent = "❌ 来店受付処理でエラーが発生しました";
        } finally {
          qrProcessing = false;
        }
      },
      () => {}
    );
  } catch (e) {
    resultEl.className = "result-text error";
    resultEl.textContent = "❌ カメラを起動できませんでした。カメラ権限を確認してください。";
  }
});

async function getOptionalCheckinLocation() {
  // GPS取得失敗・拒否・タイムアウトはチェックインを妨げない。
  if (!navigator.geolocation) return null;
  return new Promise(function (resolve) {
    let finished = false;
    const deadline = setTimeout(function () {
      if (!finished) { finished = true; resolve(null); }
    }, 3000);
    try {
      navigator.geolocation.getCurrentPosition(function (pos) {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        });
      }, function () {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        resolve(null);
      }, { enableHighAccuracy: false, timeout: 2500, maximumAge: 60000 });
    } catch (_) {
      if (!finished) {
        finished = true;
        clearTimeout(deadline);
        resolve(null);
      }
    }
  });
}

async function updatePendingCheckinDisplay() {
  const el = document.getElementById("qr-pending-status");
  const details = document.getElementById("qr-pending-details");
  if (!el || !window.KanatakeOfflineCheckin) return;
  try {
    const records = await window.KanatakeOfflineCheckin.pendingRecords();
    const pending = records.filter(function (item) { return item.status === "pending"; }).length;
    const rejected = records.filter(function (item) { return item.status === "rejected"; }).length;
    el.textContent = pending || rejected ?
      "未確定の来店記録: " + pending + "件" +
      (rejected ? " ／ 確認が必要: " + rejected + "件" : "") : "";

    // 期限切れを含め、端末に残した受付の日時と理由を個別に確認できる。
    // QR本文・端末IDは画面に出さない。文字列はtextContentで安全に表示する。
    if (details) {
      details.replaceChildren();
      details.hidden = !(pending || rejected);
      if (pending || rejected) {
        const summary = document.createElement("summary");
        summary.textContent = "仮受付の記録を確認する（" + records.length + "件）";
        details.appendChild(summary);
        const list = document.createElement("ul");
        list.className = "qr-pending-list";
        records.forEach(function (item) {
          const li = document.createElement("li");
          const dt = new Date(item.scanned_at);
          const when = Number.isFinite(dt.getTime()) ?
            new Intl.DateTimeFormat("ja-JP", {
              timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit",
              day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
            }).format(dt) : "日時不明";
          const status = item.status === "rejected" ? "確認が必要" : "仮受付";
          li.textContent = when + " ／ " + status +
            (item.status === "rejected" && item.error ? " ／ " + item.error : "");
          list.appendChild(li);
        });
        details.appendChild(list);
      }
    }
  } catch (_) {
    el.textContent = "仮受付の保存状態を確認できませんでした";
  }
}

async function retryPendingCheckins() {
  if (!window.KanatakeOfflineCheckin || navigator.onLine === false) {
    await updatePendingCheckinDisplay();
    return;
  }
  try {
    const result = await window.KanatakeOfflineCheckin.flush();
    if (result.confirmed.length || result.already.length) {
      await loadPoints();
    }
  } catch (e) {
    console.warn("check-in retry failed:", e);
  }
  await updatePendingCheckinDisplay();
}

async function processCheckin(qrText) {
  const resultEl = document.getElementById("qr-result");
  const checkin = window.KanatakeOfflineCheckin;
  if (!checkin) {
    resultEl.className = "result-text error";
    resultEl.textContent = "❌ 来店受付機能を読み込めませんでした";
    return;
  }
  resultEl.className = "result-text loading";
  resultEl.textContent = "⏳ QRコードを確認中…";

  // 出店情報は取得できた場合だけ使う。通信やGPSで受付を中断しない。
  const todaySpot = getTodaySpot();
  const location = await getOptionalCheckinLocation();
  let queued;
  try {
    queued = await checkin.enqueue({
      device_id: DEVICE_ID,
      qr_data: qrText,
      spot_name: todaySpot ? todaySpot.name : "",
      latitude: location ? location.latitude : null,
      longitude: location ? location.longitude : null,
      accuracy: location ? location.accuracy : null
    });
  } catch (e) {
    resultEl.className = "result-text error";
    resultEl.textContent = "❌ " + (e.message || "仮受付を保存できませんでした");
    return;
  }

  // 先に永続保存してからサーバーに送る。通信切断でも記録を失わない。
  resultEl.className = "result-text loading";
  resultEl.textContent = "⏳ 来店記録を保存しました。ポイント確認中…";
  try {
    const summary = await checkin.flush();
    const id = queued.record.id;
    const confirmed = summary.confirmed.find(function (item) { return item.id === id; });
    const already = summary.already.find(function (item) { return item.id === id; });
    const rejected = summary.rejected.find(function (item) { return item.id === id; });
    if (confirmed) {
      resultEl.className = "result-text success";
      resultEl.textContent = "🎉 チェックイン成功！1ポイント付与されました。";
      await loadPoints();
    } else if (already) {
      resultEl.className = "result-text error";
      resultEl.textContent = "本日はすでにチェックイン済みです";
      await loadPoints();
    } else if (rejected) {
      resultEl.className = "result-text error";
      resultEl.textContent = "❌ サーバーで受付できませんでした: " + rejected.error;
    } else {
      resultEl.className = "result-text success";
      resultEl.textContent = queued.duplicate ?
        "✅ 本日の来店は仮受付済みです。通信回復後にポイントを確認します。" :
        "✅ 来店を仮受付しました。通信回復後にポイントを確認します。\n※ まだポイントは加算されていません。";
    }
  } catch (e) {
    resultEl.className = "result-text success";
    resultEl.textContent = "✅ 来店を仮受付しました。通信回復後にポイントを確認します。\n※ まだポイントは加算されていません。";
    console.warn("check-in sync deferred:", e);
  }
  await updatePendingCheckinDisplay();
}

// 通信回復時・アプリ復帰時・再起動時に未送信の来店記録を再送する。
window.addEventListener("online", retryPendingCheckins);
document.addEventListener("visibilitychange", function () {
  if (!document.hidden) retryPendingCheckins();
});
document.addEventListener("DOMContentLoaded", function () {
  updatePendingCheckinDisplay();
  retryPendingCheckins();
});

// ===== 口コミ =====
async function loadReviews() {
  const el = document.getElementById("reviews-list");
  el.innerHTML = '<p class="loading-text">読み込み中…</p>';
  try {
    const res = await fetch(`${API_BASE}/reviews`);
    const data = await res.json();
    if (!data.reviews || data.reviews.length === 0) {
      el.innerHTML = '<p class="loading-text">まだ口コミはありません</p>';
      return;
    }
    el.innerHTML = data.reviews.map(r => `<div class="review-item">
      <span class="review-nickname">${escapeHtml(r.nickname)}</span>
      <span class="review-date">${formatDate(r.created_at)}</span>
      <div class="review-body">${escapeHtml(r.body)}</div>
      ${r.owner_reply ? `<div class="review-reply">
        <div class="review-reply-label">🍙 店主からの返信</div>
        ${escapeHtml(r.owner_reply)}
      </div>` : ""}
    </div>`).join("");
  } catch (e) {
    el.innerHTML = '<p class="loading-text">読み込みに失敗しました</p>';
  }
}

document.getElementById("review-body").addEventListener("input", function() {
  document.getElementById("review-char-current").textContent = this.value.length;
});

document.getElementById("review-submit-btn").addEventListener("click", async () => {
  const nickname = document.getElementById("review-nickname").value.trim();
  const body = document.getElementById("review-body").value.trim();
  const resultEl = document.getElementById("review-result");
  if (!nickname) { resultEl.className = "result-text error"; resultEl.textContent = "ニックネームを入力してください"; return; }
  if (!body) { resultEl.className = "result-text error"; resultEl.textContent = "口コミを入力してください"; return; }
  if (nickname.length > 50) { resultEl.className = "result-text error"; resultEl.textContent = "ニックネームは50文字以内で入力してください"; return; }
  resultEl.className = "result-text loading";
  resultEl.textContent = "投稿中…";
  try {
    const res = await fetch(`${API_BASE}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: DEVICE_ID, nickname, body })
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.className = "result-text success";
      resultEl.textContent = "✅ 投稿しました！承認後に表示されます。";
      document.getElementById("review-nickname").value = "";
      document.getElementById("review-body").value = "";
      document.getElementById("review-char-current").textContent = "0";
    } else {
      resultEl.className = "result-text error";
      resultEl.textContent = "❌ " + (data.error || "投稿に失敗しました");
    }
  } catch (e) {
    resultEl.className = "result-text error";
    resultEl.textContent = "❌ 通信エラー";
  }
});

// ===== 誕生月登録 =====
async function loadBirthMonth() {
  try {
    const res = await fetch(`${API_BASE}/birthday?device_id=${encodeURIComponent(DEVICE_ID)}`);
    const data = await res.json();
    if (data.birth_month) {
      const form = document.getElementById("birth-month-form");
      form.innerHTML = `<p style="text-align:center;font-size:1.2em;">🎂 ${data.birth_month}月</p>
        <p style="text-align:center;color:#888;">登録済み（変更不可）</p>`;
    }
  } catch (e) {
    console.warn("load birth month failed:", e);
  }
}

document.getElementById("birth-month-btn").addEventListener("click", async () => {
  const select = document.getElementById("birth-month-select");
  const month = select.value;
  const resultEl = document.getElementById("birth-month-result");
  if (!month) {
    resultEl.className = "result-text error";
    resultEl.textContent = "月を選択してください";
    return;
  }
  if (!confirm(`⚠️ ${month}月で登録しますか？\n一度登録すると変更できません。`)) return;
  resultEl.className = "result-text loading";
  resultEl.textContent = "登録中…";
  try {
    const res = await fetch(`${API_BASE}/birthday`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: DEVICE_ID, birth_month: parseInt(month) })
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.className = "result-text success";
      resultEl.textContent = `✅ ${month}月で登録しました！`;
      const form = document.getElementById("birth-month-form");
      form.innerHTML = `<p style="text-align:center;font-size:1.2em;">🎂 ${month}月</p>
        <p style="text-align:center;color:#888;">登録済み（変更不可）</p>`;
      checkBirthdayCoupon();
    } else {
      resultEl.className = "result-text error";
      resultEl.textContent = "❌ " + (data.error || "登録に失敗しました");
    }
  } catch (e) {
    resultEl.className = "result-text error";
    resultEl.textContent = "❌ 通信エラー";
  }
});

// ===== 来店履歴 =====
async function loadCheckinHistory() {
  const el = document.getElementById("checkin-history");
  el.innerHTML = '<p class="loading-text">読み込み中…</p>';
  try {
    const res = await fetch(`${API_BASE}/checkin-history?device_id=${encodeURIComponent(DEVICE_ID)}`);
    const data = await res.json();
    if (!data.history || data.history.length === 0) {
      el.innerHTML = '<p class="loading-text">まだ来店履歴はありません</p>';
      return;
    }
    el.innerHTML = data.history.map(h => `<div class="checkin-item">
      <span class="checkin-spot">${escapeHtml(h.spot_name)}</span>
      <span class="checkin-date">${formatDate(h.checked_in_at)}</span>
    </div>`).join("");
  } catch (e) {
    el.innerHTML = '<p class="loading-text">読み込みに失敗しました</p>';
  }
}

// ===== シェア =====
document.getElementById("share-x-btn").addEventListener("click", () => {
  const text = encodeURIComponent("おにぎり屋かなたけ🍙\n出店スケジュールやクーポンがアプリで見れるよ！\n");
  const url = encodeURIComponent(SHARE_URL);
  window.open(`https://x.com/intent/tweet?text=${text}&url=${url}`, "_blank");
});

document.getElementById("share-line-btn").addEventListener("click", () => {
  const text = encodeURIComponent("おにぎり屋かなたけ🍙 出店スケジュールやクーポンがアプリで見れるよ！ " + SHARE_URL);
  window.open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(SHARE_URL)}&text=${text}`, "_blank");
});

// ★★ 修正: share-copy-btn が index.html に存在しない場合にクラッシュしないようガード
var shareCopyBtn = document.getElementById("share-copy-btn");
if (shareCopyBtn) {
  shareCopyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(SHARE_URL).then(() => {
      alert("✅ リンクをコピーしました！");
    }).catch(() => {
      alert("コピーに失敗しました");
    });
  });
}

// ===== キャッシュクリア =====
// ★★ 修正: "clear-cache-btn" → "cache-clear-btn"（index.html の id="cache-clear-btn" に合わせる）
document.getElementById("cache-clear-btn").addEventListener("click", async () => {
  if (!confirm("キャッシュをクリアしますか？\nアプリが最新の状態に更新されます。")) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }
    alert("✅ キャッシュをクリアしました。ページを再読み込みします。");
    location.reload(true);
  } catch (e) {
    alert("❌ キャッシュクリアに失敗しました");
  }
});

// ===== Web Push 通知登録 =====
async function doPushRegister() {
  var statusEl = document.getElementById("pushStatus");
  statusEl.className = "result-text loading";
  statusEl.textContent = "⏳ 通知を登録中…";

  try {
    var pushOnOff = (document.querySelector('input[name="pushOnOff"]:checked') || {}).value || "off";

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      statusEl.className = "result-text error";
      statusEl.textContent = "❌ このブラウザはプッシュ通知に対応していません";
      return;
    }

    var reg = await navigator.serviceWorker.ready;

    if (pushOnOff === "off") {
      // OFF の場合: 既存 subscription があれば places=["off"] で upsert
      var existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        var offRes = await fetch(PUSH_API_BASE + "/subs/upsert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: existingSub.endpoint,
            keys: {
              p256dh: btoa(String.fromCharCode(...new Uint8Array(existingSub.getKey("p256dh")))),
              auth: btoa(String.fromCharCode(...new Uint8Array(existingSub.getKey("auth"))))
            },
            hour: null,
            places: ["off"]
          })
        });
        var offData = await offRes.json();
        statusEl.className = offData.ok ? "result-text success" : "result-text error";
        statusEl.textContent = offData.ok ? "✅ 通知をOFFにしました" : "❌ " + (offData.error || "保存に失敗しました");
      } else {
        statusEl.className = "result-text success";
        statusEl.textContent = "✅ 通知はOFFです";
      }
      return;
    }

    // ON の場合: VAPID 公開鍵を取得して subscribe
    var vapidRes = await fetch(PUSH_API_BASE + "/vapid");
    if (!vapidRes.ok) throw new Error("VAPID fetch failed: " + vapidRes.status);
    var vapidData = await vapidRes.json();
    var vapidPublicKey = vapidData.publicKey || vapidData.vapidPublicKey;
    if (!vapidPublicKey) throw new Error("VAPID public key not found");

    // Base64 URL → Uint8Array
    var rawKey = vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/");
    var padding = "=".repeat((4 - rawKey.length % 4) % 4);
    var keyBytes = atob(rawKey + padding);
    var applicationServerKey = new Uint8Array(keyBytes.length);
    for (var i = 0; i < keyBytes.length; i++) {
      applicationServerKey[i] = keyBytes.charCodeAt(i);
    }

    var permission = await Notification.requestPermission();
    if (permission !== "granted") {
      statusEl.className = "result-text error";
      statusEl.textContent = "❌ 通知の許可が必要です。ブラウザの設定を確認してください。";
      return;
    }

    var subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey
    });

    // 時間・場所設定を収集
    var hour = document.querySelector('input[name="notifyHour"]:checked');
    var hourVal = hour ? parseInt(hour.value) : 21;

    var placeMode = (document.querySelector('input[name="placeMode"]:checked') || {}).value || "all";
    var places;
    if (placeMode === "all") {
      places = [];
    } else {
      places = [...document.querySelectorAll(".placeChk:checked")].map(function(x) { return x.value; });
      if (places.length === 0) {
        statusEl.className = "result-text error";
        statusEl.textContent = "❌ 通知する場所を1つ以上選んでください";
        return;
      }
    }

    // サーバーに登録
    var subJson = subscription.toJSON();
    var upsertRes = await fetch(PUSH_API_BASE + "/subs/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: { endpoint: subJson.endpoint, keys: subJson.keys },
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        hour: hourVal,
        places: places
      })
    });
    var upsertData = await upsertRes.json();

    if (upsertData.ok) {
      statusEl.className = "result-text success";
      statusEl.textContent = "✅ 通知設定を保存しました！";
    } else {
      statusEl.className = "result-text error";
      statusEl.textContent = "❌ " + (upsertData.error || "登録に失敗しました");
    }
  } catch (e) {
    console.error("doPushRegister error:", e);
    statusEl.className = "result-text error";
    statusEl.textContent = "❌ 通知登録に失敗しました";
  }
}

// pushBtn クリックハンドラ（Web Push 用）
document.getElementById("pushBtn").addEventListener("click", doPushRegister);

// ===== Service Worker 登録 =====
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    var reg = await navigator.serviceWorker.register("sw.js");
    console.log("SW registered:", reg.scope);
  } catch (e) {
    console.warn("SW registration failed:", e);
  }
}

// ===== ユーティリティ =====
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2,"0")}/${d.getDate().toString().padStart(2,"0")}`;
}
