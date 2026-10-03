# 第 2 回レビューへの対応(要約)

第 2 回の合否点: ISO(A1 87 / B1 87 / C1 88)、MBSE(A1 88 / B3 85 / C2 88)、品質(A2 92 / B2 91 / B4 92 / B5 85 / B6 80(採点 74)/ B7 90 / B8 84)。

| 指摘 | 対応 | 証拠 |
|---|---|---|
| viewer がクエリ(`?x=/analyze`)で書き込める | パスのみ・完全一致の許可リスト。クエリ付きの回帰テスト(5 経路) | server/test/api.test.ts |
| 最新の meta.json が壊れると保存不能 | 版番号をディレクトリ名の最大値から決める。初回保存前の内容を版 1 に残す。履歴の自動削除を監査ログへ | server/test/store-crash.test.ts |
| Dockerfile に libs が無い・依存がロック外 | `COPY libs`、`pnpm deploy` でロックの版に固定、CI に docker build と起動確認(実ランナー未実行) | Dockerfile、ci.yml |
| PORT/HOST の検証、静的資産のキャッシュ | PORT 検証、`::1`/`localhost` を公開扱いにしない、assets を immutable | config.ts、main.ts、app.ts |
| viewer の UI がない | `/api/me`、「読み取り専用」表示、保存ボタンの無効化 | web/store、TopBar |
| 分解の自己参照・循環、要求の親循環 | `DECOMP_CYCLE` / `REQ_PARENT_CYCLE` | safety-core/test/review1.test.ts |
| 分解先が親から導出されていない | `DECOMP_CHILD_NOT_DERIVED` | 同上 |
| 独立性の根拠の欠落・形だけの根拠 | 欠落はエラー、低エントロピー(`aaaaaaaa`)は警告 | 同上 |
| FTA 導出が共有ノードで指数時間 | 共有ノードを再利用(30 段の菱形で 500 ms 未満) | 同上 |
| ID の重複を検査しない | 要求・分解・意図機能・安全機構・ペア・信号フロー・故障・リンク・FT | analysis/test |
| 非公式 AP 表が「設定済み」と表示される | `apStatus`、FMEA 画面・CSV の見出し・レポートに明記、E2E | analysis/web |
| AI 由来の印・提案者と承認者の分離 | `aiChanges`(safety.json)、`requestedBy`、`FUSAMOD_AI_SEPARATE_APPROVER` | server/test/api.test.ts |
| 検出できる誤り・できない誤りが不明 | docs/safety-notes.md に一覧 | docs |
| `satisfy` の誤紐づけ(定義側に解決される) | 連鎖(`byChain`)を出力し、その経路のインスタンス 1 つにだけ紐づける。特定できなければ警告 | sysml-graph/test/expand.test.ts(公式実装の出力) |
| usage 側の特殊化・再定義で子が欠落、`ref part` が構造に入る | 元の使用の中身を引き継ぐ。ref は除外して警告 | 同上 |
| `satisfy x;`(by なし)、入れ子 requirement | 囲む part が満たす。親子を残す | 同上 |
| SCDL の ID が根の追加で変わる、元へ機械的にたどれない | 根も名前ベース。`modelRef` 属性(ライブラリ・書き出し・読み込み) | analysis/scdl test |
| 影響分析が無方向で全体に波及 | 下位へのみ波及。上位は確認のみ、分解の相手を別掲 | analysis/test |
| FUNCTION_HIERARCHY の誤警告、SCDL エラー時の書き出し | 同じ要素の入れ子 action を許可、エラー時は 409 | safety-core / server test |
| 解析パネルの欠け、SCDL 図の文字が小さい | セレクト・入力幅の縮小、SCDL を 920px 基準 | スクリーンショット |

## 未対応(報告に残す)
- AIAG-VDA 7 ステップ、SPFM/LFM/PMHF、FMEA-MSR の集計、`diagnosticCoverage` の利用
- SysML v2 API / 標準 JSON / XMI、port・connection・flow・state の導出
- 圧縮配信(リバースプロキシで)、コンポーネント単位の UI テスト、実ランナーでの CI と Docker のビルド
