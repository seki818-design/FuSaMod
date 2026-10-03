# 開発体制・計画

## 体制(想定: コア 8〜9 名 + 外部レビューア)

PO 1 / テックリード 1 / フロントエンド 2 / バックエンド 2 / AI 1 / 社内ドメイン担当(安全+MBSE)1 / QA 1 / UX 0.5。
外部レビューア: **ISO 26262 専門家**、**MBSE 専門家**(各ゲートで書面レビュー。[review-gates.md](review-gates.md))。
本リポジトリでの開発中は、実在の専門家の代わりに、**シミュレートしたレビュー担当(AI)** による採点を行った([quality/reviews/](quality/reviews/))。これは実在の専門家による承認の代替ではない。

## 実装の状況

| 領域 | 状態 | 備考 |
|---|---|---|
| SysML v2 取り込み(公式実装、常駐) | 実装済み | `part` / `action` / `perform` / `satisfy` / `dependency` / `metadata`。`part def`・型付き usage・port・connection・flow・state・allocate は未対応(ADR-0008) |
| 構造・機能・エラーネット、FMEA ビュー、整合性チェック | 実装済み | AP 表は利用者が用意(ADR-0004) |
| HARA、ASIL 決定、安全目標、ASIL 継承の検査、デコンポジション、意図機能と安全機構のペア | 実装済み | 独立性は根拠の記録と形式検査まで |
| FTA(最小カットセット、確率の上限) | 実装済み | 独立事象を仮定。共通原因は別途 |
| SCDL ビュー、SysML ステレオタイプの書き出し/読み込み | 実装済み | ADR-0006/0007。ASAM 公式ツールとの相互運用は未確認 |
| AI(提案 → 承認、RAG、監査) | 実装済み | 既定はルールベース。Claude は設定で有効化 |
| パズルビュー、トレース、エクスポート(CSV/Markdown) | 実装済み | |
| 認証・役割(editor/viewer)・レート制限・監査ログのハッシュ連鎖 | 実装済み | |
| ビルド・配布(esbuild による単一ファイル、Dockerfile) | 実装済み | Docker イメージのビルドは環境により未検証(docs/operations.md) |
| FMEA の 7 ステップのワークフロー(最適化など)、SPFM/LFM/PMHF、FMEA-MSR | 未実装 | 今後の課題 |
| SysML v2 API(REST)・標準 JSON・XMI の入出力 | 未実装 | 公式実装の textual notation のみ |
| 図上でのモデル編集、Git 連携 | 未実装 | テキスト編集と履歴(リビジョン)のみ |

## リスク

SysML v2 仕様の変動(アダプタで隔離)/ AI の誤判断(提案・承認の分離)/ 範囲の拡大 / 図の自動レイアウト。
