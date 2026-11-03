
/*
 * おにぎり屋かなたけ
 * 本日の販売状況・公開画像表示
 *
 * 対応:
 * - iPhone Safari
 * - Android Chrome
 * - PWA
 *
 * 公開APIのみ利用。管理者認証不要。
 */
(function () {
  'use strict';

  const api = (
    window.KANATAKE_SALES_API_BASE || ''
  ).replace(/\/$/, '');

  const card = document.getElementById(
    'sales-board-section'
  );

  const image = document.getElementById(
    'sales-board-image'
  );

  const caption = document.getElementById(
    'sales-board-updated'
  );

  if (!api || !card || !image || !caption) {
    return;
  }

  let currentUrl = '';
  let sequence = 0;

  // 日本時間22:00以降は表示しない
  function afterJstClosingTime() {
    return new Date(
      Date.now() + 9 * 3600000
    ).getUTCHours() >= 22;
  }

  function hideBoard() {
    card.style.display = 'none';
    currentUrl = '';
  }

  function updateCaption(value) {
    if (!value) {
      caption.textContent = '';
      return;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      caption.textContent = '';
      return;
    }

    const formatted = date.toLocaleString(
      'ja-JP',
      {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit'
      }
    );

    caption.textContent = '更新：' + formatted;
  }

  async function refresh() {
    if (afterJstClosingTime()) {
      hideBoard();
    }

    const ticket = ++sequence;

    try {
      const response = await fetch(
        api + '/public/current',
        {
          cache: 'no-store'
        }
      );

      if (!response.ok) {
        throw new Error(
          '販売状況APIの取得に失敗しました'
        );
      }

      const data = await response.json();

      if (
        ticket !== sequence ||
        afterJstClosingTime()
      ) {
        return;
      }

      if (
        !data.active ||
        !data.board_url
      ) {
        hideBoard();
        return;
      }

      // 同じ画像なら再ダウンロードしない
      if (data.board_url === currentUrl) {
        card.style.display = 'block';
        return;
      }

      // 新しい画像が読み込まれるまで非表示
      card.style.display = 'none';

      const next = new Image();

      next.onload = function () {
        if (
          ticket !== sequence ||
          afterJstClosingTime()
        ) {
          return;
        }

        image.src = data.board_url;
        currentUrl = data.board_url;

        updateCaption(data.updated_at);

        card.style.display = 'block';
      };

      next.onerror = function () {
        if (ticket === sequence) {
          hideBoard();
        }
      };

      next.src = data.board_url;

    } catch (e) {
      if (ticket === sequence) {
        hideBoard();
      }
    }
  }

  // 22時になったら画面を非表示
  function scheduleJstClose() {
    const shifted = new Date(
      Date.now() + 9 * 3600000
    );

    const millisecondsToday = (
      (
        shifted.getUTCHours() * 60 +
        shifted.getUTCMinutes()
      ) * 60 +
      shifted.getUTCSeconds()
    ) * 1000 + shifted.getUTCMilliseconds();

    let delay =
      22 * 3600000 - millisecondsToday;

    if (delay <= 0) {
      delay += 24 * 3600000;
    }

    setTimeout(function () {
      hideBoard();
      ++sequence;
      refresh();
      scheduleJstClose();
    }, delay);
  }

  scheduleJstClose();

  // 初回取得
  refresh();

  // 30秒ごとの再取得
  setInterval(refresh, 30000);

  // アプリ復帰・タブ再表示
  document.addEventListener(
    'visibilitychange',
    function () {
      if (!document.hidden) {
        refresh();
      }
    }
  );
})();
