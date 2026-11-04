
/*
 * おにぎり屋かなたけ
 * 本日の販売状況・公開画像表示
 *
 * Android / iOS / Web / PWA 共通
 *
 * ・30秒ごとに最新画像を確認
 * ・日本時間22時以降は非表示
 * ・前日以前の画像は表示しない
 * ・翌日の新しい画像のみ表示
 * ・アプリ復帰時に再確認
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

  // 日本時間の日時を取得
  function jstNow() {
    return new Date(
      Date.now() + 9 * 3600000
    );
  }

  // 日本時間 YYYY-MM-DD
  function getJstDay() {
    const d = jstNow();

    const year = d.getUTCFullYear();

    const month = String(
      d.getUTCMonth() + 1
    ).padStart(2, '0');

    const day = String(
      d.getUTCDate()
    ).padStart(2, '0');

    return year + '-' + month + '-' + day;
  }

  // 22:00以降は表示しない
  function afterJstClosingTime() {
    return jstNow().getUTCHours() >= 22;
  }

  function hideBoard() {
    card.style.display = 'none';
    currentUrl = '';
  }

  // 当日の公開画像かを判定
  function isValidBoard(data) {
    if (!data) {
      return false;
    }

    if (afterJstClosingTime()) {
      return false;
    }

    if (
      data.active !== true ||
      !data.board_url
    ) {
      return false;
    }

    // 前日以前の画像は表示しない
    if (data.day !== getJstDay()) {
      return false;
    }

    return true;
  }

  // 更新時刻
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

    caption.textContent =
      '更新：' + formatted;
  }

  // 販売状況の再取得
  async function refresh() {
    const ticket = ++sequence;

    // 22時以降は取得せず非表示
    if (afterJstClosingTime()) {
      hideBoard();
      return;
    }

    try {
      const response = await fetch(
        api + '/public/current',
        {
          cache: 'no-store'
        }
      );

      if (!response.ok) {
        throw new Error(
          '販売状況の取得に失敗しました'
        );
      }

      const data = await response.json();

      if (ticket !== sequence) {
        return;
      }

      // 非公開・前日・22時以降
      if (!isValidBoard(data)) {
        hideBoard();
        return;
      }

      // 同じ画像なら再読み込みしない
      if (data.board_url === currentUrl) {
        card.style.display = 'block';
        return;
      }

      // 新しい画像を先に読み込む
      card.style.display = 'none';

      const next = new Image();

      next.onload = function () {
        if (ticket !== sequence) {
          return;
        }

        // 読み込み中の日付変更にも対応
        if (!isValidBoard(data)) {
          hideBoard();
          return;
        }

        image.src = data.board_url;
        currentUrl = data.board_url;

        updateCaption(
          data.updated_at
        );

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

  // 毎日22:00に非表示
  function scheduleJstClose() {
    const shifted = jstNow();

    const millisecondsToday = (
      (
        shifted.getUTCHours() * 60 +
        shifted.getUTCMinutes()
      ) * 60 +
      shifted.getUTCSeconds()
    ) * 1000 +
    shifted.getUTCMilliseconds();

    let delay =
      22 * 3600000 -
      millisecondsToday;

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

  // 22時の非表示タイマー
  scheduleJstClose();

  // 初回表示
  refresh();

  // 30秒ごとの確認
  setInterval(
    refresh,
    30000
  );

  // 画面復帰時の確認
  document.addEventListener(
    'visibilitychange',
    function () {
      if (!document.hidden) {
        refresh();
      }
    }
  );
})();
