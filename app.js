// ===== 設定 =====
const API_BASE = "https://kanatake-api.la-kofu.workers.dev";
const PUSH_API_BASE = "https://kanatae-push.la-kofu.workers.dev";
const ASSETS_BASE = "";  // 相対パス（同じリポジトリ内）
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

// ===== ページナビ =====
const navBtns = document.querySelectorAll(".nav-btn");
const pages = document.querySelectorAll(".page");
let currentPage = "home";
let mapInitialized = false;
let mapInstance = null;
let markersArray = [];

navBtns.forEach(btn => {
  btn.addEventListener("click", () => { switchPage(btn.dataset.page); });
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
  if (page === "coupon") loadMyCoupons();

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.scrollTop = 0;
}

// ===== 初期化 =====
document.addEventListener("DOMContentLoaded", async () => {
  DEVICE_ID = getDeviceId();

  await registerDevice();
  document.getElementById("device-id-display").textContent = DEVICE_ID;

  initStampGrid();
  await loadPoints();
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

  syncPlaceUI();
  registerSW().catch(() => {});
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
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("active"); });
}

// ===== 場所 UI 排他制御 =====
function syncPlaceUI() {
  const offChk = document.getElementById("place_off");
  const allChk = document.getElementById("place_all");
  const placeChks = document.querySelectorAll(".placeChk");
  const placeList = document.getElementById("placeList");

  if (!offChk || !allChk) return;

  offChk.addEventListener("change", function() {
    if (this.checked) {
      allChk.checked = false; allChk.disabled = true;
      placeChks.forEach(c => { c.checked = false; c.disabled = true; });
      if (placeList) placeList.style.opacity = "0.4";
    } else {
      allChk.disabled = false; allChk.checked = true;
      placeChks.forEach(c => { c.disabled = true; });
      if (placeList) placeList.style.opacity = "0.4";
    }
  });

  allChk.addEventListener("change", function() {
    if (this.checked) {
      offChk.checked = false;
      placeChks.forEach(c => { c.checked = false; c.disabled = true; });
      if (placeList) placeList.style.opacity = "0.4";
    } else {
      placeChks.forEach(c => { c.disabled = false; });
      if (placeList) placeList.style.opacity = "1";
    }
  });

  placeChks.forEach(c => {
    c.addEventListener("change", function() {
      if ([...placeChks].some(x => x.checked)) { allChk.checked = false; offChk.checked = false; }
    });
  });

  if (allChk.checked) {
    placeChks.forEach(c => { c.disabled = true; });
    if (placeList) placeList.style.opacity = "0.4";
  }
}

// ===== デバイス登録 =====
async function registerDevice() {
  try {
    await fetch(`${API_BASE}/devices`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: DEVICE_ID })
    });
  } catch (e) { console.warn("device register failed:", e); }
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
    let html = `<div class="notice-item"><span class="notice-date">${formatDate(latest.created_at)}</span><div class="notice-body">${renderNoticeBody(latest.body)}</div></div>`;
    if (older.length > 0) {
      html += `<div id="notices-older-toggle" class="notices-older-toggle">▼ 過去のお知らせ（${older.length}件）</div><div id="notices-older-list" class="notices-older-list" style="display:none;">`;
      older.forEach(n => { html += `<div class="notice-item"><span class="notice-date">${formatDate(n.created_at)}</span><div class="notice-body">${renderNoticeBody(n.body)}</div></div>`; });
      html += `</div>`;
    }
    el.innerHTML = html;
    moreBtn.style.display = "none";
    const toggle = document.getElementById("notices-older-toggle");
    if (toggle) {
      toggle.addEventListener("click", function() {
        const list = document.getElementById("notices-older-list");
        if (list.style.display === "none") { list.style.display = "block"; toggle.textContent = "▲ 過去のお知らせを閉じる"; }
        else { list.style.display = "none"; toggle.textContent = `▼ 過去のお知らせ（${older.length}件）`; }
      });
    }
    if (el.querySelector(".twitter-tweet
