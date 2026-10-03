# ラウンド 6 レビュー: ISO 26262 / AIAG-VDA 機能安全専門家(模擬)

- 対象: /home/user/FuSaMod(HEAD e88265d。ソースは変更していない。探索用に置いた一時スクリプトは削除済み)
- 立場: 独立・厳格な機能安全の専門家(シミュレーション。認証機関ではない)
- 方法: ルーブリックに従う。`pnpm -r test` は全件成功(safety-core 130、sysml-graph 37、scdl 50、analysis 55、web 20、ai 31、server 68 + 7 skip〈Java 結合〉)。応答書は信用せず、`node --import tsx` のスクリプト 4 本(実 API の `harness()`、デモのコピー、スタブ AI プロバイダで任意の操作列を適用)で、変異 約 75 件を `PUT /safety`・`POST /analyze` 相当・AI 適用・履歴の復元に対して実行し、`riskChanges` の分類と `analyzeProject` の指摘を比較した。

## 総括

| 項目 | 採点 | 外部確認待ち減点 | 合否点 | 80 点以上か | 判定 |
|---|---|---|---|---|---|
| A1 機能要件(安全分析の観点) | **82** | 5 | 87 | はい | **不合格** |
| B1 機能適合性・正しさ | **87** | 3 | 90 | はい | **合格(境界)** |
| C1 ISO 26262 専門家 | **84** | 8 | 92 | はい | **合格** |

不正確な ASIL の決定・継承(-20 の対象)は見つからなかった。ラウンド 5 の主要な指摘(AI 経由のデコンポジションが素通り、80 通りの虚偽、来歴の追記・復元での消失、FTTI の未照合、QM 意図機能が警告止まり、プレースホルダ)は、**実行で多くが修正を確認した**。一方、**今回の探索で、修正を迂回する経路が複数見つかった**(下記 R6-1〜R6-8)。いずれも「ダミーの要求を 1 件足す」「要求 ID を外す」程度の操作で、エラー 0 のまま ASIL D の機能が QM 扱いになる、または FTTI の照合が無効になる。B1 は境界、A1 は 7 ステップ・SPFM/LFM/PMHF・MSR の集計の欠落が不変のため不合格のまま。

## ラウンド 5 指摘の検証結果

| # | ラウンド 5 の指摘 | 判定 | 実行での確認 |
|---|---|---|---|
| R5-1 | ASIL を下げる分解の追加が AI の確認対象外 | **修正を確認** | `addSafetyRequirement` 2 件 + `addDecomposition` の提案は 409(`DX.分解(追加): 未設定 → FSR-2`)。確認すると適用され、`aiChanges.changes` に `lowersRisk: true` と `confirmedRiskLowering` が残る。 |
| R5-2 | 統制記述を空文字で上書き | **一部修正** | `detectionControl: ""` は 409。ただし判定は「新しい長さが元の半分未満」のみ。**元と同じ長さの `n/a n/a …` への置換、元の半分の長さへの短縮は `changes: []` で確認なしで通る**(実行確認)。 |
| R5-3 | 警告の解消・未評価→評価・機構の追加が関門外 | **一部修正 / 主要部は未修正** | 未評価に良い評価(O/D≤3、S≤5)は `good` で flag される。**ASIL D・`coversFailureIds` 付きの `addMechanism` + `addPair` は 200・`changes` に `asil(追加)` が非リスク低下で載るだけ**(実行確認)。保護の主張を足す変更が確認対象外。 |
| R5-4 | 人手の編集に差分・変更管理なし | **一部修正** | `PUT /safety` は `safety.diff` を監査ログに記録(`lowersRisk` 件数つき。実行確認)。ただし (a) 確認・理由の必須化はなし、(b) **`POST /history/:rev/restore` は `safety.diff` を出さず**、リスクの低い版への復元は `project.restore {from, revision}` の 1 行のみ(実行確認)、(c) **分類外の編集は差分にも出ない**(R6-1)。 |
| R5-5 | 来歴の追記・復元での消失 | **修正を確認(一部残り)** | `PUT` での追記は 422、復元は現在の `aiChanges` を引き継ぐ(`restore` 後 1 件を確認、テスト実在)。残り: 500 件超で古い来歴を黙って捨てる(`slice(-500)`)、`changes` は 50 件打ち切り、追加された要求・分解の ID は `changes` に残らない場合がある。 |
| R5-6 | UC2「全 80 通り」の虚偽 | **修正を確認** | `hara-fta.test.ts` が S0〜3 × E0〜4 × C0〜3 = 80 通りを列挙し `n === 80` を検証。**テスト内の表を ISO 26262-3 Table 4 と照合した結果、S1〜S3 × E1〜E4 × C1〜C3 の 36 セルすべて正しい**(S1/E4/C3=B、S2/E4/C3=C、S3/E4/C3=D、S3/E1/C3=A 等)。0 を含む組は QM(実装・表とも一致)。ただし「表の書き写し」は実装者自身が行ったもので、独立した出典の写しではない(軽微)。 |
| R5-7 | 機構 FTTI と目標 FTTI の未照合 | **一部修正(迂回可能)** | `MECH_FTTI_EXCEEDS_GOAL` は SM-1 の FTTI を 5000 にするとエラーになる(実行確認)。**しかし照合は機構の `requirementIds` → 要求 → 目標の経路のみ。`requirementIds` を空にして FTTI を 5000 にすると、エラー 0・新規指摘 0**(実行確認)。ペア → 意図機能 → 要求の経路は見ない。 |
| R5-8 | AP 表の健全性 | **未修正(今回は主張なし)** | 全規則を `L` に差し替えても指摘ゼロ・差分ゼロ(実行確認)。 |
| R4-1 残り | QM 意図機能が警告止まり | **一部修正(迂回可能)** | ASIL 付き目標があれば、紐づく要求の無い QM 意図機能は `ELEMENT_QM_UNLINKED` エラー(実行確認)。**しかし QM の要求(目標・親なし)を 1 件足して `requirementIds` に入れると、エラー 0・警告 3(`TRACE_UNCOVERED` のみ)**。安全機構は QM・紐づけなしでも警告止まり。 |
| R3-4 | プレースホルダ根拠 | **一部修正** | `pending review` は警告になった。**`see doc 12 later`、`1 2 3 4 5 6 7 8 9`、`asdf 1234 qwer`、`なし 0123 いいえ`、`DFA-PT-002 draft`、`DFA-1 (not done)`、`DFA-1 none`、`DFA-1 WIP`、`DFA-9999 (to be written)` は警告ゼロ**(実行確認)。逆に `仮想 ECU の DFA-001 参照` は誤検出(「仮」)。ブラックリスト方式の限界。 |
| 依頼 | DC 弱いテスト、plan.md の MSR | **plan.md は修正を確認 / テストは未修正** | plan.md は「一部」に訂正済み。`analyze.test.ts:322` の `l ? … : true` は残る。 |

## 敵対的探索の結果(今回の新規または残存)

### R6-1 `riskChanges` の分類は網羅的でない(高。監査・確認の穴)
`PUT /safety` および AI 適用の差分は、重大度・O/D・管理策の記述・HARA の S/E/C・目標 ASIL/FTTI・FTA 確率・機構 FTTI・追加(QM)・削除・分解の追加だけを見る。次の編集は**差分ゼロ(`rc=0`)**、かつ新規指摘も**ゼロ**で、200 で保存された(実行確認):
- **フォールトツリーの構造変更**: OR ゲートを AND に変更(`G-CTRL`)、監視ゲートの入力を重複に差し替え、基本事象の `failureId` を別の故障に付け替え(確率を下げうる)。ゲートの入力削除は `FT_UNREACHABLE` 警告のみで差分なし。
- **AP 表**: 全規則を `L` に差し替え、`apTableSource` を公式名に変更。
- **安全機構の主張**: `diagnosticCoverage` を `medium → high`(`MECH_DC_D_MISMATCH` 警告は出うるが差分なし)、`coversFailureIds` の追加・差し替え(件数が減る方向だけを `lowersRisk` にしており、**意味が逆**。保護の主張が増える方が残存リスクを下げる主張)、ASIL D の機構の追加。
- 分解の `independenceEvidence` の書き換え、ペアの `independence` 変更、安全目標の文言、ハザード事象の `safetyGoalId` の付け替え(後者は `GOAL_ASIL_MISMATCH` のエラーが出る場合のみ)、`levelOverrides`。
- 重大度・O/D・FTA 確率を**削除(undefined)**する編集は、差分は出るが `lowersRisk: false`(`MISSING_*` 警告は出る)。
- 要求・意図機能・機構の既存要素の ASIL を下げる編集は差分に出ず、解析の指摘(`REQ_BELOW_GOAL_ASIL` 等)だけが頼り。AI 経路は新規エラーで止まるが、`PUT` は止まらない。
結論: 文書は「人の保存の差分は監査ログに残る」と書くが、**残らない種類のリスク低下が多い**。アセッサは「安全関連の成果物の変更が漏れなく記録される」ことを求める。

### R6-2 意図機能・安全機構の ASIL 検査は、ダミーの QM 要求で迂回できる(高)
`validateElementAsil` は「紐づく要求が 0 件」のときだけ `ELEMENT_QM_UNLINKED` を出す。IF-1 を `asil: QM`、`originAsil` 削除、QM の要求 `QR`(親・目標なし)を `requirementIds` に追加すると、**ASIL D の目標に紐づく意図機能がエラー 0 で QM になる**(実行確認)。意図機能の `elementId` が割り当て先の要求(`allocatedTo`)と整合するかも検査しない(FSR-1a の割り当てを別要素に変えても指摘ゼロ)。安全機構は ASIL の付いた目標があっても QM・紐づけなしで警告のみ。これはラウンド 4・5 で指摘した抜けの本質(要求側の検査を別成果物の ASIL で迂回できる)が、形を変えて残っている。
### R6-3 FTTI 照合が機構の `requirementIds` 経由に限られる(中〜高)
上記のとおり、`requirementIds` を空にすれば FTTI 5000 ms(目標は 100 ms)でもエラー 0。機構 → ペア → 意図機能 → 要求 → 目標の経路や、`coversFailureIds` の故障 → 事象の経路は見ない。`MISSING_FTTI` の警告があるだけ。
### R6-4 履歴の復元が差分・確認の対象外(中)
復元は任意の過去版に戻せ、リスクの低い版(重大度 1 など)に戻しても、`safety.diff` が出ず、確認も要らない。`restore` の前後で `riskChanges` を計算して監査ログに出す変更は小さい(技術的に容易)。
### R6-5 AI 適用の残存(中)
R5-2・R5-3 の主要部(上表)に加え、`addFailure`(severity 1)・`addSafetyGoal`(QM)・`addHazardEvent`(S1E1C1 を既存目標へ)は 200 で `changes: []`。これらは警告(`NO_CAUSE`、`GOAL_NO_EVENT`、`EVENT_NO_RATIONALE`)が付くだけで、リスクを下げる意図の入れ方次第(例: 既存目標に S1E1C1 を足しても `GOAL_ASIL_MISMATCH` が出るかは構成依存)。実害は限定的。
### R6-6 空の安全データ(中)
HARA・要求・機構・ペア・意図機能・FTA・故障・リンクを全削除し、信号フローも空にすると、エラー 0(信号フロー参照が残る場合のみエラー)。`GOAL_NO_*` ではなく「安全分析が空である」ことを示す指摘が無い。削除は `lowersRisk` として差分に出るが、確認は求められない。
### R6-7 FTA の完全性(維持と残存)
FTA の循環・未知・空ゲート・打ち切りは維持(テスト成功)。FTA をすべて削除しても指摘ゼロ(差分のみ)。FTA と目標・FTTI・安全機構の連携なし。`ftTopOnly`(基本事象の削除)は `UNKNOWN_REF` エラーで検出される。
### R6-8 前回修正の維持(退行なし)
- 分解先の子孫に `QM(D)`(Q9): `REQ_ASIL_DOWNGRADE`。
- 分解の循環(FSR-1a → FSR-1 + FSR-1b): `DECOMP_CYCLE`、再利用・導出違反も検出。
- `GOAL_NO_FSR`(目標の要求の `safetyGoalId` を外す): エラー。
- 要求の ASIL を D → QM(FSR-1): `REQ_BELOW_GOAL_ASIL`・`DECOMP_INVALID`・`DECOMP_ORIGIN` を検出。
- 意図機能の ASIL を A(元 B(D)): `ELEMENT_ASIL_BELOW_REQ`。
- サーバーの `aiChanges` 保護、役割別アクセスは維持。

## 文書の主張の検証
| 文書 | 結果 |
|---|---|
| tool-qualification.md UC2「全 80 通り」 | **事実になった**(上記。表の独立した出典照合は人の確認が要る)。 |
| tool-qualification.md UC5「リスクを下げる変更の確認」、UC3「負テストで TD を主張」 | 過大。確認の対象は R6-1・R6-5 の範囲外を含まない一部の分類のみ。UC1 の「履歴・監査ログ」も、復元の差分が無い(R6-4)。 |
| safety-notes.md 「検出する」の意図機能の行 | 「要求に紐づかない QM」はエラー/警告と正確に書かれるが、**ダミーの QM 要求で迂回できる**ことは書かれていない。 |
| safety-notes.md 「AI の提案が…確認を求める」 | 範囲は「重大度・発生度・検出度の低下、QM の追加」だが、実装は分解・HARA・FTTI・確率・削除・管理策の記述も含む(控えめで過小記載)。一方、機構の主張(DC・カバー対象・ASIL 付き機構の追加)は含まれない。 |
| safety-notes.md 「人の保存の差分は監査ログに残る」 | 部分的に偽。FT 構造・AP 表・DC・分解の根拠・復元は残らない(R6-1、R6-4)。「検出しない」にも書かれていない。 |
| negative-tests.md | 追加の行(`MECH_FTTI_EXCEEDS_GOAL`、`ELEMENT_QM_UNLINKED` エラー化、分解の AI 確認、`aiChanges` の復元)が一覧に無い。テスト欄が節名でしか示されない行が残る。既存の行の対応テストは実在。 |
| plan.md | 修正済み。 |

## ISO 26262-8(ツール認定)と実装の欠陥の区別
**実装の欠陥(コードで直せる)**: R6-1〜R6-6、プレースホルダ検査のブラックリスト方式、AP 表の健全性、DC の弱いテスト、500 件打ち切り。
**ツール認定でアセッサが今も受け入れない点**: (1) TI/TD/TCL の正式判定(提案のみ)、(2) 検証報告(版・日時・環境・結果の記録)が無い、(3) 負テスト一覧が実際の検出範囲と一致しない箇所(UC3/UC5 の主張)、(4) 変更管理・使用中の不具合記録の手順の未整備、(5) 出力側の免責の弱さ、(6) 来歴の信頼性(サーバー側の追記のみは評価できるが、`safety.json` 単体は署名なし)、(7) サンプルの HARA・FSR・FTA・分解・AP 表・独立性の根拠(DFA-PT-001 は架空)の妥当性は、実在の専門家による確認が必要。
**アセッサが実装面でも受け入れない点**: 7 ステップ、SPFM/LFM/PMHF、MSR 集計の欠落。意図機能・機構の ASIL がダミー要求で迂回できる(R6-2)。変更管理の記録が不完全(R6-1、R6-4)。FTTI 照合の迂回(R6-3)。FMEA の重大度と HARA の S の非照合。FTA が目標・FTTI と未連携。

## A1: 機能要件の充足度(安全分析の観点)— 82 点
根拠: HARA・ASIL 決定(80 通り検証)、継承、分解(循環・再利用・導出・配置)、ペア、FTA、FMEA ネット、AP、トレース、AI の提案→承認→差分つき来歴、人手の `safety.diff`、FTTI の整合、が通しで動く。デモはエラー 0・警告 2。
減点(合計 -18):
- FMEA の 7 ステップ未実装(-5)
- FMEA-MSR は参照・DC/D の経験則・FTTI のみ。集計なし(-3)
- SPFM / LFM / PMHF なし(-3)
- FTA が安全目標・FTTI・機構と未連携(-2)
- 変更管理の記録が不完全(R6-1、R6-4)(-2)
- 意図機能・機構の ASIL の検査が迂回できる(R6-2)(-1)
- 独立性の根拠が形式的(-1)
- 空の安全データ・AP 表の健全性(-1)
### 外部確認待ち減点: 5 点
- 誰が: 実在の ISO 26262 アセッサ/機能安全マネージャ、AIAG-VDA ハンドブックのライセンス保有者
- 何を: AP 表の正式値の投入と確認、サンプル安全分析(HARA / FSR / FTA / 分解)の妥当性、review-gates.md の G0〜G2 の実施記録。

## B1: 機能適合性・正しさ — 87 点
根拠: ASIL 決定表(独立して 36 セルを照合)、分解表、継承が正しい。R5 の主要な不具合を修正。不正確な ASIL 判定は見つからなかった(-20 なし)。
減点(合計 -13):
- ダミー QM 要求で意図機能の ASIL 検査を迂回できる。機構の QM・紐づけなしは警告のみ(-3)
- `riskChanges` の分類が不完全で、`coversFailureIds` の方向が逆、削除(undefined)の評価が非リスク低下(-3)
- FTTI 照合が `requirementIds` 経由のみ(-2)
- 空の安全データ・FMEA 重大度と HARA の S の非照合(-1)
- 独立性の根拠のブラックリスト方式(誤検出 1 件含む)(-1)
- 弱いテスト(DC)・AP 表の健全性・UI の最大 3 秒凍結(-2)
- `REQ_BELOW_GOAL_ASIL` の子孫の表記による誤検出に近い挙動の残り(-1)
### 外部確認待ち減点: 3 点
- 誰が: ISO 26262 専門家(独立レビュー)
- 何を: FMEA ネットの階層ルールと重大度継承方式の適合性(review-gates.md G0 論点 1・3)。

## C1: ISO 26262 専門家の観点 — 84 点
良い点: ラウンド 5 の指摘のうち、虚偽の主張(80 通り)の訂正と事実化、AI 経由の分解の確認、`aiChanges` の保護、FTTI 照合の導入、QM 意図機能のエラー化、プレースホルダ追加、`safety.diff` の導入が、実行で確認できた。「検出しない」を書く姿勢は維持。
減点(合計 -16):
- R6-2: 意図機能・機構の ASIL 検査の迂回(-3)
- R6-1・R6-4: 変更管理の記録の抜け(FT 構造、AP 表、DC、復元など)。文書の「差分は残る」が部分的に偽(-3)
- R6-3: FTTI 照合の迂回(-1)
- 分解の独立性が形式的(-2)
- 検証報告が無い。UC3/UC5 の主張が実態より強い(-2)
- 複数影響が最大値 1 つ。FTA の確率に潜在故障・被曝時間なし(-2)
- DC/D の閾値に出典なし。MSR の集計なし(-1)
- 来歴の 500 件・50 件の打ち切り(-1)
- AI の機構追加(保護の主張)の確認対象外(-1)
### 外部確認待ち減点: 8 点
- 誰が: (1) 組織の機能安全マネージャ/ISO 26262 アセッサ、(2) ツール認定担当
- 何を: ISO 26262-8 第 11 章のツール分類(TI/TD/TCL)の正式判定、検証報告の確認、サンプル安全コンセプトの妥当性、独立性ルール(DFA)の合意、AP 表の取り扱い方針、AI 提案の承認プロセスの運用。

## 優先順位つき修正リスト(ファイル単位)
1. **`packages/safety-core/src/asil.ts` `validateElementAsil`(R6-2)**: 意図機能・機構について、`elementId` に割り当てられた要求(`allocatedTo` が同じ要素)の最大 ASIL、および紐づく要求が最終的に帰属する安全目標の ASIL(`goalIdOfRequirement`)より低い場合を、要求 ID の有無にかかわらずエラーにする。ASIL 付き目標がある場合、QM の機構・QM 要求にしか紐づかない機能は `ELEMENT_QM_UNLINKED` を維持してエラー化。負テストを `review1.test.ts` に追加(ダミー QM 要求のケース)。
2. **`packages/ai/src/operations.ts` `riskChanges`(R6-1・R5-3)**: (a) FT のゲート種別・入力・`failureId`・`undeveloped` の変更、(b) `apTable`・`apTableSource`、(c) 機構の `diagnosticCoverage` の向上、`coversFailureIds` の増加(`now > was` を lowersRisk に。減少は逆)、ASIL 付き機構の追加、(d) 既存の要求・意図機能・機構の ASIL の低下、(e) 分解の根拠・ペアの独立性の変更、(f) 評価値・確率の削除(`to === undefined`)を、差分に出し `lowersRisk` とする。`d.text` は、長さではなく内容の変化(空・プレースホルダ化)を見る。`apps/server/test/api.test.ts`・`packages/ai/test/ai.test.ts` に各ケース。
3. **`apps/server/src/projects.ts` `restore` / `app.ts`(R6-4)**: 復元の前後で `riskChanges` を計算し、`safety.diff` を監査ログに記録。リスク低下を含む復元には確認フラグを要求するか、少なくとも件数を明示。
4. **`packages/analysis/src/analyze.ts` `mechanismFttiIssues`(R6-3)**: `requirementIds` が無い機構でも、ペア経由の意図機能の要求の目標、または `coversFailureIds` の故障から辿れる目標の FTTI と照合する。目標に辿れない機構にも警告。
5. **`packages/safety-core/src/asil.ts` `isSubstantial`(R3-4)**: ブラックリストに `draft`・`wip`・`none`・`later`・`see `・`not done`・`to be`・`なし` 等を追加し、「仮」の誤検出を直す(`仮想` を除外)。連番・ランダム文字列には、文書 ID パターン(`[A-Z]{2,}-[A-Z0-9-]+`)の必須化を検討。
6. **`packages/analysis/src/analyze.ts` / `packages/safety-core`(R6-6・R5-8)**: ASIL 付きの目標・事象・FMEA が 0 件の場合の警告。`compileApTable` に最低限の健全性(S≥9 かつ O または D が高い行は H 以上)を追加し、出典の自由記述だけで `apStatus: declared` にしない。
7. **`docs/safety-notes.md`・`docs/quality/tool-qualification.md`・`docs/quality/evidence/negative-tests.md`**: 「人の保存の差分」の範囲を実態に合わせて限定し、「検出しない」に R6-1〜R6-6 を追記。UC3/UC5 の主張を実態に合わせる。負テスト一覧に、新規の検出コード・AI の分解確認・`aiChanges` の復元・FTTI を追加し、テスト欄は `it` の文言で特定する。検証報告(版・日時・環境・結果)を自動生成して置く。
8. **`packages/analysis/test/analyze.test.ts:322`**: `l ? … : true` を `expect(l).toBeDefined()` + 検査に直す。
9. その後: 7 ステップ、SPFM/LFM/PMHF、FMEA-MSR の集計、FTA と目標・FTTI・機構の連携、`aiChanges` の 500 件上限の廃止(または監査ログへの退避)。

## 判定
**C1 は合否点 92(採点 84 + 外部確認待ち 8)で合格、B1 は 90(採点 87 + 3)で境界合格、A1 は 87(採点 82 + 5)で不合格**。C1 の合格は R6-2・R6-1 が残ることを踏まえた境界に近い評価である。A1 は、7 ステップ、SPFM/LFM/PMHF、MSR の集計のうち少なくとも一つの実装と、修正リストの 1〜4 が必要。B1 は、修正リスト 1〜4 を行わないと、同種の迂回が 1 件見つかるだけで 90 を割る。
