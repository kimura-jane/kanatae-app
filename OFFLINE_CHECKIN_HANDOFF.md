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

## 2026-11-21 最終Worker契約対応（client-compatibility.md / worker-final.mjs照合済み）

- `/points` の`current_points`、`total_redeemed`、`megami_coupon_active`を検証してUIへ反映する
- `/redeem-points`には`device_id`、`required_points:20`、保存済みUUIDの`request_id`、操作開始時の`coupon_generation=total_redeemed`を送信する
- `/megami-coupon/use`には`device_id`、同じ仕組みで保存した`request_id`と`coupon_generation`を送る
- 操作IDは`coupon-operations.js`に保存し、通信エラー／5xx時にも再生成しない。未確定操作を確認するボタンを設置し、**店頭でのクーポン使用は自動再送しない**
- HTTP 200 `replayed:true` は再実行ではなく同じ操作の再確認として表示。409は最新`/points`を読み、古い未確定操作を終える
- FiNANCiE保有クーポンは`coupon_id`を行単位で送信。同じ`code`の別保有行を誤って使わない
- `checkin_expired`は最終Workerの`code`フィールドを読み、90日超の記録を残して詳細表示する
- 回帰テスト：`tests/checkin-offline.test.cjs`（6件）、`tests/redeem-points.test.cjs`（6件）、`tests/financie-coupon.test.cjs`（3件）
- **注意：添付`worker-final.mjs`はCloudflare本番に未デプロイ。新Workerには`coupon_operations_v1`のD1移行が必要。** GitHubのWorker参考コードを本番に直接デプロイしない
- **旧アプリは`request_id`と`coupon_generation`を送らないため、状態を変える交換・使用は新Workerでは426で拒否される。状態により400または409になる。** 旧アプリでは使用失敗が画面に表示されないため、切替前に利用者案内・実機確認が必要
- Android側`main`の12月出店情報（`spots-feed.json`）は保持。GitHub作業ブランチのみを更新し、本番アプリ／Worker／D1は未変更

## 2026-11-22 最終公開前の注意（旧説明より優先）

- **Workerの正本は `kimura-jane/kanatake-api` の `fix/kanatake-api-safe-20261122` の `src/index.js`**。iOS PR 内の `cloudflare/worker-1.4.0.js` は同期済みの検証用コピーであり、そこから本番デプロイしない。
- Codex が本番D1を読み取り、`checkin_claims_v2` の主キーと `(device_id, checkin_date_jst)` UNIQUE を確認。**`coupon_operations_v1` は本番に未作成**。正しい追加SQLは `kanatake-api/migrations/coupon_operations_v1.sql`。旧手順の参考SQLを流用しない。
- 新Workerは旧アプリの曖昧な交換・使用を安全側で拒否する。状態に応じて **426 `app_update_required`、400、409**。旧アプリの使用ボタンは426を表示しないコードになっているため、既存利用者への更新告知・実機確認が必須。
- iOS・Androidの新アプリは `request_id`・`coupon_generation` を送信するコードに変更済み。ただし両PRはドラフトで、新Workerとの**実機／隔離Cloudflare結合試験は未実施**。
- **本番D1への書き込み、本番Workerのトラフィック切替、mainへのマージ、ストア配信は許可なく行わない**。本番稼働Workerの全文を再確認し、全ルートの欠落がないか比較してから公開判断する。
