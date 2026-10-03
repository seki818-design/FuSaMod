# 運用ガイド

## 構成
Node.js 22 + pnpm。サーバー(Fastify)が API と Web UI(`apps/web/dist`)を配信。SysML 解析は常駐の Java 21 プロセス(公式パイロット実装)で、無ければスナップショットに縮退。

## 環境変数
[`.env.example`](../.env.example) を参照。

## 認証とネットワーク
- `FUSAMOD_TOKENS`(`ユーザー名[/viewer]:トークン` のカンマ区切り。例: `alice:<24 バイト以上の乱数>,bob/viewer:<乱数>`)を設定すると、全 API にベアラートークンが必要。トークンは 16 文字以上・重複不可(`openssl rand -hex 24` など)。比較は定数時間。`viewer` は読み取りと解析のみ(保存・AI の承認などは 403)。操作者名(トークンではなくユーザー名)が監査ログに記録される。認証の失敗は 1 分に 10 回まで(超えると 429)、API 全体は 1 分に 600 回まで。
- 未設定のときは認証無し。`HOST=127.0.0.1` のまま、ローカル専用で使うこと。外部公開するときは TLS 終端(リバースプロキシ)と `FUSAMOD_TOKENS` が必須。
- レート制限、セキュリティヘッダ(CSP 等)、入力サイズ上限、zod による入力検証を実装済み。

## データとバックアップ
`FUSAMOD_PROJECTS/<id>/` に `model.sysml`、`model.graph.json`、`safety.json`、`.history/`(リビジョン。既定で直近 500 件、`FUSAMOD_HISTORY_KEEP` で変更)、`audit.jsonl`、`refs/` を保存。保存は「履歴を一時ディレクトリに書いて rename で確定 → 現在のファイルを更新」の順で、途中で落ちても確定済みの履歴の内容が読まれる。ディレクトリを丸ごとコピー(または Git 管理)すればバックアップになる。リビジョンは「履歴」タブから復元できる(復元も新しいリビジョンとして記録)。同時編集は `baseRevision` による楽観的排他制御。

## 監査ログ
`audit.jsonl` は各行に直前の行のハッシュを持つ(ハッシュ連鎖)。`GET /api/projects/:id/audit` の `chain.ok` で途中の行の改ざん・削除を検出できる(画面の「履歴」タブにも表示)。**末尾の削除や全面的な作り直しは検出できない**ため、重要な運用では外部のログ基盤へ転送すること。

## 手でファイルを書き換えない
`model.sysml` / `safety.json` をディレクトリ上で直接書き換えると、次の読み込みで「確定済みの履歴の最新版」の内容に戻る(履歴とのハッシュの不一致を、途中で落ちた保存とみなすため)。変更は画面・API から保存すること。履歴が無い手置きのプロジェクトは、最初の保存の前に元の内容が版 1 として残る。履歴の自動削除(既定 500 件超)は監査ログ(`history.prune`)に記録される。

## 標準形式への書き出し
`モデル(SysML v2 標準 JSON)` / `モデル(XMI)` は、公式実装の変換器(Java 21)を一時プロセスで呼ぶ。Java が無い・`FUSAMOD_SYSML=snapshot` のときは 503。

## プロキシの背後・通知・単一プロセス
- リバースプロキシの背後では `FUSAMOD_TRUST_PROXY`(`true` か段数)を設定する。未設定のままだと、全員が同じ接続元に見え、レート制限と監査の IP がプロキシのものになる。
- 画面の「通知」: 現在のファイルが履歴と食い違っていた(手書き換え・途中で落ちた保存)、壊れた履歴を隔離した、などをサーバーが知らせる。
- **単一プロセス前提**: レート制限・LRU キャッシュ・ロックはプロセス内。複数プロセスで同じ `FUSAMOD_PROJECTS` を共有しない。

## 静的配信
Web UI の `assets/` はハッシュ付きなので長期キャッシュ(immutable)、`index.html` は毎回確認する。圧縮は行わない(必要ならリバースプロキシで)。

## 監視
`GET /api/health` が状態(sysml モード、AI、認証要否)を返す。

## 公式 SysML 実装
初回に jar(約 120MB)を取得して `~/.cache/fusamod/` に保存する。オフライン環境では事前に配置するか、`FUSAMOD_SYSML=snapshot` を使う。

## 品質確認コマンド
`pnpm quality`(型・lint・テスト・カバレッジ・性能)、`pnpm e2e`(Playwright と axe)、`pnpm test:integration`(公式実装との結合、Java 必要)、`pnpm audit --prod`。

## ビルドと配布
- `pnpm build`(Web UI)と `pnpm --filter @fusamod/server build`(サーバーを `apps/server/dist/server.mjs` の 1 ファイルにまとめる。実行時に `tsx` は不要。`fastify` と `@fastify/static` のみ外部依存)。`node apps/server/dist/server.mjs` で起動。`FUSAMOD_WEB_DIST` で Web UI の配置先を変えられる。
- `Dockerfile` を同梱(Java 21 + Node 22。依存は `pnpm deploy` でロックファイルの版に固定。公式 SysML 実装の取得に初回ネットワークが必要)。CI に `docker build` と起動確認のジョブを追加した(まだ実ランナーで実行されていない)。**このリポジトリの開発環境では Docker デーモンが無く、イメージのビルドは未検証**。使う前に `docker build` と `/api/health` の確認を行うこと。

## Docker とオフライン環境
- Docker: `docker build -t fusamod .` → `docker run -p 8787:8787 -e FUSAMOD_TOKENS='名前:16文字以上の乱数' -v fusamod-data:/data fusamod`。データは `/data`（プロジェクトと公式実装のキャッシュ）。**イメージのビルドは、この開発環境（Docker なし）では未検証で、CI の docker ジョブが初めての検証になる**。
- オフライン: 公式 SysML 実装の jar（約 120MB）は初回に取得される。事前に `SYSML_PILOT_CACHE`（既定 `~/.cache/fusamod/sysml-pilot-0.62.0`）へ配置するか、`FUSAMOD_SYSML=snapshot`（保存済みグラフのみ）で使う。標準形式のエクスポートと、モデルの編集後の再解析には Java 21 と jar が必要。
- 監査ログは大きくなりうる（ローテーションなし）。`GET /audit` は全体を読むため、数十 MB で遅くなる。定期的に外部へ転送して整理すること。
