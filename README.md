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

## 開発

```sh
pnpm install
pnpm test        # 全パッケージのテスト
pnpm typecheck
```

## ドキュメント

- [アーキテクチャ](docs/architecture.md)
- [開発体制・計画](docs/plan.md)
- [レビューゲート](docs/review-gates.md)
- ADR: [docs/adr/](docs/adr/)

## SysML v2 の検証

```sh
./tools/sysml-check/run.sh      # SCDL ライブラリと examples/sysml を公式実装で検証(Java 21+ が必要)
./tools/sysml-check/extract.sh  # examples/sysml/*.graph.json を再生成
```
