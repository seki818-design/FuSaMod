# 運用ガイド

## 構成
Node.js 22 + pnpm。サーバー(Fastify)が API と Web UI(`apps/web/dist`)を配信。SysML 解析は常駐の Java 21 プロセス(公式パイロット実装)で、無ければスナップショットに縮退。

## 環境変数
[`.env.example`](../.env.example) を参照。

## 認証とネットワーク
- `FUSAMOD_TOKENS`(`利用者名:トークン` のカンマ区切り)を設定すると、全 API にベアラートークンが必要。比較は定数時間。操作者名は監査ログに記録される。
- 未設定のときは認証無し。`HOST=127.0.0.1` のまま、ローカル専用で使うこと。外部公開するときは TLS 終端(リバースプロキシ)と `FUSAMOD_TOKENS` が必須。
- レート制限、セキュリティヘッダ(CSP 等)、入力サイズ上限、zod による入力検証を実装済み。

## データとバックアップ
`FUSAMOD_PROJECTS/<id>/` に `model.sysml`、`model.graph.json`、`safety.json`、`history/`(全リビジョン)、`audit.jsonl`、`refs/` を保存。ディレクトリを丸ごとコピー(または Git 管理)すればバックアップになる。リビジョンは「履歴」タブから復元できる(復元も新しいリビジョンとして記録)。同時編集は `baseRevision` による楽観的排他制御。

## 監視
`GET /api/health` が状態(sysml モード、AI、認証要否)を返す。

## 公式 SysML 実装
初回に jar(約 120MB)を取得して `~/.cache/fusamod/` に保存する。オフライン環境では事前に配置するか、`FUSAMOD_SYSML=snapshot` を使う。

## 品質確認コマンド
`pnpm quality`(型・lint・テスト・カバレッジ・性能)、`pnpm e2e`(Playwright と axe)、`pnpm test:integration`(公式実装との結合、Java 必要)、`pnpm audit --prod`。

## パッケージング
Dockerfile は未提供(検証できていないため)。`pnpm build && pnpm start` で動作する。
