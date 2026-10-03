# ラウンド 4 レビュー: MBSE / SysML v2 専門家の観点(A1・B3・C2)

- 立場: 独立・厳格な MBSE / SysML v2 専門家(シミュレートしたレビュアー。認証機関ではない)
- 基準: `docs/quality/rubric.md`(証拠主義、未検証は減点、外部確認待ち減点は点数と別に最大 10 点)
- 対象リビジョン: `fc565e6`(ラウンド 3 への対応コミット)。リポジトリのソースは変更していない。
- 方法(すべて実行。`round-3-response.md` は鵜呑みにせず再検証):
  - `./tools/sysml-check/run.sh`: SCDL.sysml、examples 4 件、projects の model.sysml が公式実装 0.62.0(Java 21)でエラー・警告ゼロ(再現)。
  - `pnpm -r test`: 全パッケージ合格(safety-core 116 / sysml-graph 32 / scdl 50 / analysis 50 / web 19 / ai 29 / server 46、Java 結合 3 件のみ skip)。
  - 新規の敵対的モデルを公式抽出器(`SysmlExtract`)に通し、`deriveNet` / `analyzeProject` / `toScdl → exportSysml → PilotCheck → importSysml / scdlFromGraph` に流した
    (スクラッチパッド `.../scratchpad/m/` の `a3`〔ラウンド 3 の再実行〕、`b1`、`c1`、`d1`)。
    - b1: 定義の中の定義、定義内の入れ子 part の中の型付き usage、定義内 `ref part`(入れ子の中も)、多重度 `[4]` `[0..*]` `[2..*]`(定義内・最上位)、
      特殊化の連鎖 `Leaf :> Mid :> Base`、usage 特殊化 `lf2 :> lf`、深さ 3〜4 の名前なし再定義 `:>> box { :>> ww { :>> hub {...} } }`、
      型付き action の入れ子(`perform action top : Topa`、`Topa ⊃ Mida ⊃ Leafa`)、requirement def と入れ子 requirement、型付き requirement、
      再定義・型付きの経路を通る `satisfy`、複数パッケージ(複数の根)、引用符名・Unicode・絵文字・`#` を含む名前。
    - c1: 別パッケージの同名 part(`Dup`)、`'a/b'` という名前と `a { b }`、SCDL 側の ID(`IF-1`、`SRG-M1`)と衝突する part 名、`ID_COLLISION`。
    - d1: **定義の中の**再定義(`part def BigPack :> Pack { part :>> cells { part extra; } }`)。
  - `impactOfRequirementChange`(`packages/analysis/src/impact.ts`)、SCDL の ID(`scdl-map.ts`)、ADR-0007/0008/0009 をコードと突合。

---

## 総括

| 項目 | 採点 | 外部確認待ち減点 | 合否点 | 判定 |
|---|---|---|---|---|
| A1 機能要件(モデリング/トレーサビリティ/階層/SCDL の観点) | **85** | 5 | 90 | 合格(ぎりぎり。採点 80 以上) |
| B3 互換性・相互運用性 | **82** | 5 | 87 | **不合格**(合否点 90 未満。採点は 80 以上) |
| C2 MBSE 専門家の観点 | **84** | 6 | 90 | 合格(ぎりぎり。採点 80 以上) |

ラウンド 3 で指摘した無警告の展開の穴(C2-M1 定義内 `ref part` の混入、C2-M2 定義内の入れ子 part の中の型付き usage の欠落、C2-M3 名前なし再定義の ID)は、**実測で直った**。
入れ子 requirement の充足の継承、SCDL 要求の `modelRef`(安全要求の `refines`)も実測で入った。
一方、敵対的モデルで新たに「定義内の再定義が捨てられる」「最上位の多重度が無警告」「requirement def が展開されず幽霊要求ができる」
「複数パッケージの根の ID が並び順依存」「SCDL 側 ID と part 名の衝突で書き出し不能」が見つかった。標準の交換手段(SysML v2 API / JSON / XMI)は依然としてゼロで、B3 は動いていない。

---

## C2. MBSE 専門家の観点: 84 点(外部確認待ち減点 6)

### 確認できた長所(実測)
1. **ラウンド 3 の M1 修正**: a3 / b1 で `ref part`(定義内・定義内の入れ子 `box { ref part r2 }`)は構造に出ない(`UNSUPPORTED_CONSTRUCT` の警告のみ)。`Pack::charger` の子の混入は消えた。
2. **M2 修正**: a3 の `car1::aux::pack::{cells,bms}`、`car2::aux::pack::bms::chk` が展開され、`satisfy b by car2.aux.pack.bms.chk` が `car2::aux::pack::bms` に解決。b1 の `Outer ⊃ Inner`(定義の中の定義)・`o1::i::deep`・`o1::box::ww::hub` も展開。
3. **M3 修正**: 名前なし再定義の ID は再定義先の名前(`car1::pack`、`o3::box::ww::hub::hubx`)。深さ 4 の `:>>` 連鎖も正しい。
4. 特殊化の連鎖(`lf : Leaf` に `lz`・`my`・`bx`)、usage 特殊化(`lf2 :> lf { :>> my { myextra } }`)、型付き action の 3 段入れ子(`top ⊃ m ⊃ l1, l2` で `parentFunctionId` が正しい)も正しい。
5. 入れ子 requirement: `rb::nested1`、`rb::nested1::nested2` が親の `satisfy` を継承(`TRACE_UNCOVERED` から外れた)。
6. SCDL: b1 / a3 / c1 を `toScdl → exportSysml → PilotCheck`(エラー・警告ゼロ)→ `importSysml`(指摘 0、要素一致)、
   b1 は `exportSysml → 公式抽出 → scdlFromGraph` も要素・`modelRef`・`weight`・親子が一致。日本語・引用符・`#`・絵文字・`x.y` の ID でも往復した。

### 欠陥・減点(重大度順)

**[C2-N1 中・警告あり] 定義の中の再定義(`:>>`)が捨てられる。**
- d1: `part def BigPack :> Pack { part :>> cells { part extra; } part :>> bms { part mon; } }` の `v : Veh` で、`v::pack::cells::extra`・`bms::mon` が**出ない**。
  `expand.ts` の `expandInto` が `m.redefines` の usage を `REDEFINITION_IGNORED` で `continue` するため。同じモデルの usage 側の再定義(`v2 { :>> pack { :>> cells { ex2 } } }`)は展開される。
  その結果 `v` には `extra` が無く `v2` には `extra` がある、という不整合なインスタンスができ、`satisfy r1 by v.pack.cells.extra` は `SATISFY_UNRESOLVED`。
- 「サブタイプで継承した特徴を精緻化する」は SysML の最も標準的な書き方の一つ。警告は出るので「黙って」ではないが、実用上は構造・機能を欠く。
- ADR-0008 の表は「再定義 | 元の使用をそのまま使う | `REDEFINITION_IGNORED`」のままで、同じ ADR の「usage 側の再定義は引き継ぐ」と矛盾し、定義内/usage 内の区別が書かれていない。

**[C2-N2 中・無警告] 最上位の usage の多重度が無警告で無視される。**
- b1: `part wheels : Wheel[4]`、`part opt : Wheel[0..*]`、`part sym : Wheel[2..*]` はいずれも 1 インスタンスで、`MULTIPLICITY_IGNORED` は**定義内のメンバー**(`Outer::w`)にしか出ない
  (`expand.ts` の警告は `expandInto` のメンバー走査の中だけ)。ラウンド 3 応答文書の「多重度は警告」は最上位 usage では成り立たない。FMEA の構造数・SPOF 判定を黙って誤らせる。
- 付随: 同じ定義の再展開ごとに同一の警告が重複する(b1 の `Outer::w` で 3 件、a3 の `Pack::cells`/`charger` で各 15 件超)。重複排除が必要。

**[C2-N3 中・無警告] requirement def が展開されない(幽霊要求と本文の欠落)。**
- b1: `requirement def Rd { doc /* d */ requirement subA {doc /* a */} requirement subB; }` と `requirement ra : Rd;` で、
  - `Rd::subA`、`Rd::subB` が**独立した要求**として導出され、`REQUIREMENT_NOT_SATISFIED` と `TRACE_UNCOVERED` を出す(定義の中身が要求の行になる)。
  - `ra : Rd` に入れ子(`ra::subA`)は複製されず、`Rd` の doc も本文に入らない(トレースの `text` が空)。
- part / action の定義は展開するのに requirement def だけ非対称。要求定義を使う標準的なモデルで、トレーサビリティの表が偽の未充足行で汚れ、本物の入れ子が欠ける。ADR-0008 に記載なし。

**[C2-N4 中] SysML の入れ子 requirement が影響分析に接続されていない(ラウンド 3 の M4 の残り)。**
- c1: `impactOfRequirementChange(C1::reqA)` の `requirements` に子 `C1::reqA::sub1` は入らない。`sub1` の変更の `upstream` に親 `reqA` も入らない(`impact.ts` の `requirementRelations` が `safety.json` の `refines`/`parentId`/分解のみを読み、`DerivedRequirement.parentId` を読まない)。
  充足の継承(derive 側)は直ったが、影響の波及は未対応。`verify` / `derive` / `refine` の SysML 標準関係は依然として未導出で、ADR-0008 にも明記がない。

**[C2-N5 中] 複数パッケージ(複数の根)の SCDL ID が並び順依存で、パッケージ名が ID に入らない。**
- c1: `C2::Dup`→`Dup`、`C3::Dup`→`Dup#2`、`C1::'IF-1'`→`IF-1`、`C2::'IF-1'`→`IF-1#2`。ファイルの並び順(パッケージ宣言の順)が入れ替わると `Dup` と `Dup#2` が入れ替わる。
  `a { b }` と `part 'a/b'` では `a/b` / `a/b#2` が名前の区切り `/` の曖昧さで並び順依存になる。
  ADR-0007 追補の「根の追加・兄弟の並べ替えで変わらない」は、同名の根(別パッケージ)・`/` を含む名前で成り立たない(ADR は「同名の兄弟」の例外しか書いていない)。
  複数パッケージ・複数チーム分割のモデルでは同名の根(`Vehicle`、`Brake` など)が珍しくない。

**[C2-N6 中] SysML の part 名が SCDL 側の ID と衝突すると、解析は通っても書き出しが不能になる。**
- c1: `part 'IF-1'`(意図機能 `IF-1` と衝突)、`part 'SRG-M1'`(`SRG-M1` グループと衝突)で `ID_COLLISION`(error)。`validateScdl` は検出するが、エレメント ID を自動で衝突回避(接頭辞・名前空間)しないため、
  利用者はモデルの part 名か `safety.json` の ID を直すしかない。サーバーは 409 で書き出しを拒否する。「黙って壊れない」点は良いが、MBSE 専門家は ID 名前空間の設計(例: `E:` 接頭)を求める。

**[C2-N7 軽・堅牢性] 要素に `qualifiedName` が無いグラフで `analyzeProject` が例外で落ちる。**
- c1 の初版(同じパッケージ内で part と requirement が同名 `'IF-1'`、Pilot が Duplicate の警告を出す不正モデル)で、抽出器は `qualifiedName` 無しの `RequirementUsage` を出し、
  `buildTrace → shortName` が `TypeError: Cannot read properties of undefined (reading 'split')` を投げた。入力検証(グラフのスキーマ検査)か、`qualifiedName` 無しの要素の除外と指摘が必要。

**[C2-M5/M7 軽・継続] 影響分析の末尾で「影響要素に配置された要求」が下位に混ざる**(c1: `reqA` の下位に `FSR-1`。ただしこの例では `refines` 経由でも正しい)。方向性そのものは機能。
同名兄弟の `#n` の並び順依存(ADR-0007 追補に例外として記載済みで、正直)。

### 外部確認待ち減点: 6 点
MBSE 専門家による G0 の書面レビュー(ADR-0007/0008 の導出規約、SCDL ステレオタイプ設計、展開規約、階層規則)と、他の SysML v2 ツールでの解釈確認が未実施。担当: 外部 MBSE 専門家 / ツール担当。

---

## B3. 互換性・相互運用性: 82 点(外部確認待ち減点 5)

### 確認できた長所
- 公式実装(固定版)で `run.sh` が再現でき、SCDL の出力(b1 / c1 / a3)も PilotCheck で警告ゼロ。特殊文字・Unicode・引用符名の往復も成立。
- 両経路(`exportSysml → importSysml`、`exportSysml → 公式抽出 → scdlFromGraph`)で b1 の要素・`modelRef`・`weight` が一致。
- `satisfy` の連鎖(`byChain`)、`ref`、型付き・特殊化・再定義(usage 側)の解釈は、公式実装の出力に基づいていて堅い。ADR-0009 は「できないこと」を正直に書いている。
- サーバーは SCDL にエラーがある間は書き出しを拒否(409)。

### 欠陥・減点
- **標準の交換手段(SysML v2 API・標準 JSON・XMI)は依然ゼロ**。ADR-0009 は方針の記述のみで、実装の進捗なし。他ツールとの交換は `.sysml` テキストのみ。(-8)
- 入力できる SysML の範囲: 定義内の再定義の欠落(C2-N1)、最上位の多重度の無警告(C2-N2)、requirement def の非展開(C2-N3)、port / connection / flow / state / allocation は警告のみで取り込まない。(-6)
- 複数パッケージの根の ID が並び順依存、part 名と SCDL の ID の衝突で書き出し不能(C2-N5/N6)。他ツールが生成した別パッケージ構成のモデルを継続的に取り込む場面で不安定。(-2)
- `@Scdl*` ステレオタイプ・`modelRef` 拡張が他ツールで読めるか、ASAM SCDL 仕様書との突合の証跡は未確認(外部確認待ちに計上)。(-1)
- jar の第三者ライセンス棚卸しの証跡が、今回もリポジトリ内に見つからない。(-1)

### 外部確認待ち減点: 5 点
他ツール(商用モデラ、他の SysML v2 実装)での SCDL ステレオタイプ読み込み確認、ASAM SCDL v1.6.0 仕様書との突合(法務確認を含む)。担当: MBSE 専門家 / ツール担当 / 法務。

---

## A1. 機能要件の充足度(モデリング/トレーサビリティ/階層/SCDL の観点): 85 点(外部確認待ち減点 5)

| チェック項目 | 状況 | 所見 |
|---|---|---|
| SysML v2 準拠のモデリング(読み込み・検証・編集・書き出し) | 概ね達成 | 公式実装で検証。型付き・特殊化・usage 再定義・深い入れ子が読める。定義内の再定義と requirement def が弱い。 |
| システム階層をモデルから自動生成 | 概ね達成 | 入れ子 4 段、定義の中の定義、入れ子 part の中の型付き usage まで自動。多重度は 1 個扱い(最上位は無警告)。 |
| トレーサビリティ(マトリクス・影響分析・整合性チェック) | 概ね達成 | 経路つき `satisfy`、入れ子 requirement の充足継承、方向つき影響分析。入れ子 requirement が影響分析に未接続、requirement def で偽の未充足行。 |
| ASAM SCDL ビュー | 達成(穴あり) | `modelRef` 往復、ID 衝突検出、エラー時 409。複数パッケージの根の ID が順序依存、part 名と SCDL ID の衝突を自動回避しない。 |

### 影響分析の再確認
- 方向(下位 / 上位 / 相手)は機能。ただし SysML 入れ子 requirement の親子を読まない(C2-N4)。

### 減点理由
- 展開の穴(定義内の再定義、最上位の多重度の無警告、requirement def): -6
- 入れ子 requirement が影響分析に未接続、SysML 標準関係(derive/refine/verify)なし: -3
- SCDL の ID 設計(複数の根の順序依存、衝突の自動回避なし)、不正グラフでの例外: -3
- ほか(影響分析末尾の混入、7 ステップ外の本観点では対象外のため除く)、仕様書との突合の証跡なし: -3

### 外部確認待ち減点: 5 点
専門家レビュー・他ツールでの確認・SCDL 仕様の突合。

---

## 実務の MBSE 担当者がまだ拒否する点

実装上の欠陥(直せる):
1. サブタイプの定義の中で継承特徴を再定義する書き方が反映されない(C2-N1)。
2. `Wheel[4]` のような配列が 1 個になり、最上位では警告も無い(C2-N2)。
3. requirement def を使うと、定義内の要求が幽霊要求になり、型付き要求に中身が入らない(C2-N3)。
4. 複数パッケージ・複数の根でエレメント ID が並び順依存、`IF-1` のような名前と衝突して書き出し不能(C2-N5/N6)。
5. 入れ子 requirement を変えても影響分析が子・親を出さない(C2-N4)。

標準交換の欠如(実装ではなく範囲の問題。文書化済み):
- SysML v2 API(REST)・標準 JSON・XMI の入出力がない。SCDL ステレオタイプは独自のメタデータ定義で、他ツールでの解釈は未確認。
- port / connection / interface / flow / state / allocation を解析に使えない(インターフェースや状態からの故障モードが出ない)。警告はある。

---

## 優先修正(ファイル単位)

1. `packages/sysml-graph/src/expand.ts`(C2-N1): `expandInto` の `m.redefines` 分岐で継承特徴の再定義を捨てず、元の使用の複製に子を統合する(usage 側の再定義と同じ経路)。回帰: d1(`v::pack::cells::extra` と `bms::mon` が出て `r1`/`r3` が解決)。`REDEFINITION_IGNORED` は本当に解決不能なときだけ。
2. 同(C2-N2): 最上位の usage(`run()` の `expandInto` の呼び出し側)にも `multiplicityUpper > 1` の `MULTIPLICITY_IGNORED` を出す。警告は `(code, ref)` で重複排除。理想は `[n]` を `name[1..n]` に展開。
3. 同と `derive.ts`(C2-N3): `RequirementDefinition` を展開対象にし(入れ子 requirement と doc を `ra : Rd` に複製)、定義内の requirement を導出対象から外す。回帰: b1 の `Rd::subA` が要求行に出ないこと。
4. `packages/analysis/src/scdl-map.ts`(C2-N5/N6): 根の ID にパッケージ名を含めるか、衝突時に完全修飾名ハッシュ等の安定な接尾辞を使う。エレメント ID を要求 / グループの ID と別の名前空間(接頭辞)にして `ID_COLLISION` を構造的に避ける。名前内の `/` は無害化。
5. `packages/analysis/src/impact.ts`(C2-N4): `DerivedRequirement.parentId` を `requirementRelations` に加える。`verify`/`derive`/`refine` の扱いを ADR-0008 に明記。
6. `packages/analysis/src/trace.ts` と `packages/sysml-graph/src/types.ts`(C2-N7): グラフの入力検証(`qualifiedName` 必須)か、`shortName` の防御。
7. `docs/adr/0008`・`0007`: 再定義の表(定義内/usage 内)、多重度、requirement def、複数の根の ID の例外を実装に合わせて修正。
8. `docs/adr/0009` の実行(B3 の最大要因): SysML v2 API / 標準 JSON の入出力、jar の第三者ライセンス棚卸し。

---

## ラウンド 3 の指摘 → ラウンド 4 での確認

| ラウンド 3 の指摘 | 判定 | 実測の根拠 |
|---|---|---|
| C2-M1 定義内 `ref part` が構造の子になる | **修正済み** | a3 / b1: `Pack::charger`、`Outer::shared`、`box::r2` は構造に出ず、警告のみ |
| C2-M2 定義内の入れ子 part の中の型付き usage が展開されない | **修正済み** | a3: `car1::aux::pack::{cells,bms,bms::chk}`。b1: `Outer::i::deep` |
| C2-M2 配列多重度の無警告 | **一部のみ** | 定義内メンバーは `MULTIPLICITY_IGNORED`(重複して多数出る)。最上位の `wheels : Wheel[4]` 等は無警告(C2-N2) |
| C2-M3 名前なし再定義の ID が完全修飾名 | **修正済み** | `car1::pack`、`o3::box::ww::hub::hubx` |
| C2-M4 入れ子 requirement が充足判定に使われない | **修正済み** | `rb::nested1`/`nested2` が親の `satisfy` を継承 |
| C2-M4 入れ子 requirement が影響分析に使われない | **未修正** | `impact(reqA)` の下位に `reqA::sub1` なし(C2-N4) |
| C2-M4 verify / derive / refine の標準関係 | **未修正** | 導出なし、ADR にも明記なし |
| C2-M5 影響分析の末尾に配置要求が混ざる | **未修正(軽微)** | `impact.ts` 末尾の処理はそのまま。方向性は機能 |
| C2-M6 SCDL 要求に `modelRef` がない | **一部修正** | 安全要求の `refines` が要求の `modelRef` に入る。SysML の requirement そのものは SCDL の要求にならない(正本 2 つは ADR-0007 追補に明記) |
| C2-M7 同名兄弟の ID の順序依存 | **未修正(ADR に例外として明記)** | 複数パッケージの同名の根にも波及(C2-N5) |
| B3 標準の交換手段(API/JSON/XMI) | **未修正** | ADR-0009 に明記、実装なし |
| B3 jar の第三者ライセンス棚卸し | **未確認** | 証跡なし |
| ラウンド 2 の `satisfy` 経路・特殊化・安定 ID・方向つき影響分析 | **修正済み(維持)** | b1 / a3: 経路・同名別経路・特殊化インスタンスを区別 |
| ID 衝突(種類をまたぐ) | **検出は維持** | `ID_COLLISION` を再現。回避の自動化はなし(C2-N6) |
| 応答文書「多重度は警告、ref は除外」 | **部分的に成立** | 定義内では成立。最上位の多重度では不成立 |
| 応答文書「名前のない再定義」 | **usage 側のみ成立** | 定義内の再定義は `REDEFINITION_IGNORED` で捨てられる(C2-N1) |

## 外部確認待ち(合格時にも要実施)

- MBSE 専門家による G0 書面レビュー(ADR-0007/0008、SCDL ステレオタイプ、展開規約、階層規則)。担当: 外部 MBSE 専門家。
- 他の SysML v2 ツール(商用モデラ等)での `@Scdl*` ステレオタイプ、`modelRef` 拡張、導出規約の読み込み確認。担当: MBSE 専門家 / ツール担当。
- ASAM SCDL v1.6.0 仕様書との突合(附属書 A)とライセンスの法務確認。担当: 安全 + MBSE ドメイン担当、法務。

## 最終サマリ

- **A1: 85(減点 5、合否点 90 = 合格)/ B3: 82(減点 5、合否点 87 = 不合格)/ C2: 84(減点 6、合否点 90 = 合格)**。3 項目とも採点は 80 以上。
- ラウンド 3 の無警告の欠陥(M1〜M3)は解消。残る課題は、定義内の再定義、最上位の多重度、requirement def、複数の根の ID 設計、入れ子 requirement の影響分析、
  そして B3 を縛る標準交換手段(SysML v2 API / JSON / XMI)の欠如。B3 を 90 以上の合否点にするには、標準交換の実装(または公式 API 経由の入出力)が事実上必須。
