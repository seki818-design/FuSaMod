# FuSaMod

SysML v2 に準拠したシステムモデリングと、ISO 26262 / AIAG-VDA に基づく安全分析を、AI が補助しながら行うツール。

## 構成

| パス | 内容 |
|---|---|
| `packages/safety-core` | 構造/機能/エラーネット、FMEA ビュー導出、整合性チェック、ASIL デコンポジション、意図機能と安全機構のペア(UI 非依存の純粋ロジック) |
| `packages/sysml-graph` | SysML 要素グラフの型と、構造ネット・機能ネットの導出(ADR-0008) |
| `packages/scdl` | ASAM SCDL v1.6.0 のメタモデル、検証、SysML v2 テキストとの相互変換(描画は後続) |
| `libs/sysml/scdl` | SCDL ステレオタイプ・ライブラリ(SysML v2 の `metadata def`) |
| `examples/sysml` | ライブラリを使った SysML v2 の例(`@fusamod/scdl` が生成) |
| `tools/sysml-check` | 公式 SysML v2 パイロット実装での検証(`run.sh`)と要素グラフの抽出(`extract.sh`)。初回に約 120MB を取得 |
| `docs/` | 設計方針・開発計画・レビューゲート・ADR |

## クイックスタート

```sh
pnpm install && pnpm build && pnpm start   # http://127.0.0.1:8787
```

初期データ: `projects/ev-powertrain`(EV パワートレインの例)。設定は [`.env.example`](.env.example)。

## 運用・設定
- 設定は環境変数（`.env.example`）。認証は `FUSAMOD_TOKENS`、AI は `FUSAMOD_AI_PROVIDER`、公式 SysML 実装は **JDK 21 以上**（`java` と `javac`。JRE だけでは不可）が必要（無ければ保存済みのモデルのみ解析）。Windows / Mac / Linux で動く（取得・展開・コンパイルは Node.js だけで行うので、bash などは不要。Node.js は 22.15 以上）。
- Docker: `Dockerfile` を同梱（未検証。docs/operations.md）。セキュリティの考え方は [docs/security.md](docs/security.md)。

## 開発

```sh
pnpm install
pnpm test        # 全パッケージのテスト
pnpm typecheck && pnpm lint
pnpm e2e         # Playwright(Chromium)+ axe アクセシビリティ
pnpm quality     # 型・lint・テスト・カバレッジ・性能
```

## ドキュメント

- [利用ガイド](docs/user-guide.md) / [運用ガイド](docs/operations.md) / [セキュリティ](docs/security.md) / [安全規格上の位置づけ・制限](docs/safety-notes.md)
- 品質評価: [ルーブリック](docs/quality/rubric.md)、[証跡](docs/quality/evidence/)
- [アーキテクチャ](docs/architecture.md)
- [開発体制・計画](docs/plan.md)
- [レビューゲート](docs/review-gates.md)
- ADR: [docs/adr/](docs/adr/)

## SysML v2 の検証

```sh
./tools/sysml-check/run.sh      # SCDL ライブラリと examples/sysml を公式実装で検証(Java 21+ が必要)
./tools/sysml-check/extract.sh  # examples/sysml/*.graph.json を再生成
```
