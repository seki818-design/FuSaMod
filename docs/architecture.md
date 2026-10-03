# アーキテクチャ(実装済みの構成)

```
[ブラウザ: React + TypeScript(Vite)]
  エクスプローラ / ビューペース(構造図・SysML テキスト) / AI チャット / パズルビュー
  分析タブ(FMEA・ネット・FTA・HARA・コンセプト・SCDL・トレース・指摘・履歴・データ)
  ※ 安全分析データの編集は、ブラウザ内で analyzeProject を再実行して即時に反映(@fusamod/analysis)
        │ REST(JSON、ベアラートークン)
[サーバー: Node.js + Fastify]
  ├─ プロジェクトストア  ファイルシステム(model.sysml / safety.json / model.graph.json / .history / audit.jsonl / refs)
  ├─ 解析サービス        SysML 解析 → 要素グラフ → deriveNet → analyzeProject(LRU キャッシュ)
  ├─ SysML 常駐プロセス  公式パイロット実装(Java 21、JSON Lines)。無い場合はスナップショット(保存済みグラフ)に縮退
  ├─ AI                  ルールベース(既定)/ Claude(tool_use、zod 検証)。提案 → 承認、監査ログ
  └─ 認証・レート制限・セキュリティヘッダ・楽観的排他制御(baseRevision)
```

保存先は **ファイルシステムのみ**(WebSocket・PostgreSQL・Git 連携は実装していない。バックアップはディレクトリのコピーまたは Git 管理で行う)。
リアルタイムの共同編集は無く、競合は `baseRevision` による 409 で通知する。

## 原則

1. **モデルの正本は SysML v2 テキスト(Git 管理)**。図とテキストは同一モデルのビュー。
2. **FMEA は表ではなくネット(グラフ)の射影**。上位/下位 FMEA は故障ノードを共有する(ADR-0003)。
3. **AI は提案のみ**。モデルへの反映は差分を人が承認してから。出典と承認履歴を残す(ADR-0005)。
4. **Puzzle View はトレースグラフから導出**するビューで、独立した機能にしない。
5. **SCDL ビューは生成ビュー**。モデルの正本を SCDL に依存させない。メタモデルは `@fusamod/scdl` に持つ(ADR-0006)。

## 安全分析コアのデータモデル

- 構造ネット: `StructureElement`(SysML の part を `modelRef` で参照)
- 機能ネット: `FunctionNode`(担当要素・上位機能)
- エラーネット: `FailureNode` と `FailureLink`(原因→影響)
  - 下位要素の FM = 注目要素の FC、注目要素の FM = 上位要素の FE(同一ノード)
  - リンクは「直下の下位要素→上位要素」か「同一要素の根本原因→FM」のみ許可
  - 重大度は最上位の FE に付け、下位へ継承。O/D はリンク(原因)ごと
- ASIL: デコンポジション表(ISO 26262-9)、`A(D)` 表記、独立性根拠の管理
- ペア: `IntendedFunction` ↔ `SafetyMechanism`(FTTI・診断カバレッジ・対象故障モード)

## パッケージ

| パッケージ | 責務 |
|---|---|
| `@fusamod/safety-core` | 構造/機能/エラーネット、FMEA ビュー、ASIL 分解、意図機能と安全機構のペア |
| `@fusamod/sysml-graph` | 公式 SysML 実装が出力する要素グラフの型と、安全分析ネットの導出(`deriveNet`、ADR-0008)(`safety-core` に依存) |
| `@fusamod/scdl` | ASAM SCDL v1.6.0 のメタモデル、検証、SysML v2 ステレオタイプとの相互変換(`safety-core` に依存)。描画は `apps/web` |
