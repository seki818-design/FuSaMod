# ラウンド 2 レビュー: MBSE / SysML v2 専門家の観点(A1・B3・C2)

- 立場: 独立・厳格な MBSE / SysML v2 専門家(シミュレートしたレビュアー。認証機関ではない)
- 基準: `docs/quality/rubric.md`(証拠主義、未検証は減点、外部確認待ち減点は点数と別に最大 10 点)
- 対象リビジョン: `0384738`(ソースは未変更。作業ツリーの差分はスクリーンショットと performance.md のみ)
- 方法(すべて実行):
  - `./tools/sysml-check/run.sh`: 公式パイロット実装 0.62.0 で SCDL.sysml・examples 4 件・projects の model.sysml がエラー・警告ゼロ
  - `pnpm -r test`: 全パッケージ合格(sysml-graph 20、scdl 49、analysis 43、safety-core 99 など。server の Java 結合 3 件は skip)
  - 新規の敵対的 SysML v2 モデル 2 本(`a1.sysml`、`a2.sysml`)を公式実装で読み(`SysmlExtract`)、`deriveNet` に通した。
    内容: `part def` の継承(`:>`)、入れ子の def、型付き usage、同じ def の複数インスタンス(`car`・`fleet.c1/c2`・`pc`・`dupA/B`)、`perform action x : Def`、
    `action def` を型にした入れ子 action、インスタンス経路を通る `satisfy`(`car.front`、`fleet.c1.front.m1.rotor`、`v.ax.w1`)、`requirement def`、入れ子 requirement、
    再定義(`:>>`)、usage の特殊化(`part ax2 :> ax`)、`ref part`、`part multi : Wheel, Axle`、port / connection / allocation / state
  - SCDL の往復: 特殊文字・重複名・`#`・`/`・引用符・バックスラッシュ・日本語を含む ID で `toScdl → exportSysml → importSysml`、
    `exportSysml → 公式実装 → scdlFromGraph` の両経路、ev-powertrain の `analyzeProject → exportSysml → 公式検証 → importSysml`、ID 衝突、非 SCDL の part を挟む入れ子
  - 安定 ID、要求の影響分析(`impactOfRequirementChange`)の挙動確認
- 検証用ファイルはスクラッチパッド(`.../scratchpad/m/`)にあり、リポジトリには書いていない。

---

## 総括

| 項目 | 採点 | 外部確認待ち減点 | 合否点 | 判定 |
|---|---|---|---|---|
| A1 機能要件(モデリング/トレーサビリティ/階層/SCDL の観点) | **83** | 5 | 88 | 不合格(合否点が 90 未満。採点は 80 以上) |
| B3 互換性・相互運用性 | **80** | 5 | 85 | 不合格(同上。採点は下限ちょうど) |
| C2 MBSE 専門家の観点 | **82** | 6 | 88 | 不合格(同上) |

ラウンド 1 から確かに大きく前進した。型付き usage・`part def`・継承・同じ定義の複数インスタンス・`perform action x : Def` は、実測で正しく展開された。
SCDL の ID の連番依存、18 文字の切り詰め、種類をまたぐ ID 衝突、親エレメントの 2 経路の食い違い、影響分析が故障ネットのみ、は実測で解消を確認した。
ADR-0008/0009 の「未対応」の列挙も、概ね正直になった。

一方、**新しい展開機構が、まだ「黙って誤る」穴を持っている**。特に `satisfy` の対象がインスタンス経路(`v.ax.w1`)で書かれたとき、
Pilot はこれを**定義側の特徴**(`Axle::w1`)に解決して返すため、導出は経路の情報を失い、**すべての複製に付け替える**。
その結果、実在する経路の対象が欠落し、無関係なインスタンスに紐づく例を実測した(下記 C2-N1)。トレーサビリティの健全性として、これが最大の残課題。

---

## C2. MBSE 専門家の観点: 82 点(外部確認待ち減点 6)

### 確認できた長所(実測)

1. 公式実装が、私の敵対的モデルを通した(エラーなしで抽出)。`a1.sysml` で `car`・`fleet.c1`・`fleet.c2`・`pc` の 4 インスタンスが、
   それぞれ `Adv::car::front::m1::rotor` のような**インスタンス経路の ID**で展開された。`Motor :> Base` の継承で、`Base` の part(`core`)と
   `perform action baseAct : Drive` も `m1` に引き継がれた。`dupA : Motor` のような最上位の型付き part も展開された。
2. ラウンド 1 で誤導出されていた「`part def` の中の part が最上位要素になる」は発生しない(`Adv::Motor::rotor` などは構造ネットに現れない)。
   未使用の `part def Unused` は `DEFINITION_NOT_INSTANTIATED`、`orphanAction` は `FUNCTION_NO_OWNER`、port / connection / allocation は件数つきの `UNSUPPORTED_CONSTRUCT` で警告された。
3. `satisfy r3 by car.ecu.compute`(action 対象)は、担当 part `car::ecu` ほか複製への紐づけになった(`SATISFY_NOT_PART` の誤検知は消えた)。
4. 往復と安定 ID(下記 A1 参照)。公式実装は、特殊文字 ID を含む SCDL 出力を警告ゼロで受理し、`scdlFromGraph` は元モデルと一致した(キー順を除く完全一致)。
5. ID の全体一意: `validateScdl` が要素 `ITEM` と要求 `ITEM`、要素 `ITEM/c` と要求 `ITEM/c`、要求 `RG-X` と要求グループ `RG-X` の 3 件の `ID_COLLISION` を検出した。

### 欠陥・減点(重大度順)

**[C2-N1 重大・無警告] `satisfy` のインスタンス経路が失われ、誤った要素に紐づく。**
- 実測 1: `satisfy r1 by car.front;` は、Pilot が `Adv::Car::front`(定義側)に解決して返す。導出は `front` の**全複製**に付け替えた:
  `r1 → [car::front, fleet::c1::front, fleet::c2::front, pc::front]`。`car.front` のつもりが 4 つの車両に紐づく。
  `satisfy r4 by fleet.c1.front.m1.rotor` は 10 要素(`car`・`fleet.c1/c2`・`pc`・**無関係な `dupA`・`dupB`** の rotor)に紐づく。
- 実測 2(より悪い): `part v : Veh { part :>> ax { part spare : Wheel; } }` のとき、`satisfy r5 by v.ax.w1;` は
  `["v2::ax::w1", "multi::w1"]` になった。**`v` ではなく `v2` と、無関係な `multi` に紐づく。** 経路上の `v.ax.w1` が存在しない(下記 C2-N2)ため、`v` への紐づけは 0 件。
  警告は出ない。
- ADR-0008 は「同じ定義の使用が複数あれば、すべてが満たすとみなす」と書くので、前者は仕様どおりだが、**ユーザーが `car.front` と書いた経路の意図を黙って広げる**。
  `TRACE_UNCOVERED` や要求の充足判定で「満たされている」と誤読させ、要求の影響分析(`impactOfRequirementChange`)の起点も広がる。
  後者は ADR にも書かれていない誤り。MBSE のトレーサビリティとして**誤紐づけは未紐づけより悪い**。
- 原因: `tools/sysml-check/SysmlExtract.java` の `satisfy` 抽出(129〜134 行付近)が `getSatisfyingFeature()` の末端(定義側の特徴)だけを出力し、
  特徴連鎖(`car.front`)の途中経路を落とす。`expand.ts` の `remapSatisfies` は、その定義側の特徴を全複製に展開する。

**[C2-N2 重要・無警告] usage 側の再定義(`part :>> ax {...}`)と usage の特殊化(`part ax2 :> ax`)で、子が黙って欠落する。**
- `part v : Veh { part :>> ax { part spare : Wheel; } }`: `v::ax` には `spare` だけが残り、`Axle` の `w1`・`w2` は**展開されない**(再定義した usage に `types` が無いため)。
  `REDEFINITION_IGNORED` は定義の中の再定義にしか出ず、この形では警告ゼロ。
- `part v2 : Veh { part ax2 :> ax; }`: `ax2` は子なしの空の要素になる(`supertypes` を展開に使っていない)。警告なし。
- 再定義は SysML v2 で型付き usage と並ぶ最頻出の書き方であり、ADR-0008 の「`:>>` は元の使用をそのまま使う」という記述とも実挙動が食い違う
  (usage 側の再定義では元の使用の中身も付かない)。

**[C2-N3 中・無警告] `ref part driver` が構造の子になる。**
`part def Veh { ref part driver; }` から `v::driver` が `v` の子の構造要素として導出された。参照(外部の part を指す)は所有ではない。
ADR は「ref による結び付けは未対応」と書くが、「無視」ではなく「所有する部品として取り込む」挙動で、警告もない。

**[C2-N4 中・無警告] 入れ子の requirement の親子が失われ、`satisfy <要求>;`(by なし)が黙って捨てられる。**
`requirement r1 { requirement sub : R { ... } }` の `r1::sub` は親を持たない平坦な要求(`satisfiedBy: []`)として出る。
`part self1 { requirement own; satisfy own; }`(自身が満たす)は `satisfiedBy: []` で、`deriveRequirements` が `!s.by` を黙って `continue` する。
これらは `TRACE_UNCOVERED` の誤検知・親要求の充足の取りこぼしになりうる。`verify`・`derive`・`refine` の SysML 標準関係は依然として未導出(ADR に明示がなく「要求の関係」節が無い)。

**[C2-N5 中] SCDL ビューは依然として、元モデルへ機械的に辿れる参照を持たない並行コピー。**
- ラウンド 1 の指摘のうち、備考(`note = "モデル参照: P::root"`)に元の完全修飾名が入った点は改善。ただし文字列であり、
  `evscdl.sysml` の `satisfy ... by Architecture::'ITEM'.'ITEM/powertrain'.'ITEM/powertrain/vcu'` は元の `vehicle.powertrain.vcu` を参照しない。
  `ScdlRequirement` も元の `REQ-001` と無関係な `IF-1`・`FSR-1` で、SysML の要求との `satisfy` は SCDL 側に写らない。
- 正本が 2 つ(`@Scdl*` つき SysML と `safety.json`)である構造は ADR-0007 に方針が追記されていない(未確認: ADR-0007 の追記は今回読んでいない部分あり。ADR-0009 には「SCDL は独自表現」とだけある)。

**[C2-N6 軽] 機能階層の誤警告。** 同じ part が所有する入れ子 action(`compute { sub1; sub2 }`、`stop { b }`)のたびに、
`FUNCTION_HIERARCHY`「上位機能の担当要素が、この機能の担当要素の親ではありません」が出る(担当要素が同一の場合)。
`a1.sysml` では 8 件、`a2.sysml` では 3 件。型の展開でインスタンスが増えるほどノイズが増え、本物の指摘が埋もれる(`packages/safety-core` の `validateNet` の判定条件の見直し)。

### 外部確認待ち減点: 6 点
MBSE 専門家による G0 の書面レビュー(ADR-0007/0008 の導出規約・SCDL ステレオタイプ設計)、他の SysML v2 ツールでの解釈確認が未実施(ADR が自ら「未実施」と記している)。担当: 外部 MBSE 専門家 / ツール担当。

---

## B3. 互換性・相互運用性: 80 点(外部確認待ち減点 5)

### 確認できた長所
- 公式パイロット実装(固定版・SHA256)を検証系に使い、`run.sh`・`extract.sh` が再現できた。**ADR-0009 が「できること/できないこと」を明記**し、SysML v2 API・標準 JSON・XMI・ReqIF・Excel 取り込みが未対応であることを隠していない。ラウンド 1 の「相互運用の範囲が不明」は解消。
- `.sysml` 原文を正本として保存・書き出す。SCDL の書き出しは、敵対的な ID(`'`、`\`、`::`、`#`、`/`、日本語、引用符つき)でも `exportSysml → 公式実装(警告ゼロ)→ scdlFromGraph` と `exportSysml → importSysml` の両方で元モデルと一致した。ev-powertrain の生成 SCDL も、公式実装で警告ゼロ、`importSysml` の指摘 0、`validateScdl` の指摘 0。
- 未対応構文は `UNSUPPORTED_CONSTRUCT` で件数つきで警告される(種類は port / connection / interface / flow / allocation / state)。サーバーの SCDL 書き出しのパッケージ名は `ScdlView_` 接頭辞と project ID(`^[a-z0-9][a-z0-9-]{0,63}$`)で常に識別子になり、ラウンド 1 の懸念は実質解消。

### 欠陥・減点
- **標準の交換手段は依然ゼロ**(SysML v2 API・標準 JSON・XMI)。ADR-0009 の方針は将来の記述にとどまり、実装も評価もない。他ツールとのデータ交換は `.sysml` テキストのみ。(-8)
- 入力の SysML の範囲: 型付き・継承は改善したが、再定義・特殊化・ref・入れ子 requirement で無警告に誤る(C2-N2〜N4)。ポート・接続・フローは取り込まない(警告のみ)。(-6)
- `satisfy` の特徴連鎖を落とす抽出(C2-N1)は、公式実装の出力を**間違って解釈する**相互運用上の欠陥。(-3)
- SCDL の他ツールでの解釈確認がない(外部確認待ちに計上)。ASAM SCDL 仕様書との突合の証跡もない。(-2)
- サーバーの SCDL 書き出しは、SCDL に error 級の指摘(`ID_COLLISION` など)があっても書き出す(`apps/server/src/app.ts` の `scdl.sysml`。ゲートなし)。(-1)

### 外部確認待ち減点: 5 点
他ツール(商用モデラ、他の SysML v2 実装)での SCDL ステレオタイプの読み込み確認、ASAM SCDL v1.6.0 仕様書との突合(ライセンスの法務確認を含む)が未実施。担当: MBSE 専門家 / ツール担当 / 法務。

---

## A1. 機能要件の充足度(モデリング/トレーサビリティ/階層/SCDL の観点): 83 点(外部確認待ち減点 5)

| チェック項目 | 状況 | 所見 |
|---|---|---|
| SysML v2 準拠のモデリング(読み込み・検証・編集・書き出し) | 概ね達成 | 検証は公式実装。型付き・継承・複数インスタンスが読める。再定義・特殊化・ref・入れ子 requirement は無警告で誤る。 |
| システム階層をモデルから自動生成 | 概ね達成 | インスタンス経路の ID で、深い入れ子まで自動。レベルは深さの機械規則(上書き可)。 |
| トレーサビリティ(マトリクス・影響分析・整合性チェック) | 概ね達成 | 影響分析は要求 → satisfy → 要素 → 機能 → 故障 → FMEA、安全要求の詳細化・導出・分解へ拡張された。ただし起点の satisfy が誤紐づけを含みうる(C2-N1)。 |
| ASAM SCDL ビュー | 概ね達成 | 往復・ID 衝突検出は堅牢。並行コピーで追跡は備考の文字列。 |

### 安定 ID(SCDL)の評価
- 兄弟の追加・並べ替えで ID が変わらない: **確認**(名前ベース `ITEM/powertrain/vcu`)。要求の名前の切り詰めも消えた。
- ただし**限定的**:
  1. 最上位の part が 1 つなら根は `ITEM`、2 つになると根が部品名に変わり、**全エレメントの ID が書き換わる**(実測: `{r: ITEM, c: ITEM/c}` → `{r: vehicle, c: vehicle/c, z: charger}`)。「並び順・追加で変わらない」という主張は、最上位を足すと成り立たない。
  2. 同名の兄弟(`#2` で区別)は並び順依存(順序を逆にすると `a` と `a#2` が入れ替わる)。SysML は同一名前空間の同名を許さないため実害は小さいが、`'a#2'` という実名の兄弟があると `a#2#2` になる。
  3. 改名で ID が変わる(許容範囲。ただし要求の配置・グループ・外部引用がすべて切れる)。
  4. ID が名前の連結で長くなる(深い階層で数百文字)。
- 要求・ペア・グループの ID は `safety.json` の ID(`RG-<id>`、`CP-<id>` 等の接頭辞つき)。接頭辞による衝突(要求 `RG-X` と意図機能 `X` の `RG-X`)は、`toScdl` では検出せず `validateScdl` で初めて検出される(`analyzeProject` は両方を実行するので画面には出る)。

### トレーサビリティと影響分析の健全性
- 要求の影響分析は、ev-powertrain で実行して妥当な結果が出た(`REQ-002` → motor 1 要素・機能 1・故障 2・FMEA 2。理由は経路つき)。
- ただし**精度が粗い**: 関係を**無方向**に推移閉包するため、葉の要求(`REQ-003` → `FSR-1b` → 親 `FSR-1` → 兄弟 `FSR-1a` ...)の変更が**全 8 要素・全 20 故障**に波及する。
  「上位に影響する/下位に影響する」の方向を区別しないので、変更の影響を絞る用途には弱い。「影響しうる範囲」という説明は正直。
- SysML の `requirement` と安全要求の紐づけは `safety.json` の `refines` による手動の関係。SysML の `derive`/`refine`/`verify` は読まない。

### 減点理由
- `satisfy` の誤紐づけ・再定義/特殊化/ref/入れ子 requirement の無警告の誤り(C2-N1〜N4): -8
- SCDL の追跡が文字列の備考のみ、正本が 2 つ、最上位追加で ID 全変更: -4
- 影響分析の粗さ(無方向の閉包)、SysML 標準関係(derive/refine/verify)なし: -3
- 仕様書との突合の証跡なし、ノイズの多い誤警告(C2-N6): -2

### 外部確認待ち減点: 5 点
上記の専門家レビュー・他ツールでの確認・SCDL 仕様の突合。

---

## 優先修正(ファイル単位)

1. `tools/sysml-check/SysmlExtract.java` + `packages/sysml-graph/src/{types,expand}.ts`(C2-N1): `satisfy` の `by` の**特徴連鎖(`car.front.m1`)全体**を出力し、`remapSatisfies` はそのインスタンス経路に一致する複製だけに紐づける。連鎖が取れない場合は全複製への展開をやめ、`SATISFY_AMBIGUOUS_INSTANCE`(件数つき)の警告を出す。`a1.sysml` / `a2.sysml` の `satisfy` を回帰テストにする。
2. `packages/sysml-graph/src/expand.ts`(C2-N2/N3): usage 側の再定義(`part :>> ax`)の型を継承して展開する、または `REDEFINITION_IGNORED` を usage にも出す。usage の特殊化(`part ax2 :> ax`)も同様。`isReference`(`ref part`)は構造から外して警告。
3. `packages/sysml-graph/src/derive.ts`(C2-N4): `satisfy x;`(by なし)は所有 part への紐づけとして扱うか警告。入れ子 requirement に親を持たせる(`DerivedRequirement.parentId`)。
4. `packages/analysis/src/scdl-map.ts`: 最上位が複数でも根の ID を安定にする(常に `ITEM` + 元の最上位名、または元の完全修飾名由来のハッシュ)。`toScdl` 内で種類をまたぐ ID の衝突を検出する。`@ScdlElement` の `note` だけでなく、元要素への `dependency`(または `modelRef` 属性)を SCDL 出力に出す。
5. `packages/analysis/src/impact.ts`: 要求の関係の方向(上位への影響/下位への影響)を区別し、兄弟への波及は「上に上がってから下がる」経路を除外または別表示にする。
6. `packages/safety-core`(`validateNet`): 同じ担当要素の入れ子 action で `FUNCTION_HIERARCHY` を出さない。
7. `apps/server/src/app.ts`: `scdl.sysml` の書き出し前に error 級の指摘を確認する(422 で拒否、または明示のフラグ)。
8. `docs/adr/0007`、`0008`: `satisfy` が定義側に解決される制約(現状)、再定義・特殊化・ref・入れ子 requirement の未対応、SCDL の正本が 2 つである方針を追記する。
9. SysML v2 API / 標準 JSON の対応(ADR-0009 の方針の実行)、jar の第三者ライセンス棚卸し。

---

## ラウンド 1 の指摘 → ラウンド 2 での確認

| 指摘 | 判定 | 実測の根拠 |
|---|---|---|
| C2-1 型付き usage・`part def` の導出誤り(定義内 part が最上位に混入、`m : Motor` が空、定義内 action が落ちる) | **修正済み(一部残)** | `a1.sysml` で 4 インスタンスが正しく展開、継承も OK、混入なし。残: 再定義・特殊化・ref(C2-N2/N3) |
| C2-1 `perform action x : Def` が無視される | **修正済み** | `pc::extraRun`、`Motor` 内の `perform` が複製に付け替えられ、機能として導出 |
| C2-1 ADR-0008 に def/型付きの未対応が書かれない | **修正済み** | 展開の節と「導出しない構成」の表が追加。ただし `satisfy` の経路の制約は未記載 |
| C2-2 SCDL が並行コピーで追跡できない | **一部のみ** | 備考に元の完全修飾名(文字列)。参照・`satisfy` は元に張られない(C2-N5) |
| C2-2 SCDL ID が並び順の連番 | **一部修正** | 名前ベースで兄弟の追加に強い。最上位を足すと全 ID が変わる(実測) |
| C2-2 名前を 18 文字で切る | **修正済み** | `shorten` は 80 文字、要素名は全文。要求名の長い文は 80 文字で切る(`…`)が、全文は `text` に残る |
| C2-3 影響分析が故障ネットのみ | **修正済み(粗い)** | `impactOfRequirementChange` が要求 → satisfy → 要素 → 機能 → 故障 → FMEA。無方向で過大(葉の変更が全体に波及) |
| C2-3 `satisfy` が action 対象で未紐づけ | **修正済み** | `satisfy r3 by car.ecu.compute` が `car::ecu` ほかに紐づく |
| C2-3 SysML 要求 ↔ 安全要求の紐づけ | **一部修正** | `refines` で手動の関係。SysML の derive/refine は読まない |
| C2-3 入れ子 requirement・verify・derive・refine 未導出 | **未修正** | 入れ子の親子は失われたまま、無警告(C2-N4) |
| C2-4 種類をまたぐ ID 衝突を見逃す | **修正済み** | `ID_COLLISION` を 3 ケースで検出 |
| C2-5 2 つの読み込み経路で親の決め方が違う | **修正済み** | 非 SCDL の `wrapper` を挟む入れ子で、両経路とも `B.parent = A` |
| C2-6 階層レベル名が機械的 | **未修正(許容)** | 深さによる規則のまま(上書き可。ADR に明記済み) |
| B3 標準の交換手段(API/JSON/XMI)なし | **未修正** | ADR-0009 に「未対応」と明記(正直になった)。実装なし |
| B3 入力できる SysML の範囲が狭い | **一部修正** | 型付き・継承・複数インスタンスは対応。再定義・特殊化・ref で無警告に誤る |
| B3 サーバーの SCDL パッケージ名 | **修正済み** | `ScdlView_` + 小文字英数字とハイフンのみの project ID |
| B3 jar の第三者ライセンス棚卸し | **未確認** | 今回確認していない |
| 気づき 1: 複数 part の perform を機能ネットで表せない | **未確認** | `FUNCTION_MULTIPLE_PERFORMERS` の挙動は不変。ADR の明記は今回確認していない |
| 気づき 3: `'a::b'` 名の `shortName` | **未修正** | `trace.ts` の `shortName` は `::` 分割のまま |

## 外部確認待ち(合格時にも要実施)

- MBSE 専門家による G0 書面レビュー(ADR-0007/0008、SCDL ステレオタイプ、展開規約、階層規則)。担当: 外部 MBSE 専門家。
- 他の SysML v2 ツール(商用モデラ等)での SCDL ステレオタイプと導出規約の読み込み確認。担当: MBSE 専門家 / ツール担当。
- ASAM SCDL v1.6.0 仕様書との突合(附属書 A)とライセンスの法務確認。担当: 安全 + MBSE ドメイン担当、法務。

## 最終サマリ

- **A1: 83(減点 5、合否点 88)/ B3: 80(減点 5、合否点 85)/ C2: 82(減点 6、合否点 88)**。3 項目とも採点は 80 以上だが、合否点が 90 未満で不合格。
- 次に直すべき上位: (1) `satisfy` のインスタンス経路を落とす問題と誤紐づけ(SysmlExtract.java + expand.ts)、(2) usage 側の再定義・特殊化・`ref`・入れ子 requirement の無警告の誤り、(3) SCDL の安定 ID(最上位追加で全変更)と元モデルへの参照、(4) 影響分析の方向性、(5) 標準の交換手段(SysML v2 API / JSON)。
