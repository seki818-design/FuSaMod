# ラウンド 9 レビューへの対応

（レビュアーはシミュレートした専門家で、認証機関ではありません。）

第 9 回の合否点: ISO（A1 92 / B1 91 / C1 94）、MBSE（A1 96 / B3 93 / C2 96）、品質（A2 93 / **B2 89** / B4 95 / B5 91 / B6 92 / B7 91 / B8 91）。不合格は B2 のみ（1 点不足）。B1/B5/B7/B8 は境界。

| 指摘 | 対応 | 証拠 |
|---|---|---|
| **ISO: 同じ文字数の書き換え（`PT-001` → `PT-002`）が差分にも監査にも出ない。前回の応答書の「必ず記録」は偽だった** | 比較を表示文字列でなく本文で行い、差分には長さと内容の指紋（`#xxxxx`）を載せる | ai/test（同じ長さの書き換え） |
| ISO: HARA の根拠・安全目標の文面と安全状態・ハザード・運転状況が差分の対象外 | 差分の対象に追加 | ai/test |
| ISO: AI の適用が `safety.diff` を監査に残さない | `via: "ai"`、リスク低下の件数、確認の有無、差分の抜粋を監査に残す | api |
| ISO: 評価できていない目標があっても、合算の SPFM/LFM が緑 | `HW_METRICS_MISSING` があれば合算バッジも黄色 | ConceptView |
| ISO: DC を貸す機構の ASIL が目標より低くても通る | 機構の ASIL（分解の元 ASIL を含む）が関係する目標の最大の ASIL 未満なら `HW_DC_MECHANISM_BELOW_GOAL`（エラー） | safety-core/test |
| ISO: HW の `rationale` が 8 文字以上かどうかだけ | 分解の独立性の根拠と同じ形式検査 | 同上 |
| ISO: `isSubstantial` の誤検出（`depending`、`sampled`、`仮想化`、`todos`）と穴（`in-progress`、`to follow`、`TO BE DEFINED`、`not applicable`、`作業中`） | 英単語は語境界で判定、日本語は個別に修正。穴の語を追加 | safety-core/test |
| ISO: 意図機能の ASIL 付け替えを検出する検査が無い | 静的検査では矛盾にならない（付け替えと ASIL 低下が一貫している）。**変更の検出で扱う**ことを `tool-qualification.md` に明記（差分・承認時の確認・監査） | docs |
| ISO: `safety-notes.md`・`tool-qualification.md` が追従していない | 更新。検査が「通してしまう」領域の一覧を追加 | docs |
| **MBSE N11: トップレベルに 1 要素を足すだけで全 ID が入れ替わる（N8 の修正による退行）** | 名前の無い根の `Namespace` はラベルを持たない | 統合テスト（トップレベル編集で 90% 超が不変） |
| **MBSE N12: コメントに「SCDL」「[RFC]」と書くだけでライブラリが混入する** | 判定をコメント・文字列を除いたテキストで行い、`SCDL::` / `import SCDL` / `@Scdl` の構文に限る | 統合テスト |
| **品質: 5 分間の再解析抑止が同時要求に効かない** | 同じモデルの同時要求を 1 回の解析にまとめる（全員に同じ結果） | fake-processes.test.ts |
| 品質: viewer が共有 JVM を長く占有できる | `POST /analyze` の利用者ごとの同時実行を、読み取り専用 1・編集者 2 に制限（429）。読み取り専用で、保存済みと異なる 200KB 超のモデルは 413 | api.test.ts |
| **品質: SIGTERM が速く終わらない（切り離したプロセスの exit が無視され、進行中の要求が拒否されない）** | `close()` が進行中の要求を拒否する | fake-processes.test.ts（3 秒未満） |
| 品質: `operations.md`・`security.md` が追従していない | 解析の資源制御、可用性の限界を追記 | docs |

## 未対応（報告に残す）
- `variation part def` の `variant` が同時に存在する部品として導出され、警告がない（N13）。無名 `allocate` の警告文言。`verify`/`derive` の無警告の脱落。再定義と定義内 `satisfy`（N7b）。
- viewer の画面の追加ボタンが有効のまま（押すと拒否される）。`h1` が無い。CI の煙試験は health と一覧のみ。
- テストが `/tmp/fusamod-*` を残すことがある。
- 取り込み、PMHF、7 ステップ、FMEA-MSR の集計。実ランナーでの CI、Docker のビルドは未実施。AP 表は非公式のおもちゃ。故障率は利用者の入力。
