# ラウンド 3 レビュー: MBSE / SysML v2 専門家の観点(A1・B3・C2)

- 立場: 独立・厳格な MBSE / SysML v2 専門家(シミュレートしたレビュアー。認証機関ではない)
- 基準: `docs/quality/rubric.md`(証拠主義、未検証は減点、外部確認待ち減点は点数と別に最大 10 点)
- 対象リビジョン: `4bc0cf6`(ラウンド 2 への対応コミット)
- 方法(すべて実行。応答文書は鵜呑みにせず再検証):
  - `./tools/sysml-check/run.sh`: SCDL.sysml、examples 4 件、projects の model.sysml が公式実装 0.62.0 でエラー・警告ゼロ。
  - `pnpm -r test`: 全パッケージ合格(server の Java 結合 3 件のみ skip)。
  - 新規の敵対的モデル 3 本を公式抽出器(`SysmlExtract`)に通し、`deriveNet` / `analyzeProject` に流した(スクラッチパッド `.../scratchpad/m/` の `a1/a2/a3.sysml`。リポジトリ非変更)。
    - a1: ラウンド 2 と同じモデル(継承、同じ定義の複数インスタンス、`perform action x : Def`、入れ子 requirement、経路つき `satisfy`)を再実行。
    - a2: usage 側の再定義 `part :>> ax {...}`、特殊化 `part ax2 :> ax`、`ref part`、`satisfy x;`(by なし)、`part multi : Wheel, Axle`、`satisfy r by v.ax.w1`。
    - a3(新規): 日本語名・空白入りの引用符名(`'my car'`、`'a b'`)、配列多重度 `cells : Cell[4]`、定義内の `ref part`、定義内の入れ子 part の中の型付き usage(`part aux { part pack : Pack; }`)、
      同じ定義の別経路(`car1.pack` と `other.car1.pack`)、再定義した usage の中の追加 part への `satisfy`、特殊化したインスタンスへの `satisfy`(`sp.pack.bms`)、同じ要求への複数 `satisfy`、再帰する定義。
  - SCDL: `toScdl → exportSysml → 公式実装(PilotCheck)→ importSysml`、`exportSysml → 公式実装 → scdlFromGraph` の両経路、新属性 `modelRef`、根の追加での ID 安定性、種類をまたぐ ID 衝突。
  - `impactOfRequirementChange` の方向性を ev-powertrain 全要求と a1 の入れ子 requirement で確認。ADR-0007/0008/0009 をコードと突合。

---

## 総括

| 項目 | 採点 | 外部確認待ち減点 | 合否点 | 判定 |
|---|---|---|---|---|
| A1 機能要件(モデリング/トレーサビリティ/階層/SCDL の観点) | **85** | 5 | 90 | 合格(ぎりぎり) |
| B3 互換性・相互運用性 | **82** | 5 | 87 | 不合格(合否点 90 未満。採点は 80 以上) |
| C2 MBSE 専門家の観点 | **83** | 6 | 89 | 不合格(合否点 90 未満。採点は 80 以上) |

ラウンド 2 の最重要指摘(`satisfy` のインスタンス経路の喪失と誤紐づけ)は、**実測で確かに直った**。`satisfy r1 by car.front` は `car::front` のみ、
`fleet.c1.front.m1.rotor` は 1 要素のみ、`v.ax.w1` は `v::ax::w1` のみに紐づき、`v2`・`multi`・`dupA/B` への誤紐づけは消えた。曖昧・特定不能な場合は
`SATISFY_AMBIGUOUS` / `SATISFY_UNRESOLVED` で警告される。SCDL も、根の追加で ID が変わらず、`modelRef` が往復し、公式実装の検証を警告ゼロで通る。

一方で、応答文書の主張の一部は**実測では成り立たない**(下記 C2-M1, M2)。いずれも「黙って誤る」型で、新しい展開機構の周辺に残っている。

---

## C2. MBSE 専門家の観点: 83 点(外部確認待ち減点 6)

### 確認できた長所(実測)

1. a1: `r1 → [car::front]`、`r2 → [car::front::m1]`、`r3 (action 対象) → [car::ecu]`、`r4 → [fleet::c1::front::m1::rotor]`。ラウンド 2 の 4〜10 要素への過剰な紐づけは消えた。
2. a2: `r5 (v.ax.w1) → [v::ax::w1]`(正しい)。`part :>> ax { part spare }` の `v::ax` に `w1`・`w2`・`spare` がそろう(以前は `spare` のみ)。
   `part ax2 :> ax` は `w1`・`w2` を持つ(以前は空)。`satisfy own;`(by なし)は `self1` に紐づく。`multi : Wheel, Axle` も展開される。
3. a3: 日本語名・空白入りの引用符名の経路が壊れず、`satisfy c by 'my car'.pack2.cells → ['my car']::pack2::cells`、
   再定義 usage 内の追加 part `car1.pack.extra`、特殊化インスタンス `sp.pack.bms`、同名の別経路 `other.car1.pack` との同時 `satisfy` が正しく区別された。再帰する定義は `RECURSIVE_DEFINITION` で止まる。
4. SysML の入れ子 requirement: `r1::sub` に `parentId = r1` が付き、トレースに `derives` リンクが出る。

### 欠陥・減点(重大度順)

**[C2-M1 中・無警告・応答文書と食い違う] 定義の中の `ref part` が構造の子になる。**
- `part def Pack { ref part charger : Cell; }` → `car1::pack::charger` が `charger::セル`、`charger::a b` を含めて**所有する構造要素として導出**された(a3。a2 でも `v::driver`、`v2::driver`)。
- 除外されるのは定義の外にある `ref part` だけ(`expand.ts` の `kept` 判定)。定義の中の usage を複製する `instantiateMember` / `copy` は `isRef` を見ず、複製で `isRef` が落ちる。
  最も一般的な書き方(定義の中の参照)で、ADR-0008 の「`ref part` は構造に入れず警告する」と応答文書の「ref は除外して警告」が成り立たない。
  警告は定義側 1 件だけ(「2 件を無視」と出るが、実際には複製 9 インスタンス分の要素が混入)。
- 影響: 参照先の部品が各インスタンスの子として FMEA の構造に入り、同じ部品が二重に分析対象になる。

**[C2-M2 中・無警告] 定義の中の入れ子 part の中の型付き usage が展開されない。**
- `part def Veh { part aux { part pack : Pack; } }` から `car1::aux::pack` は作られるが、**子(`cells`・`bms` など)が一切展開されない**。
  `instantiateMember` は子孫を複製するだけで、子孫の `expandInto` を呼ばないため(`expand.ts`)。
- 構造・機能(`bms` の `perform`)が黙って欠ける。`satisfy b by car2.aux.pack.bms.chk` は `SATISFY_UNRESOLVED` が出るので紐づけの誤りは防がれるが、要素欠落そのものは警告されない。
- 配列多重度 `cells : Cell[4]` も 1 インスタンスにして警告しない(多重度を黙って無視)。

**[C2-M3 中] 名前のない再定義 usage の名前が完全修飾名になる。**
- `part :>> pack { ... }` は `name` が空のため、`deriveNet` が `nameOf = name ?? qualifiedName` で `A3::car1::pack` を表示名にする。
- SCDL の ID にそのまま流れ、`car1/A3::car1::pack/cells/セル` という不正に長い ID になった(a3 の `analyzeProject` 実測)。ID は SysML の再定義の名前(`pack`)になるべき。
  SCDL の安定 ID の主張(名前ベース)を、再定義を使うモデルで損なう。

**[C2-M4 中] SysML の入れ子 requirement が、充足判定と影響分析に使われない。**
- `r1` が `car::front` に満たされていても `r1::sub` は `TRACE_UNCOVERED`(実測)。`derives` リンクはトレース表示にあるが、充足の継承はない。
- `impactOfRequirementChange` の `requirementRelations` は `safety.json` の `refines` / `parentId` / 分解のみで、SysML の入れ子 requirement の親子を読まない。`r1` の変更の影響に `r1::sub` が入らない(実測: `requirements: []`)。
  ADR-0008 の「入れ子の requirement は親子を残す」は導出までで、後段の分析に接続されていない。`verify` / `derive` / `refine` の SysML 標準関係は依然として未導出で、ADR にも明記がない。

**[C2-M5 軽] 影響分析は方向づけされたが、最後に「影響を受ける要素に配置された要求」を下位に混ぜる。** `impact.ts` の末尾で、影響要素に配置された他の要求を `requirements`(下位)に追加するため、兄弟的な要求が「下位」として出る。
方向性そのものは実測で機能している(FSR-1b: 下位 1・上位 3・相手 1、REQ-002: 下位 0)が、「下位にのみ波及」という説明は厳密には正しくない。

**[C2-M6 軽] SCDL の要求(`ScdlRequirement`)には `modelRef` が付かない。** `modelRef` は要素(構造)だけに付き、SysML の `requirement`(REQ-001)と SCDL の要求(IF-1 / FSR-1)の対応は SCDL 側から機械的にたどれない。
正本が `.sysml` と `safety.json` の 2 つである点も、ADR-0007 の追補に方針としては書かれていない。

**[C2-M7 軽] 同名兄弟の SCDL ID の順序依存。** 兄弟が同名のとき(`a`、`a`、`'a#2'`)に `#2` / `#3` が並び順で入れ替わる(実測)。SysML は同一名前空間の同名を許さないため実害は小さいが、
ADR-0007 追補の「兄弟の並べ替えで変わらない」は、厳密にはこの場合に成り立たない。

### 外部確認待ち減点: 6 点
MBSE 専門家による G0 の書面レビュー(ADR-0007/0008 の導出規約、SCDL ステレオタイプ設計)と、他の SysML v2 ツールでの解釈確認が未実施。担当: 外部 MBSE 専門家 / ツール担当。

---

## B3. 互換性・相互運用性: 82 点(外部確認待ち減点 5)

### 確認できた長所
- 公式実装(固定版・SHA256)で検証でき、`run.sh` が再現できた。SCDL の出力は、特殊文字・日本語・引用符の ID でも `PilotCheck` で警告ゼロ(`scdl1.sysml`・`evscdl.sysml`)。
- 両経路の往復を実測: `exportSysml → importSysml` は、キー順を除き元モデルと一致(`modelRef` を含む。差分は `role` のキー順のみ)。
  `exportSysml → 公式抽出 → scdlFromGraph` は元モデルと完全一致(正規化比較で `equal true`)。a3 由来の SCDL(日本語・空白名)も `importSysml` の指摘 0、要素一致。
- ev-powertrain の `analyzeProject → exportSysml → importSysml` は指摘 0、`validateScdl` も 0。`ID_COLLISION`(要求 `RG-X` と要求グループ `RG-X`)は `validateScdl` が検出し、サーバーの書き出しは 409 で拒否する(`app.ts` 247〜248 行)。
- `satisfy` の連鎖(`byChain`)を抽出して使う変更により、公式実装の出力の誤解釈(ラウンド 2 の -3)は解消。ADR-0009 は「できること/できないこと」を正直に書いている。

### 欠陥・減点
- **標準の交換手段(SysML v2 API・標準 JSON・XMI)は依然ゼロ**。ADR-0009 は方針の記述にとどまる。他ツールとの交換は `.sysml` テキストのみ。(-8)
- 入力できる SysML の範囲: 型付き・継承・特殊化・再定義・複数インスタンスは対応したが、定義内の `ref part` の混入、定義内の入れ子 part の中の型付き usage の欠落、配列多重度の無視(C2-M1〜M3)が無警告。
  port・connection・flow・state・allocation は警告のみで取り込まない。(-6)
- `@Scdl*` ステレオタイプと `modelRef` 拡張は、他ツールで読めるか未確認(外部確認待ちに計上)。ASAM SCDL 仕様書との突合の証跡もない。(-2)
- jar の第三者ライセンス棚卸しの証跡は、今回もリポジトリ内に見つけられなかった。(-1)
- 名前のない再定義 usage が不正な ID を出す(C2-M3)ことは、書き出した SCDL が元モデルの名前と食い違う互換性上の欠陥。(-1)

### 外部確認待ち減点: 5 点
他ツール(商用モデラ、他の SysML v2 実装)での SCDL ステレオタイプ読み込み確認、ASAM SCDL v1.6.0 仕様書との突合(法務確認を含む)。担当: MBSE 専門家 / ツール担当 / 法務。

---

## A1. 機能要件の充足度(モデリング/トレーサビリティ/階層/SCDL の観点): 85 点(外部確認待ち減点 5)

| チェック項目 | 状況 | 所見 |
|---|---|---|
| SysML v2 準拠のモデリング(読み込み・検証・編集・書き出し) | 概ね達成 | 公式実装で検証。型付き・継承・再定義・特殊化・複数インスタンスが読める。定義内の ref と入れ子 part 内の型付き usage に穴(C2-M1/M2)。 |
| システム階層をモデルから自動生成 | 概ね達成 | インスタンス経路の ID。深い入れ子まで自動。ただし定義内の入れ子 part の中の型付き usage は展開されない。 |
| トレーサビリティ(マトリクス・影響分析・整合性チェック) | 概ね達成 | `satisfy` の経路は正しく、方向つき影響分析は機能する。入れ子 requirement が充足・影響に使われない(C2-M4)。 |
| ASAM SCDL ビュー | 達成(軽微な穴) | 根の追加で ID 不変、`modelRef` 往復、ID 衝突検出、エラー時 409。再定義 usage の ID と、要求側の `modelRef` 欠如が残る。 |

### SCDL 安定 ID の評価(再測定)
- 根の追加: `{r: vehicle, c: vehicle/c}` → `{r: vehicle, c: vehicle/c, z: charger}` と、既存の ID が不変。ラウンド 2 の最大の欠点は**解消**。
- 並べ替え: ev の通常ケースで不変。同名兄弟の `#n` のみ並び順依存(C2-M7)。
- `modelRef` は構造要素の完全修飾名で、書き出し・読み込み・`scdlFromGraph` の全経路で保たれる(確認)。

### 影響分析(`impact.ts`)の再測定(ev-powertrain)
- REQ-002: 下位 0 / 要素 1 / FMEA 2。FSR-1b: 下位 1、上位 3(確認のみ)、相手 1。FSR-1: 下位 4、上位 1。方向は機能している。
- ただし SysML 入れ子 requirement の親子は読まない(C2-M4)。

### 減点理由
- 無警告の展開の穴(ref 混入、入れ子 part 内の型付き usage、多重度、再定義の名前): -6
- 入れ子 requirement が充足判定・影響分析に未接続、SysML 標準関係(derive/refine/verify)なし: -4
- SCDL の要求側の `modelRef` なし、正本が 2 つの方針が未記載、仕様書との突合の証跡なし: -3
- ほか(影響分析の末尾の混入、同名兄弟の ID): -2

### 外部確認待ち減点: 5 点
専門家レビュー・他ツールでの確認・SCDL 仕様の突合。

---

## 優先修正(ファイル単位)

1. `packages/sysml-graph/src/expand.ts`(C2-M1): `instantiateMember` / `descendants` の複製で `isRef` の usage を除外し、`UNSUPPORTED_CONSTRUCT` に実インスタンス数を反映する。回帰テスト: `part def P { ref part c : Cell; } part p : P;` で `p::c` が出ないこと。
2. 同(C2-M2): `instantiateMember` の子孫の複製後に、型付きの子孫にも `expandInto` を呼ぶ。配列多重度は警告(`MULTIPLICITY_IGNORED`)。回帰: a3 の `car1.aux.pack.bms` が解決すること。
3. `packages/sysml-graph/src/derive.ts`(C2-M3): 名前なしの再定義 usage の名前は `redefinedFeatures` の末尾名、なければ完全修飾名の末尾にする(`nameOf`)。
4. `packages/analysis/src/impact.ts` と trace(C2-M4): `DerivedRequirement.parentId` を `requirementRelations` に加え、親が満たされていれば子を `TRACE_UNCOVERED` から外すか「親経由で充足」と区別して表示する。`verify`/`derive`/`refine` の扱いを ADR-0008 に明記する。
5. `packages/analysis/src/scdl-map.ts`(C2-M6/M7): SysML の要求にも `modelRef` を付ける。同名兄弟の ID を、元の完全修飾名由来の安定な接尾辞にする。
6. `docs/adr/0007`・`0008`: 正本が 2 つである方針、`ref` が定義内でも除外されること(修正後)、ADR-0007 追補の「兄弟の並べ替えで変わらない」に同名兄弟の例外を追記する。
7. `docs/adr/0009` の実行: SysML v2 API / 標準 JSON の入出力、jar の第三者ライセンス棚卸し。

---

## ラウンド 2 の指摘 → ラウンド 3 での確認

| 指摘 | 判定 | 実測の根拠 |
|---|---|---|
| C2-N1 `satisfy` のインスタンス経路が失われ誤紐づけ(`car.front` が 4 車両に、`v.ax.w1` が `v2`・`multi` に) | **修正済み** | a1: r1→`car::front` のみ、r4→1 要素。a2: r5→`v::ax::w1` のみ。a3 の同名別経路も区別。特定不能は `SATISFY_UNRESOLVED` |
| C2-N2 usage 側の再定義 `:>>` で子が欠落 | **修正済み** | `v::ax` に `w1`・`w2`・`spare` |
| C2-N2 usage の特殊化 `part ax2 :> ax` が空 | **修正済み** | `v2::ax2` に `w1`・`w2`(a3 の `sp :> car2` も `pack`・`more` が出る) |
| C2-N3 `ref part driver` が構造の子になる | **一部のみ(定義内は未修正)** | 定義の外の ref は除外。定義内の ref は `v::driver`、`car1::pack::charger`(子まで複製)として混入(C2-M1)。応答文書の主張は定義内では不成立 |
| C2-N4 入れ子 requirement の親子が失われる | **一部修正** | `parentId` と `derives` リンクは出る。充足判定(`r1::sub` は `TRACE_UNCOVERED`)と影響分析には未接続(C2-M4) |
| C2-N4 `satisfy x;`(by なし)が捨てられる | **修正済み** | `self1::own → [self1]` |
| C2-N4 verify / derive / refine の標準関係 | **未修正** | 導出なし。ADR にも明記なし |
| C2-N5 SCDL が元モデルへ機械的に辿れない | **一部修正** | 要素に `modelRef`(往復確認)。要求側にはなし(C2-M6)。正本 2 つの方針は未記載 |
| 安定 ID: 最上位を足すと全 ID が変わる | **修正済み** | 実測で既存 ID 不変 |
| 影響分析が無方向で全体に波及 | **修正済み(軽微な混入あり)** | 下位 / 上位 / 相手を分離。REQ-002 は下位 0。末尾の「配置された要求」の混入(C2-M5) |
| C2-N6 `FUNCTION_HIERARCHY` の誤警告 | **修正済み** | a1 / a2 の導出で `FUNCTION_HIERARCHY` は出ない |
| B3 サーバーの SCDL 書き出しにゲートなし | **修正済み** | `app.ts` 247〜250 行で 409(server テスト合格) |
| B3 標準の交換手段(API/JSON/XMI)なし | **未修正** | ADR-0009 に明記、実装なし |
| B3 jar の第三者ライセンス棚卸し | **未確認** | 証跡なし |
| ID 衝突(種類をまたぐ) | **修正済み(維持)** | `ID_COLLISION` を再現確認 |
| 階層レベル名が深さによる機械規則 | **未修正(許容)** | ADR に明記済み |
| 気づき 3: `'a::b'` 名の `shortName` | **未確認** | 今回確認していない |

## 外部確認待ち(合格時にも要実施)

- MBSE 専門家による G0 書面レビュー(ADR-0007/0008、SCDL ステレオタイプ、展開規約、階層規則)。担当: 外部 MBSE 専門家。
- 他の SysML v2 ツール(商用モデラ等)での `@Scdl*` ステレオタイプ、`modelRef` 拡張、導出規約の読み込み確認。担当: MBSE 専門家 / ツール担当。
- ASAM SCDL v1.6.0 仕様書との突合(附属書 A)とライセンスの法務確認。担当: 安全 + MBSE ドメイン担当、法務。

## 最終サマリ

- **A1: 85(減点 5、合否点 90 = 合格)/ B3: 82(減点 5、合否点 87 = 不合格)/ C2: 83(減点 6、合否点 89 = 不合格)**。3 項目とも採点は 80 以上。
- ラウンド 2 の最大の欠陥(`satisfy` 経路、再定義・特殊化、安定 ID、方向つき影響分析)は実測で解消。残る不合格要因は、(1) 定義内の `ref part` の混入(応答文書の主張が不成立)、(2) 定義内の入れ子 part の中の型付き usage の無警告の欠落、
  (3) 名前なし再定義の ID、(4) 入れ子 requirement の分析への未接続、(5) 標準の交換手段の欠如。
