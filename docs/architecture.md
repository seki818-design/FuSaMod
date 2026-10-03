# アーキテクチャ

```
[Frontend: React + TypeScript]
  Explorer / Viewspace(図+テキスト) / AI Chat / Puzzle View / FMEA シート・ネットビュー
        │ REST・WebSocket
[Backend]
  ├─ Model Service   ─ SysML v2 アダプタ(ADR-0002)
  ├─ Safety Service  ─ @fusamod/safety-core(ネット・FMEA・ASIL・ペア)
  ├─ Trace/Impact    ─ 要素 ID 基準のトレースグラフ
  ├─ AI Service      ─ Claude API + ツール呼び出し + RAG
  └─ Auth / Audit / Versioning
[Storage] Git(.sysml テキスト)+ PostgreSQL(索引・安全分析・監査ログ)
```

## 原則

1. **モデルの正本は SysML v2 テキスト(Git 管理)**。図とテキストは同一モデルのビュー。
2. **FMEA は表ではなくネット(グラフ)の射影**。上位/下位 FMEA は故障ノードを共有する(ADR-0003)。
3. **AI は提案のみ**。モデルへの反映は差分を人が承認してから。出典と承認履歴を残す(ADR-0005)。
4. **Puzzle View はトレースグラフから導出**するビューで、独立した機能にしない。
5. **SCDL ビューは生成ビュー**。モデルの正本を SCDL に依存させない(ADR-0006)。

## 安全分析コアのデータモデル

- 構造ネット: `StructureElement`(SysML の part を `modelRef` で参照)
- 機能ネット: `FunctionNode`(担当要素・上位機能)
- エラーネット: `FailureNode` と `FailureLink`(原因→影響)
  - 下位要素の FM = 注目要素の FC、注目要素の FM = 上位要素の FE(同一ノード)
  - リンクは「直下の下位要素→上位要素」か「同一要素の根本原因→FM」のみ許可
  - 重大度は最上位の FE に付け、下位へ継承。O/D はリンク(原因)ごと
- ASIL: デコンポジション表(ISO 26262-9)、`A(D)` 表記、独立性根拠の管理
- ペア: `IntendedFunction` ↔ `SafetyMechanism`(FTTI・診断カバレッジ・対象故障モード)
