# ラウンド 7 レビューへの対応

（レビュアーはシミュレートした専門家で、認証機関ではありません。）

第 7 回の合否点: ISO（A1 89 / B1 88 / C1 90）、MBSE（A1 89 / B3 85 / C2 89）、品質（A2 91 / B2 87 / B4 93 / B5 83 / B6 89 / B7 91 / B8 90）。

| 指摘 | 対応 | 証拠 |
|---|---|---|
| **捨てた JVM の exit イベントが、新しい JVM の状態を消す（孤児 JVM、生きた要求の失敗）** | `kill()` が先にプロセスを切り離し、`exit`/`error`/`stdin`/`stdout` の各ハンドラは `this.proc !== proc` なら何もしない | fake-processes.test.ts（タイムアウト後に 4 回呼び、起動された 2 つのうち生きているのは 1 つだけ） |
| 解析の待ちが無制限 | `maxQueue`（既定 8）を超えると `SysmlBusyError` → 429（`Retry-After`）。保存済みグラフへの切り替えもしない | 同上 |
| タイムアウトが 409 に化ける（CSV・報告書・`scdl.sysml`・AI）。504 の枝が死んでいた | 解析の失敗を `timeout / unavailable / busy` に分類し、全エクスポートと AI で 504 / 503 / 429、モデルの誤りだけが 409 | api.test.ts |
| 起動時の `sweepConvertTemp(0)` が共有 `/tmp` の他人の `fusamod-convert-*` を消す | 変換専用の利用者別ディレクトリ（`/tmp/fusamod-<uid>/convert`、0700）に限定 | convert.ts、統合テスト |
| **X1: 標準ライブラリ参照が名前のない Type / 解決できない href** | `convert.sh` が `ScalarValues.kerml` を変換器の追加入力に渡す（空白のない作業ディレクトリにコピー）。XMI の href は `ScalarValues.kermlx#<UUID>` | 統合テスト（XMI の href） |
| **X3: 単位式 `[kg]` で変換できない** | 単位系ライブラリを追加入力に渡す（単位を使うモデルは約 15 秒） | 統合テスト |
| **X5: `@Scdl*` を含むモデルの JSON が 422** | `SCDL.sysml` を追加入力に渡す。`all-stereotypes.sysml` が JSON/XMI とも変換できる | 統合テスト |
| **ID の安定化が不十分（2 回の出力が一致しない、小さな編集で関係要素の約 3 割が変わる）** | 関係要素の所有者に `owningRelatedElement`/`owningNamespace` を使い、名前のない関係要素は所有する要素・参照先の名前で区別する。X1 のスタブが消えたことでの入れ替わりも解消 | 統合テスト（2 回の出力がバイト単位で一致、編集後も 95% 以上の ID が不変） |
| **N7: `part def` が所有する requirement と、その中の `satisfy` がインスタンスに付かず、警告が事実と異なる** | 要求を使用ごとに複製し、暗黙の subject はその part、`by front` は同じインスタンスの `front` に付ける。使用側からの相対経路（`front.brake`）も解決。`SATISFY_NO_INSTANCE` は「定義を使う part が無い」ときだけ | sysml-graph/test/def-owned.test.ts（公式実装が出力したグラフ）、ADR-0008 |
| ADR-0009 の X1/X3/X4/X5/X6 が不正確 | 実測に合わせて書き換え | docs |
| **ISO: HW 故障モードの分類・DC の根拠が無い** | `rationale`・`mechanismId`・`goalIds` を追加。DC を主張して根拠・機構が無ければ警告、機構の区分（low 60 / medium 90 / high 99%）を超えればエラー | safety-core/test/hwmetrics.test.ts |
| ISO: 最大 ASIL 1 つでの評価 | 安全目標ごとに（`goalIds` で関係する故障モードを選び）目標値と比較 | 同上 |
| ISO: ASIL B 以上の目標があるのに故障モードが空でも黙る | `HW_METRICS_MISSING`（警告）。データが空なら `SAFETY_DATA_EMPTY`（警告） | analysis/test |
| ISO: `riskChanges` が HW の追加・高 DC モードの FIT 増加・`safeFraction` の未設定→設定・独立性の記述の変更を見落とす | リスク低下の主張として分類。ペアの `independence`・分解の `independenceEvidence` の変更も差分に出す | ai/test |
| ISO: 意図機能・安全機構を ASIL の低い目標の要求へ付け替える迂回 | `requirementIds` の付け替えで、たどれる目標の最大 ASIL が下がれば `lowersRisk` | ai/test |
| ISO: 独立性の根拠の検査の穴（`see doc 12 later`、`WIP`、`draft`、`none`、`同上`、`後述`） | 語を追加（英語は語境界で判定） | safety-core/test |
| ISO: `analyze.test.ts` の弱い試験（`l ? … : true`） | 前提の存在を明示的に検査し、重大度と対象を確認 | analysis/test |
| ISO: `docs/safety-notes.md` の古い記述（SPFM/LFM を「しない」） | 訂正し、HW 評価の範囲を書き直し | docs |
| 品質: ConceptView のバナーで表が潰れる | 縦に長い画面は縮めず、画面全体をスクロール | docs/quality/evidence/screenshots/05-concept.png |
| 品質: SCDL が大きすぎて画面に収まらない | 既定で幅に合わせ、「原寸で表示」に切り替え可能 | 06-scdl.png |
| 品質: HW 故障モードの入力 UI が無い | 「ハードウェア故障モードと故障率」表（指摘もその行に表示） | e2e |

## 未対応（報告に残す）
- PMHF、FMEA-MSR の集計、7 ステップ、FMEA の複数影響ごとの重大度。
- SysML v2 の `verify`/`derive`/`refine`、port・connection・allocation・state の導出。JSON/XMI/API の**取り込み**。SysML v2 API サーバーでの読み込み確認。
- `modelRef` は文字列のまま。SCDL の ID は名前ベースのため、先に同名の要素を足すと `#n` が動く（N4）。
- 間欠的な 422（背景負荷時に 28 件中 5 件。再現せず）。変換器の同時実行は 2 件まで。
- Docker イメージのビルド、実ランナーでの CI は未実施。AP 表は非公式のおもちゃ。故障率は利用者の入力。
