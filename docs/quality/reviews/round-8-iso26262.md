# ラウンド 8 レビュー: ISO 26262 / AIAG-VDA 機能安全専門家(模擬)

- 対象: /home/user/FuSaMod(HEAD 61439b1)。立場は独立・厳格な機能安全の専門家(シミュレーション。認証機関ではない)。
- 方法: ルーブリックに従う。応答書(round-7-response.md)は信用せず、実コード(`analyzeProject` / `riskChanges` / `validateHwModes` をデモの `safety.json` + `model.graph.json` に対して直接呼ぶ約 80 件の変異)と、実 API(`harness()` = デモの一時コピー + Fastify `inject` の `PUT /safety` と監査ログ)で再現した。探索用スクリプトはスクラッチ領域(`/tmp/claude-0/-home-user-FuSaMod/c46c28cb-baae-5325-9355-932608ed5ee4/scratchpad/r8/iso/`)だけに置き、リポジトリは変更していない(`git status` は clean)。
- 実行結果: `pnpm typecheck` 成功、`pnpm lint` 成功、`pnpm -r test` 全件成功(safety-core 144、sysml-graph 44、scdl 50、analysis 64、web 20、ai 40、server 78 + 11 skip)。`pnpm build` / `pnpm e2e` / Java 結合 / `sysml-check` は今回実行していない(未検証。下記の採点では、検証済みとして扱っていない)。

## 採点サマリー

| 項目 | R7 採点 | R8 採点 | 外部確認待ち減点 | 合否点 | 判定 |
|---|---|---|---|---|---|
| A1 機能要件の充足度(安全分析の観点) | 84 | **86** | 5 | **91** | 合格 |
| B1 機能適合性(正しさ・完全性) | 85 | **86** | 3 | **89** | **不合格(1 点不足)** |
| C1 ISO 26262 専門家の観点 | 82 | **84** | 8 | **92** | 合格 |

- 3 項目とも採点そのもの(外部確認待ち減点を足す前)は 80 以上。
- **不正確な ASIL の決定・継承(-20 の対象)は見つからなかった。** HARA の Table 4(S+E+C の合計規則)、デコンポジション表、祖先/子孫への配置の検出、継承規則は、変異でも崩れなかった。
- 合否点が境界(89〜92)にあるのは、応答書が「直した」と書いた箇所のうち **1 件が実行すると嘘(差分が出ない)**、**1 件が部分的(欠落の指摘が「全体が空」の場合だけ)** で、HW メトリクスが依然として「黙って通る」経路を持つため。

---

## 1. 第 7 回の指摘の検証結果(実行で確認)

| # | 第 7 回の指摘と応答書の主張 | 判定 | 実行での確認 |
|---|---|---|---|
| 1 | HW 故障モードに `rationale` / `mechanismId` / `goalIds` | **修正を確認** | デモの HW-1〜3 に付与済み。`dcSpfRf` / `dcLatent` を主張して `mechanismId` が無ければ `HW_DC_NO_MECHANISM`(警告)、根拠が 8 文字未満なら `HW_NO_RATIONALE`(警告)、未知の機構・目標・要素は `UNKNOWN_*`(エラー)、ID 重複は `DUP_ID`(エラー)。 |
| 2 | DC を機構の区分(low 60 / medium 90 / high 99 %)の上限で制限 | **修正を確認** | SM-1(medium)に対して HW-1 の `dcSpfRf` を 0.99 にすると `HW_DC_EXCEEDS_MECHANISM`(エラー)。機構を high にして 0.99 にするとエラーは消え `MECH_DC_D_MISMATCH` の警告のみ。`dcSpfRf: 1`(high 機構)は上限超過でエラー。`diagnosticCoverage` 未設定の機構は上限 0 で、DC の主張はエラー。 |
| 3 | 安全目標ごとの SPFM/LFM | **修正を確認(ただし下記 2.1 の穴あり)** | HW-A(SG-1、fit 1000、DC 0)を足すと `HW_SPFM_BELOW_TARGET@SG-1`(エラー)。デモ値は SPFM 99.35 %、LFM 90.59 %(手計算: 1 − 0.7/107、1 − 10/106.3 と一致)。ASIL A / QM の目標は対象外(正しい)。 |
| 4 | `HW_METRICS_MISSING` | **部分的** | `hardwareFailureModes` を削除または空にすると警告が出る(確認)。しかし、**「空」のときだけ**。安全目標単位の欠落、総故障率 0 は無指摘(2.1)。テストも空の場合だけ(`analyze.test.ts:418`)。 |
| 5 | `SAFETY_DATA_EMPTY` | **修正を確認** | ハザード・目標・故障ノードを空にすると警告。デモでは出ない。ただし警告止まり(パズルビューでは「要確認」)。 |
| 6 | `riskChanges`: HW 追加・FIT 増加・`safeFraction` 未設定→設定・独立性の変更・`requirementIds` の付け替え | **ほぼ修正。ただし「独立性の変更」は偽(2.2)** | HW の追加(DC/safe を主張するもの)、削除、`goalIds` を絞る、種別 single→multiple、`fit` の低下、高 DC(≥0.9)モードの `fit` 増加、`undefined`→値、機構の DC 向上、`requirementIds` を ASIL の低い目標の要求へ付け替え(`IF-1`・`SM-1` とも `lowersRisk`)は、すべて実行で `lowersRisk` を確認。 |
| 7 | `isSubstantial` の強化(`see doc 12 later`、`WIP`、`draft`、`none`、`同上`、`後述`) | **挙げられた語は修正。穴は残る** | `see doc 12 later`、`DFA-1 WIP`、`DFA-1 draft`、`DFA-1 none`、`なし 0123 いいえ`、`TBD-DFA` は `DECOMP_EVIDENCE_WEAK`。**通ってしまう例**: `DFA-1 n.a.`、`DFA-1 not available`、`DFA-1 in progress`、`DFA-1 open item`、`DFA-1 to follow`、`DFA 1 under review`、`DFA-1 TBA`、`DFA-1 not yet`、`DFA-1 未実施`、`1 2 3 4 5 6 7 8 9`、`abc def ghi jkl`、`asdf qwer zxcv uiop`(いずれも指摘ゼロ)。逆に正当な `仮想化分離 DFA-12 §3` と `none-of-the-above DFA-9` は誤って警告になる。語の列挙方式の限界(`docs/safety-notes.md` が「もっともらしい架空の文書番号は通る」と明記)。 |
| 8 | `docs/safety-notes.md` の訂正 | **修正を確認** | 「SPFM/LFM は算出するが PMHF は算出しない」「HW 節」に更新。矛盾は解消。ただし λS を分母から先に除く方式、認知(perceived)を扱わない点、サマリーが最大 ASIL 1 つで表示される点、ASIL B の目標値が標準では推奨である点は、依然として書かれていない。 |
| 9 | (第 7 回)意図機能の `requirementIds` を ASIL の低い目標の要求へ付け替える迂回 | **検出器は未修正。変更管理側だけで対応** | `validateElementAsil` は今も無言(エラー 0・警告 0)。`PUT /safety` は `safety.diff` の `lowersRisk` を監査ログに残すだけ(確認は求めない)。AI の適用では確認を求める。 |
| 10 | 弱いテスト `l ? … : true` | **修正を確認** | |

---

## 2. 新たに見つかった欠陥(再現手順つき)

### 2.1 HW メトリクスが「黙って通る」経路が残っている(沈黙の誤り。重要度: 高)

`validateHwModes` / `HW_METRICS_MISSING` は「故障モードが 1 件も無い」場合しか欠落を言わない。次の 3 つは、実際の入力でエラー 0・警告の増加なしを確認した。

1. **ASIL C の安全目標を足して、故障モードが SG-1 にしか紐づいていない**(プロジェクトのコピーで `hara.goals` に SG-3(C)、事象、FSR-3 を追加)。SG-3 に関係するモードが 0 件なので `spfm = undefined` となり、`checkTargets` は何も出さない。結果: エラー 0、警告は元の 3 件のまま。ASIL C の目標について HW 評価の証拠が無いのに、無指摘。
2. **全モードの `goalIds` を `["SG-2"]`(ASIL A)に付け替える**(`PUT /safety` で 200)。ASIL D の SG-1 にはモードが 0 件。エラー 0。画面のサマリーは「SPFM 99.35 %(目標 99 %)」と緑で出続ける(サマリーは全モード合算で、目標の ASIL は最大 1 つ)。差分は `goalIds` の `lowersRisk` として監査ログに残るが、解析は沈黙する。
3. **全モードの `fit` を 0、または `safeFraction` を 1 にする**。`totalFit = 0` で `spfm`/`lfm` は undefined、エラー 0、警告は増えない。画面の `HardwareMetrics` は `ng(undefined, …)` が false なので、**「SPFM —」「LFM —」が緑の `ok` バッジ**で表示される(`ConceptView.tsx:171-173`)。「未算出」が「合格」の色で出る。

関連: 全モード合算のサマリー(`hardwareSummary`)は安全目標ごとの判定と食い違いうる。実行例: HW-A(SG-1、1000 FIT、DC なし)+ HW-B/C(SG-2、巨大な FIT)では、サマリーは SPFM 99.9999 % / LFM 98.9 %(緑)なのに、`HW_SPFM_BELOW_TARGET@SG-1` のエラーが同時に存在する。画面には「安全目標ごとの判定は『問題』タブ」と小さく書いてあるが、緑のバッジが誤読を誘う。

### 2.2 `riskChanges` のテキスト差分が実質的に死んでいる(応答書の主張が偽。重要度: 高)

`differ().text()` は `push(id, field, from ? "(記述あり)" : undefined, to ? "(記述あり)" : undefined, …)` を呼ぶ。`push` は `from !== to` のときだけ記録するので、**「記述あり → 記述あり」の変更は両方 "(記述あり)" で等しくなり、差分に出ない**(「半分以下に短縮したらリスク低下」の分岐は到達不能)。実行結果(いずれも `riskChanges` = `NO DIFF`):

- 分解の `independenceEvidence` を「DFA-PT-001(独立電源・独立クロック・別マイコン)」から `x`、または別の文書番号に書き換える
- ペアの `independence` を `ok` に書き換える
- `mechanisms[].safeState`、HARA の `rationale`、安全目標の `safeState`、FMEA リンクの `detectionControl` / `preventionControl` を `x` に短縮する

API でも確認した(`PUT /safety` で独立性の根拠を `DFA-PT-001 pending / in progress` に変更 → 200。`DECOMP_EVIDENCE_WEAK` が出るのは語が引っかかったためで、監査ログに `safety.diff` は**記録されない**)。応答書は「ペアの `independence`・分解の `independenceEvidence` の変更も差分に出す」と主張するが、**空にする場合だけ**成立する。`packages/ai/test/ai.test.ts:208` のテストも `independence = ""` のケースだけで、この穴を捕まえていない。ISO 26262-8 の観点では、独立性の根拠の差し替えは分解の妥当性に直結する変更であり、変更管理から抜けているのは重い。AI の適用でも同じ(AI が書き換えるのは `add*` / `set*` のみなので、これらの文字列を直接書き換える提案はそもそも作れない点だけが救い)。

### 2.3 HW の DC の貸し出し元の検査が緩い(重要度: 中)

- QM で、ペアにならず、FTTI も無い新規の安全機構(`SM-9`、`diagnosticCoverage: high`)を作り、HW-1 の `mechanismId` に指定して `dcSpfRf: 0.99` と根拠を付ける → エラー 0。出るのは `MECHANISM_UNPAIRED`、`MISSING_FTTI`、`ELEMENT_QM_UNLINKED`(安全機構は警告)だけ。ASIL D の SPFM に対して、QM の機構が 99 % の DC を貸している。
- 機構の `coversFailureIds` を空にして(`MECH_NO_COVERAGE` の警告のみ)、HW の DC は 0.99 のまま通る。HW 故障モードの `elementId` と機構の `elementId` / `coversFailureIds` は照合されない。

### 2.4 意図機能・安全機構の ASIL 付け替えを `validateElementAsil` が見ない(第 7 回の残り。重要度: 中)

再現: 安全要求 `FSR-X`(ASIL A、`safetyGoalId: SG-2`、割り当て先は IF-1 と同じ要素)を足し、IF-1 の `requirementIds` を `["FSR-X"]`、`asil: "A"`、`originAsil` なしにする。エラー 0・警告の増加なし(`SM-1` でも同じ)。デモでは SM-1 が ASIL D の目標を守る監視機構なのに、ASIL A として通る。差分は `lowersRisk` の 2 件として監査ログに残る(今回の改善)が、人の保存は確認を求めない。要素に割り当てられた要求(`allocatedTo` が一致するもの)の最大 ASIL との照合があれば検出できる。

### 2.5 その他

- 総合表示の誤読: 2.1 の緑バッジ。
- `isSubstantial` の語の列挙の限界(1 の 7)。誤検出(`仮`、`sample` を含む正当な文字列)もある。
- `HW_TARGETS` の ASIL B(90/60 %)は、標準では目標値が推奨(組織の判断)の位置づけだが、出力にその注記が無い(第 7 回から変化なし)。
- 変更管理の `fit` の増加は、DC ≥ 0.9 のモードだけ `lowersRisk`(恣意的な閾値。前後の SPFM/LFM を比べるのが本来の判定)。
- FMEA の 7 ステップ、FMEA-MSR の集計、PMHF、FTA と目標・FTTI・機構の連携は未実装のまま(文書化済み)。

---

## 3. 領域別の確認結果

| 領域 | 結果 |
|---|---|
| HARA の ASIL 判定(Table 4) | 実装は S+E+C の合計規則(10=D、9=C、8=B、7=A)で、私が知る Table 4 と一致。S/E/C=0 は QM。範囲外は例外/`HARA_RANGE`。事象と目標の ASIL の不一致は双方向でエラー。HE-1 の C を 2 に下げて目標を C に付け替えると差分は両方 `lowersRisk`、解析は整合。誤判定なし。 |
| デコンポジション(ISO 26262-9) | D→D+QM / C+A / B+B、C→C+QM / B+A、B→B+QM / A+A、A→A+QM。B+A への D の分解は `DECOMP_INVALID`。元 ASIL の不一致、孤立した `A(D)`、分解を消した状態(エラー 5)、祖先/子孫への配置(`DECOMP_NOT_INDEPENDENT`)、未配置(エラー)を実行で確認。分解先が両方とも未配置でもエラーになる(良い)。 |
| FTA | 最小カットセット(MOCUS + 吸収)、循環・未知ノード・打ち切りを「不完全」と扱う設計。確率は Esary-Proschan の上限で、未展開の事象があれば出さない。デモの FT-1 は AND(制御系 OR、監視)。構造の変更は `riskChanges`(OR→AND、入力削除、`top` 変更)で `lowersRisk`。AND→OR は正しく非リスク低下。FTA と目標・FTTI・機構の連携は無い(文書化済み)。 |
| SPFM / LFM(ISO 26262-5) | 式の形は正しい(第 7 回と同じ)。保守側の簡略化(λS を分母から除く、認知を扱わない)は文書の HW 節に書かれていない。目標値は B/C/D とも正しい。 |
| AIAG-VDA の AP / ネット | AP 表の網羅・重複・単調性の検査、非公式表の警告・画面表示は維持。全 L 化は `H の件数` の差分で `lowersRisk`。FMEA の重大度と HARA の S の非照合は文書化済み。 |
| AI の扱い(ISO 26262-8 の観点) | 提案→承認、新規エラーが増える提案は適用しない、リスク低下は確認が必須(409)、`aiChanges` はサーバー専用。この範囲は第 7 回から維持。AI は HW 故障モードを作れない(操作に含まれない)ので、HW 側の AI 経路の迂回は無い。 |
| ツール信頼性 | 文書(`tool-qualification.md` UC3 の「負テストで TD を主張」)は、上記 2.1〜2.4 の通ってしまう領域が負テスト一覧に無いため、今も過大。検証報告(版・日時・環境・結果)の自動生成は無い。 |

---

## 4. 採点

### A1: 機能要件の充足度(安全分析の観点) — 86 点(R7: 84)
- 根拠: HARA〜ASIL〜分解〜FTA〜FMEA ネット〜トレース、HW の SPFM/LFM が安全目標ごと・DC の区分上限つきで通しで動く。第 7 回の高優先の指摘(rationale / mechanismId / goalIds、DC 上限、`HW_METRICS_MISSING`(空の場合)、`SAFETY_DATA_EMPTY`、riskChanges の HW 拡張)を実行で確認した。
- 減点(-14): 7 ステップ未実装(-5)、FMEA-MSR 集計・PMHF なし(-3)、HW の欠落が目標単位・総故障率 0 で無指摘(-2)、FTA と目標・FTTI・機構が未連携(-2)、独立性の根拠・テキスト変更の変更管理が実質無効(-1)、意図機能の付け替えが検出されない(-1)。
- 次に直す点(優先順): ① 目標ごとの HW 欠落の指摘(`spfm`/`lfm` が undefined で ASIL B 以上ならエラー/警告、画面は赤/黄) ② `text()` の修正 ③ 付け替えの検出 ④ 7 ステップ・MSR。
- 外部確認待ち減点: **5 点**。誰が: 実在の ISO 26262 アセッサ/機能安全マネージャ、AIAG-VDA ハンドブックのライセンス保有者。何を: AP 表の正式値、サンプル安全分析(HARA / FSR / FTA / 分解)と HW 故障率・DC の妥当性、`review-gates.md` の G0〜G2 の実施記録。
- **合否点 91(合格)**

### B1: 機能適合性(正しさ・完全性) — 86 点(R7: 85)
- 根拠: ASIL 判定・分解表・継承・SPFM/LFM の算術は正しい。ASIL の誤判定は見つからなかった。
- 減点(-14): `riskChanges` のテキスト差分が死んでいる(応答書の「独立性の変更も差分に出す」が偽)(-4)、HW の欠落・目標単位の未評価・total = 0 が無指摘で、画面は「—」を緑で表示(-3)、DC の貸し出し元(QM/未ペア機構、`coversFailureIds` 空)の未照合(-2)、`validateElementAsil` が付け替えを見ない(-2)、`isSubstantial` の語の列挙の穴と誤検出(-1)、サマリーの合算表示が目標ごとの判定と食い違う(-1)、`fit` 増加の閾値が恣意的(-1)。
- 次に直す点(優先順): ① `text()` を「内容のハッシュ/長さの変化」で記録(独立性・rationale・safeState・管理策は変更ごとに差分、弱める方向は `lowersRisk`)し、負テストを追加 ② 目標単位の HW 欠落と、サマリーの目標ごとの表示(未算出は警告色) ③ DC を貸す機構の ASIL(目標以上)・ペア・`coversFailureIds` との照合 ④ `validateElementAsil` への割り当て先要求の照合 ⑤ 独立性の根拠を「文書 ID 形式(`[A-Z]{2,}-[A-Z0-9-]+`)の存在」を必須にする。
- 外部確認待ち減点: **3 点**。誰が: ISO 26262 専門家(独立レビュー)。何を: FMEA ネットの階層ルールと重大度継承の適合、HW メトリクスの定義(λS の扱い、認知、SPF/RF の内訳)の標準適合。
- **合否点 89(不合格。1 点不足)**

### C1: ISO 26262 専門家の観点 — 84 点(R7: 82)
- 良い点: 第 7 回の指摘に実コードで応えた箇所が多い(HW の根拠・機構・目標、DC の区分上限、目標ごとの評価、`riskChanges` の HW 拡張、文書の訂正)。限界を文書に正直に書く姿勢は維持。ASIL の誤判定・誤継承は無い。
- 減点(-16): 2.1〜2.2 の沈黙(目標単位の欠落・total = 0・独立性の変更)(-5)、DC の貸し出し元の未照合(-2)、付け替えの検出なし(-2)、独立性の根拠の形式検査の穴(-2)、検証報告なし・UC3/UC5 の主張が実態より強い(-2)、PMHF・潜在故障の診断間隔・被曝時間なし(-1)、応答書の記述と実態のずれ(1 件)(-1)、文書に HW の簡略化(λS・認知・最大 ASIL)の記載なし(-1)。
- 次に直す点: B1 の ①〜⑤ に加えて、`tool-qualification.md` の UC3/UC5 を弱め、負テスト一覧に「通ってしまう領域」を追記し、検証報告を自動生成する。
- 外部確認待ち減点: **8 点**。誰が: (1) 組織の機能安全マネージャ/ISO 26262 アセッサ、(2) ツール認定担当。何を: ISO 26262-8 第 11 章のツール分類(TI/TD/TCL)の正式判定、検証報告の確認、サンプル安全コンセプトと HW 故障率の妥当性、独立性ルール(DFA)の合意、AP 表の取り扱い方針、AI 提案の承認プロセスの運用。
- **合否点 92(合格)**

---

## 5. 判定
- A1 91、C1 92 は合格。**B1 は 89 で 1 点不足(不合格)**。採点そのものは 3 項目とも 80 以上で、-20 の対象は無い。
- 次のラウンドで B1 を通すには、上の「次に直す点」①〜④(`text()` の修正、目標単位の HW 欠落、DC の貸し出し元の照合、付け替えの検出)で足りる見込み。①は 3 行程度の修正で、最も費用対効果が高い。
- 外部確認待ち(合格時にも実施が必要): 上の各項目の「誰が・何を」を参照。
