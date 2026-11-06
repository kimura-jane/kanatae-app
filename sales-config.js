
/*
 * おにぎり屋かなたけ
 * 販売状況API設定とサイト共通デザイン
 *
 * テーマ：おにぎりでえがお
 *
 * 既存の販売状況APIは変更しません。
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

  // 既存CSSの後から新しいテーマを読み込む。
  var stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = 'kanatake-theme.css?v=3';
  document.head.appendChild(stylesheet);

  // 店主用管理画面
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

  if (
    home &&
    !home.querySelector('.kanatake-welcome')
  ) {
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
})();
