# 第 1 回レビューへの対応(要約)

第 1 回の採点: ISO 26262(A1 79 / B1 79 / C1 80)、MBSE(A1 79 / B3 81 / C2 80)、品質(A2 87 / B2 90 / B4 90 / B5 87 / B6 86 / B7 89 / B8 82)。全項目が不合格(合否点 90 未満)。

| 指摘 | 対応 | 証拠 |
|---|---|---|
| ASIL の引き下げ・安全目標に FSR が無い、が検出されない | `validateAsilInheritance`(REQ_BELOW_GOAL_ASIL / REQ_ASIL_DOWNGRADE / SG_REQ_ASIL_MISMATCH / DECOMP_ORPHAN / GOAL_NO_FSR) | safety-core/test/review1.test.ts、analysis/test |
| 分解の独立性が形式的 | 根拠の空白・短文を検出、祖先/子孫への配置・未配置・分解先の再利用・二重分解をエラー | 同上 |
| `determineAsil` が NaN で QM | 範囲外は RangeError。`validateHara` は例外を投げず HARA_RANGE。ASIL 事象に目標が無いのはエラー | 同上 |
| FTA が空を安全と誤読させる | 循環・未知ノード・空ゲートは `problems`、件数・時間の打ち切りは `truncated`。UI は「判定不可」。再帰を廃止(深さ 50000 でも動作)、吸収則を転置索引で高速化 | 同上(最悪ケースのテスト) |
| `coversFailureIds` が未使用 | 参照チェック(UNKNOWN_REF)と未登録の警告(MECH_NO_COVERAGE) | analysis/test |
| サンプルの SM-1 が FM-PS-1(短絡)を「ゲート遮断でカバー」 | カバー対象から外した。AP 表を同梱(非公式と明記、`apTableSource`、警告 AP_TABLE_NOT_OFFICIAL) | projects/ev-powertrain |
| `FUSAMOD_TOKENS` の書式がドキュメントと逆 | 書式を `ユーザー名[/viewer]:トークン` に統一。16 文字以上・重複拒否。役割(viewer = 読み取り専用)、認証失敗 10 回/分で 429、API 全体 600 回/分 | server/test/api.test.ts |
| 監査ログの改ざん検知なし | ハッシュ連鎖と検証(`chain`)。履歴タブに表示。末尾削除は検出できないことを明記 | server/test/store-crash.test.ts |
| 保存が途中で落ちると食い違う、履歴の遅い劣化 | 履歴を先に確定(rename)→ 現在のファイル。読み込みは確定済みの内容を返す。最新リビジョンの取得を O(1) 化。保存数は `FUSAMOD_HISTORY_KEEP`(既定 500) | 同上(クラッシュ再現・100 回保存の計測) |
| `tsx` に依存する実行、Docker なし、配信ディレクトリが固定 | esbuild で単一ファイル化、`FUSAMOD_WEB_DIST`、Dockerfile(**ビルドは未検証**) | docs/operations.md |
| 1440×900 で画面が欠ける | 列幅、タブの折り返し、図の幅合わせ、SCDL の縮尺。スクリーンショットで確認 | docs/quality/evidence/screenshots |
| architecture.md / plan.md が実装と食い違う | 実装の状況に合わせて書き直し | docs/ |
| 導出が part def・型付き usage・`perform action x : Def` で壊れる | `expandGraph`(定義の展開)。未対応構成は種類ごとに警告 | sysml-graph/test/expand.test.ts(公式実装の出力で確認) |
| SCDL の ID が並び順で変わる、名前を 18 文字で切る、追跡できない | 名前に基づく安定 ID、全文の名前、備考に元の構造要素 | analysis/test |
| 種類をまたぐ ID の重複を見逃す、親の決め方が 2 経路で異なる | `ID_COLLISION`、`scdlFromGraph` も祖先をたどる | scdl/test |
| 影響分析が故障ネットだけ、`satisfy` が action だと未紐づけ | `impactOfRequirementChange`(要求 → satisfy → 要素 → 機能 → 故障 → FMEA、安全要求の詳細化・導出・分解)、トレース画面とAI、`refines` | analysis/test |
| 相互運用の範囲が不明 | ADR-0009、ADR-0008 に未対応構成の一覧 | docs/adr |

## 未対応(今回は実装しない。報告に残す)

- AIAG-VDA 7 ステップのワークフロー(最適化など)、SPFM/LFM/PMHF、FMEA-MSR の集計
- SysML v2 API / 標準 JSON / XMI、port・connection・flow・state の導出
- AI の提案者と承認者の分離(`safety.json` への来歴の記録)
- Docker イメージのビルドの検証、GitHub ランナーでの CI の実行
