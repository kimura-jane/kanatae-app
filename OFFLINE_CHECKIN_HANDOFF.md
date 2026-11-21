# Android/Web 来店ポイント v1.4.0 改修引き継ぎ

変更対象: `kanatae-app` (Android / GitHub Pages / PWA)
iOS版: `kimura-jane/kanatake-v2` の `feature/offline-checkin-20261121`。

## 変更
- `vendor/html5-qrcode.min.js` を同梱し、QRスキャナーをCDNに依存させない
- `checkin-offline.js` を追加して未確定受付を端末内に保存
- `app.js` のQRチェックインではGPS取得を必須としない
- 通信復旧・アプリ復帰・アプリ再起動時に `POST /checkin-v2` を再送
- `sw.js` を `kanatake-v18` に更新。QRライブラリと仮受付処理をPWAで事前キャッシュ
- QRの交換とシールの追加は今回対象外
- アプリの画面表示バージョンは既に v1.4.0

## Cloudflare側の必須対応
`kanatake-api` の `POST /checkin-v2` と `checkin_claims_v2` テーブルが必要。
iOS版の作業用ブランチ `CHECKIN_V2_HANDOFF.md` を参照すること。

## 動作と制約
- 新APIが利用できない間は「仮受付」から先に進まず、既存のポイント残高を変更しない
- 未確定の仮受付はlocalStorageに保存。端末のサイトデータ削除・アプリデータ消去では失われる
- Service Worker経由のWebアプリは初回オンラインでの読み込み・キャッシュ準備が必要
- Androidのアプリ本体（Google Play掲載のパッケージ）バージョンとPWAの画面表示バージョンは別。Playストア更新の要否は配布形態に依存
- QRの内容自体が現在は認証に使われていないため、任意QRの利用リスクが残る
- GPSや端末時刻は信頼できる来店証明ではない
- 旧API `/checkin` のまま動作する旧アプリとの重複付与対策はWorker側で必要

## 公開手順
1. Cloudflare D1の追加テーブルとWorker新APIを検証
2. 開発端末でオフラインQR読み取り→通信復帰→ポイント確定を確認
3. iOSの更新と整合を取って `main` にマージし、GitHub Pages公開
4. Android配布方式に応じてGoogle Playの更新手続を判断

本番Cloudflare、GitHub Pages、Google Playへの反映はこの作業用ブランチでは行わない。

## 2026-11-21 GitHub追加修正

- QRスキャンの多重コールバックをガード
- API障害時の連続送信を停止。送信中の受付は次のラウンドで再送
- 自動回帰テスト: `node --test tests/checkin-offline.test.cjs`
- WorkerはCodexが実運用コードを監査・修正予定。Cloudflareデプロイ前にAndroid/Web版の本番公開は行わない
- 既存の`kanatake_device_id`、ポイント、クーポン、カレンダー、通知機能を変更しない

## 2026-11-21 mainの更新について

この作業用ブランチの分岐後、mainの`spots-feed.json`に12月の出店予定に関する3コミットが追加されている。
作業ブランチでは`spots-feed.json`を一切編集していない。
PRのマージ時は**最新mainの`spots-feed.json`をそのまま維持**すること。main全体を作業ブランチの状態で上書きしないこと。

## 監査B判定へのGitHub対応（2026-11-21）
- CodexのWorker下書きが交換時に20ポイントだけ減算する仕様に合わせ、交換後に0を固定表示する不具合を修正
- 交換直後はサーバーが返した`current_points`を使用、未返却なら`/points`を再取得
- 再取得もできなければ残高を「確認中」とし、誤った数値を表示しない
- 交換の連続タップを抑止し、交換確認文も「20ポイント消費・超過分は残る」に変更
- 回帰テストを`tests/redeem-points.test.cjs`に追加。iOSは`npm test`で両テストを実行
- Workerの現在の実コードはCodexのローカル`worker-draft.mjs`に保存されており、GitHub参考Workerとは別。Codex側のコードでデプロイ前にAPI契約を確認すること
- Codex監査はB判定、クラウド本番への変更は未実施。受付の過去・未来許容期間は運用者の決定待ち。新APIを本番公開してからアプリを公開する
