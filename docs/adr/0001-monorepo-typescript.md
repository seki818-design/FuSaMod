# ADR-0001: pnpm モノレポ + TypeScript

- 状態: 採用
- 決定: pnpm workspace、TypeScript(strict)、テストは Vitest。UI 非依存のロジックは `packages/` に分離する。
- 理由: フロント/バックで型とロジックを共有でき、安全分析ロジックを単体で厳密にテストできる。
