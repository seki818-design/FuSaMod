# FuSaMod

SysML v2 に準拠したシステムモデリングと、ISO 26262 / AIAG-VDA に基づく安全分析を、AI が補助しながら行うツール。

## 構成

| パス | 内容 |
|---|---|
| `packages/safety-core` | 構造/機能/エラーネット、FMEA ビュー導出、整合性チェック、ASIL デコンポジション、意図機能と安全機構のペア(UI 非依存の純粋ロジック) |
| `packages/scdl` | ASAM SCDL v1.6.0 のメタモデルと検証(描画は後続) |
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
