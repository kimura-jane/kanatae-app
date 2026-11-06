
/*
 * おにぎり屋かなたけ
 * 販売状況API設定とサイト共通デザイン
 *
 * テーマ：おにぎりでえがお
 * 管理者認証・販売状態・ポイント・クーポンには触れません。
 */

window.KANATAKE_SALES_API_BASE =
  'https://kanatake-sales-test.la-kofu.workers.dev';

(function () {
  'use strict';

  var isAdmin = !!document.getElementById('login-area');
  var isApp = !!document.getElementById('app');

  if (!isAdmin && !isApp) return;

  // 既存の公式アイコンを両アプリで共通使用する。
  var mascotUrl =
    'https://kimura-jane.github.io/kanatae-app/icon.png';

  // 既存CSSの後からテーマを読み込む。
  var stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = 'kanatake-theme.css?v=3';
  document.head.appendChild(stylesheet);

  // 店主用管理画面は従来のまま。
  if (isAdmin) {
    document.body.classList.add('kanatake-admin');

    var adminTitle =
      document.querySelector('.container > h1');

    if (
      adminTitle &&
      !adminTitle.querySelector('.kanatake-logo')
    ) {
      adminTitle.textContent = 'かなたけ管理画面';

      var adminLogo = document.createElement('img');
      adminLogo.src = mascotUrl;
      adminLogo.alt = '';
      adminLogo.className = 'kanatake-logo';

      adminTitle.prepend(adminLogo);
    }
    return;
  }

  // お客様用アプリ
  document.body.classList.add('kanatake-friendly');

  var headerLogo = document.querySelector('.header-icon');
  if (headerLogo) {
    headerLogo.src = mascotUrl;
    headerLogo.alt = 'おにぎり屋かなたけのキャラクター';
  }

  var home = document.getElementById('page-home');
  if (home && !home.querySelector('.kanatake-welcome')) {
    var welcome = document.createElement('div');
    welcome.className = 'kanatake-welcome';
    welcome.setAttribute('aria-label', 'おにぎりでえがお');

    var copy = document.createElement('div');
    copy.className = 'kanatake-welcome-copy';

    var kicker = document.createElement('span');
    kicker.className = 'kanatake-welcome-kicker';
    kicker.textContent = 'おにぎりでえがお';

    var message = document.createElement('p');
    message.textContent =
      '子どもたちと地域の笑顔を応援するキッチンカー。';

    var mascot = document.createElement('img');
    mascot.className = 'kanatake-welcome-mascot';
    mascot.src = mascotUrl;
    mascot.alt = '';
    mascot.loading = 'eager';

    copy.appendChild(kicker);
    copy.appendChild(message);
    welcome.appendChild(copy);
    welcome.appendChild(mascot);
    home.insertBefore(welcome, home.firstChild);
  }

  // 口コミ投稿欄の文字数制限を解除する。
  var reviewBody = document.getElementById('review-body');
  if (reviewBody) {
    reviewBody.removeAttribute('maxlength');
    reviewBody.placeholder = '口コミを書いてね';
  }

  var reviewCounter = document.querySelector('.review-char-count');
  if (reviewCounter) {
    var currentCount = document.getElementById('review-char-current');
    if (currentCount) {
      currentCount.textContent =
        reviewBody ? String(reviewBody.value.length) : '0';
      reviewCounter.replaceChildren(
        currentCount,
        document.createTextNode('文字')
      );
    }
  }

  // 口コミの投稿日だけを非表示にする。
  var reviewStyle = document.createElement('style');
  reviewStyle.textContent =
    '.kanatake-friendly .review-date { display: none !important; }';
  document.head.appendChild(reviewStyle);

  // ===== 外観カスタマイズ =====
  // 保存先は各端末のlocalStorage。サーバーやアカウントには保存しない。
  var FONT_KEY = 'kanatake_font_v1';
  var COLOR_KEY = 'kanatake_color_v1';

  var fonts = {
    original: null,
    hand: "'Yomogi', 'Zen Maru Gothic', sans-serif",
    simple: "-apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif"
  };

  var colors = {
    orange: null, // 標準の「おにぎりでえがお」配色をそのまま維持
    green: {
      accent: '#47672d', button: '#c5daa9', light: '#eaf4de',
      paper: '#f5faef', white: '#fcfff8', line: '#c4d7ad'
    },
    pink: {
      accent: '#963a61', button: '#f0bdd0', light: '#fff0f5',
      paper: '#fff7fa', white: '#fffbfd', line: '#eac2d1'
    },
    blue: {
      accent: '#285e87', button: '#b6d5ec', light: '#eaf4fc',
      paper: '#f4faff', white: '#fcfeff', line: '#bad5e9'
    }
  };

  function loadPreference(key, fallback, allowed) {
    try {
      var saved = window.localStorage.getItem(key);
      return Object.prototype.hasOwnProperty.call(allowed, saved)
        ? saved : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function savePreference(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function applyFont(name) {
    document.body.dataset.kanatakeFont = name;
    if (name === 'original') {
      document.body.style.removeProperty('--kanatake-body-font');
      document.body.style.removeProperty('--kanatake-hand-font');
    } else {
      document.body.style.setProperty('--kanatake-body-font', fonts[name]);
      document.body.style.setProperty('--kanatake-hand-font', fonts[name]);
    }
  }

  var colorVariables = [
    '--kt-accent', '--kt-button', '--kt-light',
    '--kt-paper', '--kt-white', '--kt-line',
    '--kanatake-paper', '--kanatake-white', '--kanatake-line',
    '--kanatake-orange', '--kanatake-orange-dark',
    '--kanatake-peach', '--kanatake-green', '--kanatake-green-dark'
  ];
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  var originalThemeColor = themeMeta ? themeMeta.getAttribute('content') : null;

  function applyColor(name) {
    document.body.dataset.kanatakeColor = name;
    var palette = colors[name];
    colorVariables.forEach(function (variable) {
      document.body.style.removeProperty(variable);
    });

    if (palette) {
      var values = {
        '--kt-accent': palette.accent,
        '--kt-button': palette.button,
        '--kt-light': palette.light,
        '--kt-paper': palette.paper,
        '--kt-white': palette.white,
        '--kt-line': palette.line,
        '--kanatake-paper': palette.paper,
        '--kanatake-white': palette.white,
        '--kanatake-line': palette.line,
        '--kanatake-orange': palette.accent,
        '--kanatake-orange-dark': palette.accent,
        '--kanatake-peach': palette.light,
        '--kanatake-green': palette.accent,
        '--kanatake-green-dark': palette.accent
      };
      Object.keys(values).forEach(function (key) {
        document.body.style.setProperty(key, values[key]);
      });
    }
    if (themeMeta && originalThemeColor !== null) {
      themeMeta.setAttribute('content', palette ? palette.light : originalThemeColor);
    }
  }

  var appearanceStyle = document.createElement('style');
  appearanceStyle.textContent = `
    .kanatake-friendly .kt-appearance .kt-font-list {
      display: grid; gap: 8px; border: 0; padding: 0; margin: 8px 0 17px;
    }
    .kanatake-friendly .kt-appearance .kt-font-option {
      display: flex; align-items: center; gap: 10px;
      padding: 11px 12px; background: var(--kanatake-white);
      border: 1px solid var(--kanatake-line); border-radius: 12px;
      cursor: pointer; font-size: 14px;
    }
    .kanatake-friendly .kt-appearance input[type="radio"] {
      accent-color: var(--kt-accent, #ad581a);
    }
    .kanatake-friendly .kt-appearance .kt-colors {
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 9px; margin: 10px 0 14px;
    }
    .kanatake-friendly .kt-appearance .kt-color-option {
      position: relative; display: flex; flex-direction: column;
      align-items: center; gap: 7px; padding: 8px 2px;
      border-radius: 12px; cursor: pointer; font-size: 11px;
      color: var(--kanatake-brown); text-align: center;
    }
    .kanatake-friendly .kt-appearance .kt-color-option input {
      position: absolute; inset: 0; width: 100%; height: 100%;
      opacity: 0; cursor: pointer; margin: 0;
    }
    .kanatake-friendly .kt-appearance .kt-color-swatch {
      display: block; width: 38px; height: 38px;
      border: 2px solid #ffffff; border-radius: 50%;
      box-shadow: 0 1px 5px rgba(0,0,0,.15);
    }
    .kanatake-friendly .kt-appearance input:checked + .kt-color-swatch {
      outline: 3px solid var(--kt-accent, #ad581a);
      outline-offset: 3px;
    }
    .kanatake-friendly .kt-appearance input:focus-visible + .kt-color-swatch {
      box-shadow: 0 0 0 5px rgba(0,0,0,.20);
    }
    .kanatake-friendly .kt-appearance .kt-preview {
      margin: 6px 0 8px; padding: 13px;
      background: var(--kanatake-white); border: 1px dashed var(--kanatake-line);
      border-radius: 13px; color: var(--kanatake-brown);
    }
    .kanatake-friendly .kt-appearance .kt-preview-title {
      font-family: var(--kanatake-hand-font); font-size: 20px; font-weight: 700;
      color: var(--kt-accent, #79451f);
    }
    .kanatake-friendly .kt-appearance .kt-preview-body {
      font-family: var(--kanatake-body-font); font-size: 13px; margin-top: 6px;
    }
    .kanatake-friendly .kt-appearance .kt-status { font-size: 12px; margin: 8px 0 0; }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .header {
      background: var(--kt-light); border-bottom-color: var(--kt-line);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .header::after,
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .section-title::after {
      background: var(--kt-accent);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .kanatake-welcome {
      background: linear-gradient(120deg, var(--kt-light), var(--kt-white));
      border-color: var(--kt-line);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .kanatake-welcome::before {
      background: var(--kt-light);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .kanatake-welcome-kicker {
      color: var(--kt-accent); border-bottom-color: var(--kt-button);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .section-title {
      border-bottom-color: var(--kt-line);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) #notices-area,
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) #sales-board-section {
      border-top-color: var(--kt-accent);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .settings-card,
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .settings-note,
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .menu-notice {
      background: var(--kt-light); border-color: var(--kt-line);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .settings-option {
      border-color: var(--kt-line);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .btn-primary:not(:disabled),
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .modal-btn:not(.modal-close),
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .financie-copy-btn,
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .btn-financie,
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .calendar-nav {
      background: var(--kt-button); color: #302c22; border-color: var(--kt-line);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .calendar-day.has-event {
      background: var(--kt-light); border-color: var(--kt-accent);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .calendar-day.today,
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .calendar-day.has-event.today {
      background: var(--kt-accent); border-color: var(--kt-accent); color: #fff;
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .bottom-nav {
      background: var(--kt-paper); border-top-color: var(--kt-line);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .nav-btn.active {
      background: var(--kt-light); color: var(--kt-accent);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .nav-qr-circle {
      background: var(--kt-accent); border-color: var(--kt-paper);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .review-nickname,
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .notice-link,
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .settings-card-title {
      color: var(--kt-accent);
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .badge {
      background: var(--kt-button); color: #302c22;
    }
    body.kanatake-friendly[data-kanatake-color]:not([data-kanatake-color="orange"]) .stamp-dot.filled {
      background: var(--kt-button); border-color: var(--kt-accent);
    }
  `;
  document.head.appendChild(appearanceStyle);

  var fontName = loadPreference(FONT_KEY, 'original', fonts);
  var colorName = loadPreference(COLOR_KEY, 'orange', colors);
  applyFont(fontName);
  applyColor(colorName);

  var settings = document.getElementById('page-settings');
  if (!settings || document.getElementById('kanatake-appearance')) return;

  var panel = document.createElement('div');
  panel.id = 'kanatake-appearance';
  panel.className = 'section-card kt-appearance';
  panel.innerHTML = `
    <h2 class="section-title">🎨 見た目の設定</h2>
    <p class="settings-desc">フォントとテーマカラーを選べます。変更はすぐ反映されます。</p>
    <div class="settings-card">
      <p class="settings-card-title">フォント</p>
      <fieldset class="kt-font-list" aria-label="フォントの種類">
        <label class="kt-font-option"><input type="radio" name="kt-font" value="original">丸ゴシック（標準）</label>
        <label class="kt-font-option"><input type="radio" name="kt-font" value="hand">手書き風</label>
        <label class="kt-font-option"><input type="radio" name="kt-font" value="simple">すっきりした標準文字</label>
      </fieldset>
      <p class="settings-card-title">テーマカラー</p>
      <div class="kt-colors" role="group" aria-label="テーマカラー">
        <label class="kt-color-option"><input type="radio" name="kt-color" value="orange"><span class="kt-color-swatch" style="background:#e9a24d" aria-hidden="true"></span><span>オレンジ</span></label>
        <label class="kt-color-option"><input type="radio" name="kt-color" value="green"><span class="kt-color-swatch" style="background:#89b468" aria-hidden="true"></span><span>グリーン</span></label>
        <label class="kt-color-option"><input type="radio" name="kt-color" value="pink"><span class="kt-color-swatch" style="background:#e6a3bc" aria-hidden="true"></span><span>ピンク</span></label>
        <label class="kt-color-option"><input type="radio" name="kt-color" value="blue"><span class="kt-color-swatch" style="background:#90bedf" aria-hidden="true"></span><span>ブルー</span></label>
      </div>
      <div class="kt-preview" aria-label="選択した文字と色の見本">
        <div class="kt-preview-title">おにぎりでえがお</div>
        <div class="kt-preview-body">今日もおいしいおにぎりを！</div>
      </div>
      <p class="settings-desc">この端末だけに保存されます。ホーム画面のアプリアイコンは変わりません。</p>
      <p class="kt-status" id="kt-appearance-status" role="status" aria-live="polite"></p>
    </div>
  `;
  settings.insertBefore(panel, settings.firstChild);

  var fontInputs = panel.querySelectorAll('input[name="kt-font"]');
  var colorInputs = panel.querySelectorAll('input[name="kt-color"]');
  fontInputs.forEach(function (input) {
    input.checked = input.value === fontName;
    input.addEventListener('change', function () {
      if (!input.checked) return;
      applyFont(input.value);
      setStatus(savePreference(FONT_KEY, input.value));
    });
  });
  colorInputs.forEach(function (input) {
    input.checked = input.value === colorName;
    input.addEventListener('change', function () {
      if (!input.checked) return;
      applyColor(input.value);
      setStatus(savePreference(COLOR_KEY, input.value));
    });
  });

  function setStatus(saved) {
    var status = document.getElementById('kt-appearance-status');
    if (status) {
      status.textContent = saved
        ? 'この端末に保存しました'
        : '保存できませんでした。次回起動時に元へ戻る場合があります。';
    }
  }
})();
