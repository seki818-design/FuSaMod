# ラウンド 1 レビュー: MBSE / SysML v2 専門家の観点(A1・B3・C2)

- 立場: 独立・厳格な MBSE / SysML v2 専門家(シミュレートしたレビュアー。認証機関ではない)
- 基準: `docs/quality/rubric.md`(証拠主義、未検証は減点、外部確認待ち減点は点数と別に最大 10 点)
- 対象リビジョン: `403dda9`(作業ツリーはスクリーンショット・performance.md のみ変更あり)
- 方法: ADR-0002/0007/0008、`libs/sysml/scdl/SCDL.sysml`、`examples/sysml`、`projects/ev-powertrain`、`packages/{sysml-graph,scdl,analysis}` を読み、以下を**実行**した。
  - `./tools/sysml-check/run.sh`(公式パイロット実装 0.62.0、Java 21、約 18 秒)
  - `pnpm -r test`(全パッケージ合格。server の Java 結合テスト 3 件は skip)
  - 敵対的モデル(part def / 型付き usage / port / connection / flow / state / allocation / 特殊化 / perform action 宣言形 / Unicode・引用符つきの名前)を公式実装で読み、`SysmlExtract` → `deriveNet` に通した
  - SCDL の敵対的往復(特殊文字の ID、入れ子、`\r\t`、`//`・`/* */` を含む名前など)を `exportSysml → importSysml`、および `exportSysml → 公式実装 → scdlFromGraph` の両経路で比較
  - ev-powertrain プロジェクトの `analyzeProject → toScdl → exportSysml → 公式実装検証 → importSysml`
- 検証用の一時ファイルはスクラッチパッドにあり、ソースは変更していない。

---

## 総括

| 項目 | 採点 | 外部確認待ち減点 | 合否点 |
|---|---|---|---|
| A1 機能要件(モデリング/トレーサビリティ/階層/SCDL の観点) | **74** | 5 | 79 |
| B3 互換性・相互運用性 | **76** | 5 | 81 |
| C2 MBSE 専門家の観点 | **73** | 7 | 80 |

3 項目とも**不合格**(合否点が 90 未満。採点自体も 80 未満)。
良い点は本物で、公式パイロット実装による検証、決定的なグラフ抽出、書き出し→読み込みの往復の堅牢さは確認できた。
一方で、「SysML v2 モデルから自動導出する」という中核の主張は、**SysML の最も一般的な書き方(定義と使用、型付き part、ポート、`perform action x : Def`)では成り立たない**。
また「SCDL ビュー」は**モデルに適用されたステレオタイプではなく、別データ(safety.json)から作る並行コピー**であり、MBSE としての単一の正本・追跡可能性が弱い。

---

## C2. MBSE 専門家の観点: 73 点(外部確認待ち減点 7)

### 確認できた長所(実行で裏付け)

1. **SysML v2 の使い方は構文的に妥当。** `run.sh` は SCDL.sysml、examples 3 件、projects の model.sysml をエラー・警告ゼロで通した。
   さらに私が生成した敵対的な SCDL 出力(`rt.sysml`: 特殊文字 ID、入れ子 part)と、ev-powertrain から生成した `evscdl.sysml` も、公式実装でエラー・警告ゼロだった。
   ADR-0007 の「`default false` と `=` の違い」「`satisfy ... by` の特徴連鎖は `.`」といった実装で踏む細部を、公式実装で確かめて直している点は評価できる。
2. **`metadata def` によるステレオタイプ表現は SysML v2 の定石に沿う。** `:>> annotatedElement : SysML::PartUsage` などで適用先を型検査させている。
   enum def、`abstract metadata def ScdlType` の継承、`default` の使い方も妥当。ADR-0002 の対照実験(誤適用を検出)も記録されている。
3. **導出規約が小さく明確。** `part` 入れ子、`action` 入れ子、`perform`、`satisfy`、`in/out` だけを使い、規約を ADR-0008 に明記している。例外は黙って捨てず `deriveIssues` に警告として出す(PERFORM_NOT_PART など)。
4. **古い解析結果を黙って返さない設計。** snapshot モードはテキストのハッシュが一致する時だけ返し、不一致なら `SysmlUnavailableError`。
5. **階層レベルは深さで決め、上書き(`levelOverrides`)を許す。** 規則が `levels.ts` の 8 行で、ADR にも書かれている。

### 欠陥・減点(重大度順)

**[C2-1 重大] 型付き usage / 定義(def)を使うモデルで、導出ネットが誤る(一部は警告も出ずに誤る)。** 実測:

- 入力: `part def Motor { part rotor; ... }`、`part car { part m : Motor; part m2 : Motor; }`、`part def Inverter { action convert {...} }`、`part ctrl { perform action b : Brake; }`。
- `SysmlExtract` は `Adv::Motor::rotor`(`part def` の中の part usage)も PartUsage として出力する。`deriveStructure` はこれを**親なしの最上位要素(= システムレベル)として追加した。警告は出ない。** 実システムと無関係な「システム」が増える。
- `car.m : Motor` の中身(`rotor`、継承された action)は**展開されない**。`m` と `m2` は子を持たない空の要素になる。型の誤りも警告もない。
- `Inverter::convert`(定義の中の action)は `FUNCTION_NO_OWNER` 警告で捨てられる。つまり部品定義に機能を書く標準的な流儀では、機能が 1 つも得られない。
- `perform action b : Brake;`(宣言と同時に perform)は、`b` が `PerformActionUsage` で `ActionUsage` としてグラフに出ないため `PERFORM_NOT_ACTION` で無視される。SysML v2 教科書的な書き方の大半が落ちる。
- `perform` は `part def` 内にもあるが、performer が PartDefinition なので `PERFORM_NOT_PART` で無視される。

つまり導出が機能するのは「`part` を直接入れ子にし、`action` を入れ子にし、`perform a.b.c;` で参照する」という**ADR-0008 の狭い方言だけ**。
ADR-0008 の「制約と今後」は `allocate`・`flow`/`connection`・`ref`・再定義の未対応を正直に書いているが、**`part def`/`action def` と型付き usage が未対応であることは書かれていない**。
これは「未対応の構成」の中で最も影響が大きい。しかも定義内 part の混入は無警告で誤る。

**[C2-2 重大] SCDL ビューが「モデルに適用されたステレオタイプ」ではなく並行コピー。**
`exportSysml` は `Architecture::'ITEM'`、`'E-1'`、`'E-1-2-1'` という**新しい part ツリー**を作り、元モデルの `vehicle`・`powertrain` を参照しない(`evscdl.sysml` で確認)。
元の名前は `title = "vehicle"` という文字列にしか残らない。`ScdlRequirement` は元の `REQ-001` と無関係な ID(`IF-1`、`FSR-1`)で、`satisfy` も元の part には張られない。

- ADR-0007 は「SCDL のエレメント = `part` 使用 + `@ScdlElement`」を、構造ネットと同一の表現になると謳うが、実際の生成物は元モデルと**同一ではない**。
- 逆方向も弱い。ステレオタイプを元の `model.sysml` に書いて読む経路(`scdlFromGraph`)は存在し例も通るが、プロジェクトの実運用経路(`analyzeProject → toScdl`)は `safety.json` の `intendedFunctions/mechanisms/pairs` から作る。
  つまり **SCDL の正本が 2 つ**(`@Scdl*` が付いた SysML か、`safety.json` か)あり、両者の整合を取る仕組みがない。
- `safety.json` が SysML 要素を指す手段は、完全修飾名の文字列(`EvPowertrainDemo::vehicle::'drive vehicle'::...`)のみ。part の改名で参照が切れる(`UNKNOWN_ELEMENT` のエラーにはなるので黙ってはいないが、改名の追従・リファクタリングは無い)。
- SCDL 上のエレメント ID(`E-1-2`)は兄弟の並び順で付く連番で、**部品の追加・並べ替えで ID が変わる**。バージョン管理の差分や、外部から SCDL 図を引用する用途で不安定。要求の `name` も 18 文字で `…` に切り詰められる(`shorten`)。

**[C2-3 重要] 追跡可能性・影響分析が SysML の関係に基づかない。**

- 影響分析(`impactOfFailureChange`)は**故障ネットのリンクだけ**をたどる。要求の変更 → satisfy 先の part → その機能・故障・FMEA・安全要求、という MBSE で期待される影響波及は無い。AI の「影響分析」も同じ関数を呼ぶだけ。
- `buildTrace` のセルは `satisfy`(SysML 要求→part)と `allocate`(`safety.json` の安全要求→part)の 2 種のみ。SysML 要求と安全要求の**親子関係(`derives`)は安全要求同士だけ**で、SysML 要求 ↔ 安全要求が繋がらない。2 つの要求体系が並存する。
- `deriveRequirements` は `satisfy` の `by` が part でなければ捨てる(`SATISFY_NOT_PART`)。`satisfy` の対象が action(機能が要求を満たす)の場合は、要求が「未紐づけ」扱いになり、トレースの `uncovered`・`REQUIREMENT_NOT_SATISFIED` の誤検知になる。
- `verify`・`derive`/`refine`・`allocate`(SysML 標準)、`requirement def` と型付き `requirement`、サブ要求(入れ子の requirement)は未導出。入れ子の `requirement` は kind が `RequirementUsage` のまま平坦に並ぶだけで、親子が失われる(`DerivedRequirement` に親がない)。

**[C2-4 中] 要求の同一性・ID 衝突の穴(往復の欠陥、実測)。**
`validateScdl` は ID の重複を**種類ごと**にしか検査しない。要求 `X` と制約条件 `X`(別の配置先)を作ると検証を通り、エクスポートもでき、そして `importSysml` は
`satisfy` の解決を ID だけで行うため、**制約条件 X の配置先が誤って要求 X の配置(エレメント X)になり、`ALLOCATION_MULTIPLE` の誤エラーを返した**(`dup.ts` で確認)。
`scdlFromGraph` も `allocation` を ID(名前)で保持するので同じ衝突が起きる。SCDL の `SCDLType.id` は全体で一意とすべきだが、その検査がない。
(また `importSysml` の「末尾一致で解決」は、別パッケージの同名で曖昧エラーになる。意図した安全側の挙動だが、実モデルの識別にはパス全体の解決が望ましい。)

**[C2-5 中] 2 つの読み込み経路の意味が食い違う。**
`importSysml` は SCDL エレメントの親を「最も近い**祖先**の SCDL エレメント」(非 SCDL の part を飛ばす)で決めるが、`scdlFromGraph` は**直接の所有者**だけを見る(`buildElement`)。
非 SCDL の part を挟む入れ子では、同じテキストから経路によって異なる階層になる。例は無く、テストでも押さえていないとみられる。

**[C2-6 軽] 階層レベル名が機械的。** 深さ 0/1/2/3+ がそのままシステム/サブシステム/コンポーネント/詳細になる。
モデルが深い(サブシステムが 2 段ある)と、「コンポーネント」が実際は下位サブシステムになる。上書きの手段はあるが、ユーザーが 1 件ずつ指定する必要がある。複数の最上位要素はそれぞれ「システム」になる(ADR にある通り)。

### 外部確認待ち減点: 7 点

MBSE 専門家による G0 レビュー(ADR-0007/0008、SCDL ステレオタイプの設計、他ツール(商用モデラ)での解釈の確認)が未実施。ADR 自身が「未確認」と記している。

### 優先修正(ファイル単位)

1. `tools/sysml-check/SysmlExtract.java` と `packages/sysml-graph/src/derive.ts`: `PartDefinition`/`ActionDefinition` 配下の usage を構造ネットから除外し(または警告)、**型付き usage の展開**(`part m : Motor` の中身を m の子として複製)と `perform action x : Def` の宣言形を扱う。最低限、未対応の構成は無警告で誤らず `deriveIssues` に必ず出す。
2. `docs/adr/0008-derive-nets-from-sysml.md`: 「制約と今後」に def/型付き usage・`perform action` 宣言形・`satisfy` の action 対象・入れ子 requirement が未対応であることを明記する。
3. `packages/analysis/src/scdl-map.ts`・`packages/scdl/src/sysml-export.ts`: SCDL の出力から元モデルの要素への**追跡を保つ**(`@ScdlElement` を元の part に付ける、または `modelRef` 相当の属性/`dependency` を出す)。SCDL ID は並び順の連番でなく、元の完全修飾名から安定に作る。切り詰めた `name` をやめる。
4. `packages/scdl/src/validate.ts`: ID の**全体一意**(種類をまたぐ重複)を検査する。`sysml-import.ts`・`from-graph.ts` の `allocation` を ID でなく完全修飾名で保持する。
5. `packages/scdl/src/sysml-import.ts` と `from-graph.ts`: 親エレメントの決め方(祖先 vs 直接の所有者)を統一し、テストを追加する。
6. `packages/analysis/src/trace.ts` と `analyze.ts`: SysML 要求 ↔ 安全要求の紐づけ、要求→part→機能→故障の影響波及(変更影響分析)を追加。`satisfy` の対象が action の場合の扱いを定義する。

---

## B3. 互換性・相互運用性: 76 点(外部確認待ち減点 5)

### 確認できた長所

- **公式パイロット実装を検証系に採用**(ADR-0002)し、固定した版・SHA256 で取得、`run.sh`・`extract.sh` で再現できる(今回 18 秒で完走)。商用モデラを除き、現時点で最も権威ある準拠性の判定をしている。
- **SysML テキストの正本性を保つ。** モデルは `.sysml` 原文のまま保存・書き出し(`model.sysml`)。ツール独自の形式に変換していない。
- **往復の堅牢さを実証した。** 特殊文字の ID(`'`、`\`、`::`、`.`、空白、日本語、`/* */`、`//`、末尾 `\`)、`"` `\` 改行 `\r` `\t` を含む `title`/`note`、入れ子 part を含む合成モデルで:
  `exportSysml → importSysml` と `exportSysml → 公式実装 → scdlFromGraph` のいずれも元のモデルと**完全一致**、公式実装も警告ゼロ。ev-powertrain 実プロジェクトの SCDL 生成物も一致・検証通過。
- 部分パーサー(`importSysml`)は未対応構文を**エラーにして黙って捨てない**(`part def` を含む入力で `未対応の構文です` を投げる設計)。
- CSV 出力は数式インジェクション対策と BOM つきで表計算ソフトに配慮(`export.ts`)。`analysis.json`、`report.md` も出力する。

### 欠陥・減点

- **SysML v2 の標準的な交換手段が無い。** SysML v2 API & Services(REST)、標準 JSON 表現、XMI は未対応。ADR-0002 は「SysML API との関係は P1 で評価」としたまま未評価。`SysmlServer.java` は独自の常駐サービスで標準 API ではない。他ツール(Cameo、Capella 系ブリッジ、SysON など)とのデータ交換は、`.sysml` テキストに限られる。(-8)
- **SCDL の他ツール交換は事実上無い**(ADR-0006 が「交換形式なし」を確認済み。ここは減点しすぎない)。ただし出力は独自のステレオタイプ SysML で、ASAM SCDL を読む他ツールで使えるかは未確認。ADR-0007 の「商用モデラでの解釈は未確認」が残る。(-4)
- **入力できる SysML の範囲が狭い。** 導出は C2-1 の方言限定。`SysmlExtract` が出すのは PartUsage/ActionUsage/RequirementUsage/Package/Dependency/Metadata/Satisfy/Perform のみで、ポート・接続・フロー・状態・allocation・specialization は**取り込めない**(ADR-0008 に未対応と記載。ここは正直)。実際の SysML v2 モデルを持ち込むと、安全分析ネットがほとんど空になる。(-8)
- **モデルの検証が Java 依存で、Java 無し環境では保存済みスナップショットに一致するテキストしか解析できない。** 設計は誠実だが、編集の自由度とトレードオフ(B8 の領域)。公式 jar の第三者ライセンス棚卸しも未実施。(-2)
- 名前のエスケープ: SysML の無制限名で許されない文字(制御文字など)を ID に含めた場合の挙動は、`\r\t` を含むケースが通ったのみで、全ての文字クラスは未検証。サーバーのエクスポートでは `ScdlView_${id.replace(/-/g, "_")}` が、プロジェクト ID が数字始まりや非 ASCII だと `ScdlSysmlError` になりうる(`apps/server/src/app.ts` 226-229 付近、未実行)。(-1)
- CSV の取り込み(インポート)・ReqIF は無い(要求は SysML 内で書く前提)。(-1)

### 外部確認待ち減点: 5 点

他ツール(商用モデラ、SysML v2 の他実装)での読み込み確認、ASAM SCDL 仕様への適合確認(仕様書はリポジトリに含まれず、ADR で「確認済み」とあるが証跡なし)が未実施。

### 優先修正

1. `apps/server`・`tools/sysml-check`: SysML v2 API(REST)の読み書き、または標準 JSON の入出力を追加(または ADR で見送りの根拠を確定)。
2. `tools/sysml-check/SysmlExtract.java`・`packages/sysml-graph/src/types.ts`: Port・Connection・Flow・State・Allocation・Specialization(PartDefinition を含む)を要素グラフに加える。
3. `docs/adr/0007-*.md`: 他ツールでの確認結果、または未確認の範囲の一覧を維持する。
4. `apps/server/src/app.ts`: SCDL エクスポートのパッケージ名を安全に生成する(識別子化)。
5. jar の第三者ライセンス棚卸し(`docs/adr/0002` の残項目)。

---

## A1. 機能要件の充足度(モデリング / トレーサビリティ / 階層 / SCDL の観点): 74 点(外部確認待ち減点 5)

他の観点(FMEA 7 ステップ、HARA、AI など)は私の担当外のため採点しない。以下はチェックリストのうち、モデリング・階層・トレーサビリティ・SCDL に関する分。

| チェック項目 | 状況 | 所見 |
|---|---|---|
| SysML v2 準拠のモデリング(読み込み・検証・編集・書き出し) | 一部 | 検証は公式実装で高品質。読み込みは**狭い方言**に限定(C2-1)。編集は原文テキスト編集+再解析(snapshot モードは未保存テキスト不可)。書き出しは原文と SCDL SysML。 |
| システム階層をモデルから自動生成 | 一部 | part の入れ子から自動。def/型付き usage では誤る(C2-1)。レベルは深さの機械規則(C2-6)。 |
| トレーサビリティ(マトリクス・影響分析・整合性チェック) | 一部 | マトリクス・CSV・整合性チェックはある。影響分析は故障ネットだけで SysML の関係に基づかない(C2-3)。 |
| ASAM SCDL ビュー | 一部 | 概念の対応(Element/Requirement/Constraint/RequirementGroup/Interaction/Pairing/Coexistence/Weight)は ADR-0007 の表と型で網羅的。`validateScdl` も多重度・重複・循環・配置・分解を検査。ただし並行コピー(C2-2)、ID 衝突(C2-4)。 |
| 図とテキストの切り替え、モデル編集・管理 | 範囲外 | A2・B4 で評価。 |

### SCDL v1.6.0 との整合(確認できた範囲)

- `Element`(入れ子)、`Requirement`/`Constraint`(`AbstractRequirement` として `isAllocated`/`allocation`)、`Interaction`(出力 0..1、宛先 1..*、`MULTIPLE_OUTGOING`)、`RequirementGroup`(重複メンバー禁止、`about` 表現)、`RequirementGroupPairing`・`RequirementPairing`(2 者・同一禁止)、`CoexistenceTarget`、`ConstraintPairing` の対応は、ADR とコードの両方で一貫していた。
- `weight`/`decomposedFrom` による `A(B)` 表記は、ISO 26262 の分解を損なわない良い設計で、`A(B)` の A < B 方向のみ許す検査もある。
- 仕様書はリポジトリに無く、仕様の細部(附属書 A の制約番号 A.6.2 等)との突合は私も**検証できない**。ADR の「仕様 v1.6.0 確認済み」は証跡が無い。
- `RequirementGroup.role` と `isExternal` の拡張は、拡張と明記され任意属性。妥当。
- SCDL 図の記法(線種・配置・描画)はモデルとしては扱わない設計(描画層の責務)。ここでは評価しない。

### 減点理由

- 導出の適用範囲の狭さ(def/型付き usage で誤る・機能が落ちる): -10
- SCDL ビューが元モデルを指さない並行コピー、SCDL の正本が 2 つ、ID が不安定: -6
- 影響分析が SysML の関係をたどらない、要求体系が 2 つ並存: -5
- ID 衝突・経路間の階層の意味の食い違い: -3
- 仕様との突合の証跡なし: -2

### 優先修正

C2 の優先修正 1〜6 と共通。特に 1(導出の適用範囲)、3(SCDL の追跡と安定 ID)、6(影響分析)。

---

## その他の欠陥・気づき

1. **`packages/sysml-graph/src/derive.ts`**: 複数の part が同じ action を perform した場合、先頭を担当にして警告のみ(`FUNCTION_MULTIPLE_PERFORMERS`)。冗長構成(SCDL の主題)で自然に起こる書き方なので、複数担当を機能ネットで表せない制約は ADR に明記すべき。
2. **`packages/analysis/src/scdl-map.ts`**: `mapElements` が `Object.entries(elementIds).find(...)` を制約条件ごとに呼ぶ(O(N×M))。規模が大きいと遅い(性能は B2 の範囲)。`from-graph.ts` の `lookupName`・`buildElement` も `find` の線形探索。
3. **`packages/analysis/src/analyze.ts`**: 要素 ID は完全修飾名で、整形の `shortName` は `::` で分割するだけ。引用符つきの名前に `::` を含む場合(`'a::b'` という part 名)は誤って切れる(`trace.ts` の `shortName`)。軽微だが、敵対的名前に弱い。
4. **`tools/sysml-check/SysmlExtract.java`**: `valueOf` が式を `"<LiteralInteger>"` のような文字列にして返す(数値属性など)。SCDL の `weight` 以外の属性は未対応のまま黙って文字列化される。
5. `docs/adr/0008` の「導出する/しない」の線引き(故障ノードは人が確定、AI は提案)は MBSE として妥当で、良い判断。

---

## 最終サマリ

- **A1: 74(外部確認待ち減点 5、合否点 79)**
- **B3: 76(外部確認待ち減点 5、合否点 81)**
- **C2: 73(外部確認待ち減点 7、合否点 80)**
- 実行で確認できた強み: 公式実装での検証(`run.sh` 全件警告ゼロ)、SCDL 書き出し⇄読み込みの敵対的往復が両経路で完全一致、未対応構文を捨てない設計、スナップショットの鮮度保証、全テスト合格。
- 重大な弱み: SysML の一般的な書き方(def・型付き usage・`perform action x : Def`)で導出が空/誤り(一部は無警告)、SCDL ビューが元モデルへの追跡を持たない並行コピーで正本が 2 つ、影響分析が SysML の関係に基づかない。

### 上位 5 件の修正

1. `tools/sysml-check/SysmlExtract.java` + `packages/sysml-graph/src/derive.ts`: part def/action def 配下の誤導出(無警告で最上位に混入)を止め、型付き usage の展開と `perform action x : Def` に対応する。未対応は必ず警告する。
2. `packages/analysis/src/scdl-map.ts` + `packages/scdl/src/sysml-export.ts`: SCDL 出力から元モデルへの追跡(元の part・requirement への参照)と、並び順に依存しない安定した SCDL ID を導入する。SCDL の正本を一本化する(ADR-0007 に方針を記す)。
3. `packages/scdl/src/validate.ts` + `sysml-import.ts` + `from-graph.ts`: ID の全体一意の検査を追加し、`allocation` を完全修飾名で保持する(要求 X / 制約 X の配置の取り違えを解消)。親エレメントの決め方を 2 経路で揃える。
4. `packages/analysis/src/trace.ts` + `analyze.ts`: SysML 要求 ↔ 安全要求の紐づけ、要求変更からの影響波及(satisfy → part → 機能 → 故障 → FMEA/安全要求)、`satisfy` が action を指す場合の扱いを追加する。
5. `docs/adr/0008-*.md` と SysML v2 API(REST)/標準 JSON への対応方針: 未対応構成(def・型付き usage・ポート・接続・フロー・状態・allocation・特殊化)を正直に列挙し、互換性の計画を確定する。

### 外部確認待ち(合格時にも要実施)

- MBSE 専門家による G0 書面レビュー(ADR-0002/0007/0008、SCDL ステレオタイプの設計、階層規則)。担当: 外部 MBSE 専門家。
- 商用モデラ等、他の SysML v2 ツールでの SCDL ステレオタイプ・導出規約の読み込み確認。担当: MBSE 専門家 / ツール担当。
- ASAM SCDL v1.6.0 仕様書との突合(附属書 A の制約)。ライセンス条件の法務確認も含む。担当: 安全+MBSE ドメイン担当、法務。
