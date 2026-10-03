# ラウンド 8 レビュー: MBSE / SysML v2 専門家の観点(A1・B3・C2)

- 立場: 独立・厳格な MBSE / SysML v2 専門家(シミュレートしたレビュアー。認証機関ではない)
- 基準: `docs/quality/rubric.md`(証拠主義、未検証は減点、外部確認待ち減点は点数と別に最大 10 点、採点そのものも 80 以上)
- 対象リビジョン: `61439b1`(`fix: round-7 review findings`)。リポジトリのソース・テスト・文書は変更していない(作業物はスクラッチ `r8/mbse/` のみ)。
- 方法: `round-7-response.md` は信用せず、すべて再実行・再現した。
  - `pnpm typecheck` / `pnpm lint` / `pnpm -r test`(safety-core 144 / sysml-graph 44 / scdl 50 / analysis 64 / ai 40 / web 20 / server 78 + skip 11)/ `FUSAMOD_IT=1 pnpm --filter @fusamod/server test`(89 件合格)/ `./tools/sysml-check/run.sh`(SCDL.sysml・examples・model.sysml 全件 errors=false warnings=false)。すべて合格。
  - サーバーは `esbuild` でスクラッチに同梱ビルドして別ポートで実行(`FUSAMOD_SYSML=java`)。タイムアウト実験用に、同梱物のコピーだけ `requestTimeoutMs` を 60 秒から 3 秒に書き換えた版(スクラッチ内のみ)を使用。終了時にサーバーと JVM を PID 指定で止め、残存なしを確認。
  - 自作モデル: 3,000 part(`big`)、`n7`/`n7b`(`part def` 所有の requirement、相対経路、特殊化、`requirement def` の型付き使用)、`va`〜`vd`(再定義との組み合わせ)、`fn`(typed action・perform・入れ子 action)、`ex1`〜`ex3`(port / interface / connection / state / allocate / verify / derive)、`scd1`(特殊な名前の SCDL)、`unit`、`lib1`〜`lib3`(ライブラリ import)。
  - 公式チェック: `PilotCheck` を自分で起動し、`SCDL.sysml` と同一セッションで、書き出した `scdl.sysml` を検査。

---

## 総括

| 項目 | R7 採点 | R8 採点 | 外部確認待ち減点 | 合否点 | 判定 |
|---|---|---|---|---|---|
| A1 機能要件の充足度(MBSE 観点) | 89 | **90** | 5 | 95 | 合格(採点 80 以上) |
| B3 互換性・標準とのデータ交換 | 85 | **87** | 5 | 92 | 合格(採点 80 以上) |
| C2 MBSE 専門家の観点 | 89 | **90** | 5 | 95 | 合格(採点 80 以上) |

第 7 回の指摘のうち、**N6(孤児 JVM)、タイムアウト分類(エクスポート全種と AI)、X1/X3/X5(ライブラリを変換器に渡す)、N7(`part def` 所有の requirement と相対経路 `front.brake`)は実測で修正を確認**した。
一方で、修正の「検証の穴」に新たな欠陥を見つけた。最重要は次の 3 点。

1. **[N8 中〜高] 無関係な編集で、`satisfy` の関係要素の ID が互いに入れ替わる(沈黙の誤り)。** 同梱の ev-powertrain の末尾に `part zzz;` を足しただけで、4 つの `SatisfyRequirementUsage` の ID が REQ-001〜004 の間で入れ替わる。「ID は 95% 以上不変」という統合テストは通るが、不変でないのは「トレーサビリティの関係そのもの」である。
2. **[N9 中] 「同じモデルの 2 回の出力がバイト単位で一致する」は同梱 9 例のうち 2 例(all-stereotypes、redundant-architecture)で成り立たない。** ADR-0009 X4 の「同梱のモデルでは一致」は誤り。さらに JSON と XMI で標準ライブラリ要素の ID が食い違い(`Real`)、SCDL を含む XMI は毎回変わる UUID の `href` で、配布されないファイルを指す。
3. **[N10 中] 利用者が `.sysml` に書いた `@Scdl*` は、解析にまったく反映されず、警告も出ない。** ADR-0007 は `scdlFromGraph` を「本番の読み込み経路」と書くが、本番コードのどこからも呼ばれていない。同梱の all-stereotypes を読み込むと SCDL ビューは「エレメント 4・要求 0・ペア 0」になる。

---

## 1. 第 7 回の指摘の再検証(実測)

### 1.1 N6: 捨てた JVM の exit イベント(孤児 JVM) — **修正を確認**

再現: スクラッチ版(タイムアウト 3 秒)で、3,000 part・156KB の `big` の `export/model.json` と、小さなモデルの解析を交互に 3 回繰り返し、サーバーの子プロセスを `ps --ppid` で監視。

| 手順 | 結果 |
|---|---|
| `big` の JSON(タイムアウト) | 504(約 3 秒)。直後の子プロセス 0(kill 済み) |
| 次の小さな解析 | 200(約 7.5 秒、コールドスタート)。子プロセス**ちょうど 1 個** |
| 上を 3 回繰り返し | 毎回「0 個 → 1 個」。2 個に増える現象なし(R7 では 2 個) |
| サーバー終了(SIGTERM) | サーバー・JVM とも残らない |

コード(`java-service.ts`)も `stale()`(`this.proc !== proc`)が `error`/`exit`/`stdin`/`line` の全ハンドラにある。回帰テスト `fake-processes.test.ts` も合格。

### 1.2 タイムアウト分類(504 / 503 / 429 / 409) — **ほぼ修正。1 か所不一致**

`big`(タイムアウトする)に対して全エクスポートと AI を実行:

| 要求 | 結果 |
|---|---|
| `export/model.json` `model.xmi` `fmea.csv` `trace.csv` `issues.csv` `report.md` `scdl.sysml` `analysis.json` | すべて **504** |
| `POST ai/chat` | **504** |
| `GET /api/projects/big` / `POST analyze` | 200(`modelOk:false`、`sysmlError` に理由)。ADR-0009 X6 の記載どおり |
| 誤りモデル(`bad`) | 409(R7 から維持) |
| 12 件並行の解析(小さなモデル) | すべて 200(待ち上限 8 は小モデルでは到達せず。429 は変換側の 10 並行で 6 件 200 + 4 件 429 を確認、一時ディレクトリ 0) |

**不一致**: 変換器そのもののタイムアウト(`convert.ts` の 180 秒)は `SysmlUnavailableError`(**503**)で返る。`convertModel(…, {timeoutMs: 800})` を実行して `SysmlUnavailableError 変換がタイムアウトしました` を確認。「解析のタイムアウトは 504」という ADR-0009 X6 の記述と、変換のタイムアウトが 503 であることがずれている(軽微)。

### 1.3 X1 / X3 / X5(ライブラリを変換器に渡す) — **修正を確認。ただし新たな問題あり**

| 試験 | 結果 |
|---|---|
| ev-powertrain の JSON | 227 要素・ID 227 種。参照の未解決 0、`identity.@id` と `elementId` の不一致 0。`Real` は `DataType`(`declaredName: "Real"`、`isLibraryElement: true`)として名前つきで出る。名前なしの `Type` スタブ 0 |
| ev-powertrain の XMI | `href="ScalarValues.kermlx#904d28f1-…"`(8 件)と `…#f30273bb-…`(1 件)。`model.sysml#\|0` 形式は消えた |
| `unit.sysml`(`ISQ::*` `SI::*` と `[kg]` `[km/h]`) | JSON・XMI とも 200。JSON 67 要素・参照未解決 0。XMI は `ISQ.sysmlx` `SI.sysmlx` などへの `href`。所要 15〜27 秒(ADR の「約 15 秒」どおり、負荷時はそれ以上) |
| `all-stereotypes.sysml`(`import SCDL::*`) | JSON・XMI とも 200(R7 では JSON が 422)。JSON 589 要素 |
| `lib1`(`ScalarFunctions` `Collections`) | JSON・XMI とも 200 |

新たな問題:

- **[N10b 中・B3] JSON と XMI で、標準ライブラリ要素の ID が食い違う。** 変換器の生の出力(`convert.sh json` を直接実行)では `ScalarValues::Real` の ID は `904d28f1-df99-5ef5-bb01-00fad2e84d26`(変換器が決定的に付ける標準の ID)。XMI の `href` もこの ID を使う。ところが本ツールの JSON は `stabilizeJsonIds` が**ライブラリ要素まで FuSaMod 独自の UUID に置き換える**(`Real` → `2c8ec8eb-…`、`ScalarValues` → `ac35fb1f-…`)。同じモデルの JSON と XMI で、`Real` の同一性が一致しない。他ツール(公式 API サーバーなど)が持つ標準ライブラリの ID とも合わない。`grep -c 904d28f1 a.json` = 0、`a.xmi` = 8。
- **[B3 低〜中] SCDL を含むモデルの出力に未解決参照が残る。** `all-stereotypes` の JSON には、`LibraryPackage SCDL` の `owner` / `owningRelationship` が指す要素が出力に無く、未解決参照が 2 件ある(ev-powertrain は 0)。XMI は `href="SCDL.sysmlx#<UUID>"` を 20 件持つが、**`SCDL.sysmlx` は配られず**、さらに UUID が実行ごとに変わる(2 回の出力の `href` 集合が全件異なる)。他ツールで開いても参照を解決できない。
- **[B3 低・性能] ライブラリ追加の判定が緩い。** `convert.sh` の `grep -E '…|\[ *[A-Za-z]+'` は、`doc /* see [RFC] for details and [x] */` のようなコメントの `[RFC]` でも単位系ライブラリを読み込む。`lib2`(コメントに `[RFC]` を書いただけの 2 行のモデル)の変換が JSON 25 秒・XMI 39 秒(通常は 4〜5 秒)。同時 2 件の変換枠を長時間占有し、429 を起こしやすくする。

### 1.4 ID の安定化 — **一部のみ修正(重大な穴あり)**

| 検証 | 結果 |
|---|---|
| ev-powertrain の JSON を 2 回 | **バイト一致**(`cmp` 一致) |
| `unit.sysml` を 2 回 | バイト一致 |
| 同梱の examples 9 例を 2 回ずつ(JSON) | **7 例は一致、2 例は不一致**: `all-stereotypes`(589 要素中 71 件の ID が入れ替わる)、`redundant-architecture`(1,067 要素中 81 件)。入れ替わるのは `Redefinition` `FeatureChaining` `Membership` `ReferenceSubsetting` `FeatureValue` など |
| XMI を 2 回 | 2 行目から異なる(`xmi:id` を置き換えない。ADR-0009 に記載済み) |
| 編集後(ev-powertrain の先頭に `part newFirst {…}` / 中ほどに `action` / 末尾に `part zzz;`) | 既存 227 件のうち 216 / 218 / 216 件の ID が不変(95% 前後。統合テストの基準は満たす) |

**[N8 中〜高] 不変でない側に、トレーサビリティの関係が集中する。** 末尾に `part zzz;` を足しただけ(再現手順は §1.4 末尾)の前後で、4 つの `SatisfyRequirementUsage` の ID が指す要求が入れ替わった:

```
編集前: 64f87047→REQ-001  94aa5a1b→REQ-003  c7e7b450→REQ-004  e7745060→REQ-002
編集後: 64f87047→REQ-002  94aa5a1b→REQ-004  c7e7b450→REQ-003  e7745060→REQ-001
```

つまり**同じ ID が別の satisfy 関係を指す**。「ID が消える」のではなく「別のものを指す」ので、版管理・差分・外部ツールでの追跡を黙って壊す。`ReferenceSubsetting`(満たす要求への参照)と `FeatureChaining`(`by` の経路)の ID も一緒にずれる(編集のたびに 3〜4 組)。
原因(`stable-ids.ts` のコード読解と一致する実測): 名前のない `satisfy` 使用は、同じ所有者・同じ種類・同じ(空の)名前のため、鍵が `…/SatisfyRequirementUsage:#n` となり、`n` は「Weisfeiler-Lehman 署名の順」で決まる。署名は 6 回の反復で所有者(パッケージ)全体の内容を取り込むため、無関係な部品の追加で並びが変わる。名前のない関係要素の鍵に、参照先の名前(`REQ-001`)を入れる設計なのは `ReferenceSubsetting` までで、`SatisfyRequirementUsage` 自身の鍵は参照先を含まない。
修正の方向: `SatisfyRequirementUsage` などの無名の使用は、子の `ReferenceSubsetting` の参照先名と `by` の連鎖の名前を鍵に含める。回帰テストは「`satisfy` の ID → 要求名の対応が、編集の前後で不変」を直接検査する(95% の割合ではなく)。

再現(N8): `curl` で `projects/ev-powertrain/model.sysml` の最後の `}` の直前に `    part zzz;` を足したモデルを別プロジェクトに作成 → 両方の `GET export/model.json` を取得 → `SatisfyRequirementUsage` ごとに子孫の `ReferenceSubsetting.target` の `declaredName` を比べる。

**[N9 中] ADR-0009 X4 の「同梱のモデルでは、2 回の出力がバイト単位で一致」は不正確。** 統合テストが検査するのは 1 モデルだけ(ev-powertrain)。上の 2 例(うち all-stereotypes は SCDL の例で、本ツールが自ら「同梱」として推す例)で再現する。「完全に対称な要素の入れ替わり」では説明できない規模(7〜12%)。

### 1.5 N7: `part def` が所有する requirement と `satisfy` — **修正を確認(一部の組み合わせに穴)**

`n7`(R7 の `r7e` 相当): 3 インスタンスの `Car` に対し、

- `trace.cells`: `c1::inCar → c1`(暗黙の subject)、`c1::inCar2 → c1::front`(`by front`)、`c3::extra → c3::front::brake`(使用側の相対経路 `front.brake`)。各インスタンスに複製され、未カバー 0。`REQUIREMENT_NOT_SATISFIED` なし。**R7 の 3 つの誤りはすべて解消**。
- `n7b`: 特殊化(`Truck :> Car`)で継承した requirement の複製、`requirement def` の型付き使用(`r1 : ReqD`)の入れ子 `inner`、多重度 `Car[2]` の警告も正しい。

**残る穴(警告は出るが、事実と異なる/不完全):**

- **[N7b 中] 使用側で再定義すると、定義内の `satisfy` が効かず、警告文が事実と異なる。** `va`: `part c : Car { part :>> front { part extra; } }`(定義内に `satisfy r1 by front.brake`)→ `c::r1` が未カバー、`SATISFY_UNRESOLVED`(`part :>> front;` だけでも同じ)。`vb`: `part c : Car { requirement :>> r1 {…} }` → `c::r1` 未カバー、**`SATISFY_NO_INSTANCE`「その定義を使う part がありません」**(`Car` は `c` が使っている。R7 の N7 で指摘したものと同種の誤った文)。SysML では再定義した特徴にも定義側の `satisfy` が及ぶので、これは意味の欠落。`part :>> front` は実務で頻出する書き方。
- **[N7c 低] 定義内の入れ子 requirement への `satisfy outer.nested by front`** は、すべてのインスタンスで `SATISFY_UNRESOLVED`(要求側の経路を、定義の中では解決しない)。インスタンス側(`r1::subB::deep`)は R7 の N2 修正で動く。警告の `ref` は定義側(`Car::outer::nested`)で、どのインスタンスの話か分からず、インスタンス数だけ同じ文が並ぶ。

---

## 2. 新たな欠陥・沈黙の誤り(自作モデル)

### 2.1 導出(構造・機能・要求トレース)

| 検証 | 結果 |
|---|---|
| part 入れ子 → 構造(`n7`, `fn`) | 正しい。型付き使用は `<使用>::<名前>` に複製、多重度は警告つきで 1 つ |
| action + perform → 機能(`fn`) | `perform action sense : Sense`(定義内)→ `s1::sense`・`s2::sense`。入れ子 action の親子(`judge::flt`)。`perform sys.top.sensing`(別 part から)→ 担当 `other`。`FUNCTION_NOT_DECOMPOSED` も妥当 |
| satisfy → 要求トレース(`n7`) | 要求側・満たす側の相対経路とも正しい(R7 の N2 修正は維持) |
| 公式パーサーの診断 | `fn`・`n7b` で `Duplicate of inherited member name …` の警告(公式実装由来。`modelOk:true` のまま)。FuSaMod の誤りではない |

### 2.2 サポート外の構成の扱い(`ex1`〜`ex3`)

| 構成 | 結果 | 評価 |
|---|---|---|
| port / interface / connection / state / `ref part` | `UNSUPPORTED_CONSTRUCT`(種類ごと、件数と例つき) | 適切 |
| 名前つき `allocation alloc1 allocate a to b;` | `UNSUPPORTED_CONSTRUCT`(allocation) | 適切 |
| **名前なし `allocate sys.a to sys.b;`**(標準的な書き方) | **`INVALID_ELEMENT`「完全修飾名の無い要素が 1 件あります(同じ名前の重複など、モデルの誤りの可能性)」** | 誤誘導(モデルの誤りではない。ADR-0008 の「allocation は UNSUPPORTED」と不一致) |
| `verify R1;`(verification case)・`dependency derive from R2 to R1;` | **警告も説明もなし**。`R2` は `TRACE_UNCOVERED`/`REQUIREMENT_NOT_SATISFIED` と表示され、`derive` の関係があることは出ない | 沈黙の欠落(ADR-0008 に「導出していない」とは書いてあるが、ツールの出力には出ない) |

### 2.3 SCDL(import / export の往復、公式チェック)

- `ev-powertrain` `scd1`(`'ECU 1'/'Sub/B'`・`'it\'s'`・日本語・同名の子 `Sub-A` が 2 つの親にある、`"` を含む title)`n7b` `allst`: `export/scdl.sysml` → `exportSysml` → `importSysml` で**モデルが一致**(5 件。ev-powertrain の差は JSON のキー順のみ)。`PilotCheck`(`SCDL.sysml` と同一セッション)で `rt_*.sysml` `sc_*.sysml` はすべて errors=false warnings=false。
- 特殊な名前でも ID は一意(`ECU 1/Sub-A` と `ECU 2/Sub-A`)。`'Sub/B'`(1 要素)と `a::b`(入れ子)の ID 表記が `/` で曖昧になる点は R7 から継続(軽微)。

**[N10 中・A1/C2] 利用者が書いた `@Scdl*` は反映されない(沈黙の誤り)。**
`examples/sysml/all-stereotypes.sysml`(4 要求・3 制約・グループ 2・ペアリング・無干渉・制約ペアリングを `@Scdl*` で記述)を読み込んだプロジェクトの `analysis.scdl` は `{elements: 4, requirements: 0, constraints: 0, interactions: 0, groups: 0, …: 0}`、SCDL の指摘も 0。`@ScdlRequirement { isExternal = true; }` を付けた `'X-IN'` は `REQUIREMENT_NOT_SATISFIED`/`TRACE_UNCOVERED` と報告される。
ADR-0007 は `scdlFromGraph` を「**本番の読み込み経路**」と書くが、`grep -rn scdlFromGraph packages apps`(テスト以外)では `index.ts` の再エクスポートしかなく、本番(`analysis/scdl-map.ts` の `toScdl(net, safety)`)は `@Scdl*` を見ない。同じ ADR の追補に「正本は 2 つ(SysML + safety.json)。人が `@Scdl*` を直接編集して正本にする運用は想定しない」とあるので設計判断としては矛盾していないが、(a) 「本番の読み込み経路」の記述が事実と異なる、(b) `@Scdl*` を書いたモデルを入れても**警告なしで無視される**、(c) 同梱の例 `all-stereotypes` が、読み込むと空に近い SCDL になる、は利用者を誤導する。警告(`SCDL_ANNOTATION_IGNORED` など)を出すか、`scdlFromGraph` を取り込み経路として使うべき。

### 2.4 既知の制約(別枠で評価)

- N4(SCDL ID の名前ベースの不安定)、`modelRef` が文字列のみ、取り込み(JSON/XMI/API)未対応: ADR に記載のとおり継続。
- 影響分析が要求起点のみ(構造要素から要求・FMEA への逆方向なし)。

---

## 3. ADR-0008 / 0009 の記述と実装・実測の一致

| 記述 | 判定 |
|---|---|
| ADR-0009 X1「`Real` は名前つきの DataType に解決、XMI の `href` は `ScalarValues.kermlx#<UUID>`」 | 実測と一致。ただし JSON の `Real` の ID は XMI と異なる(N10b、未記載) |
| ADR-0009 X3・X5「対応済み」 | 実測と一致(JSON/XMI とも 200)。SCDL を含む XMI の `href` が配布されないファイルを指す点、JSON の未解決参照 2 件は未記載 |
| ADR-0009 X4「**同梱のモデルでは、2 回の出力がバイト単位で一致**」「既存の ID の 95% 以上は変わらない」 | **誤り(2/9 例で不一致)**。95% は実測どおり(95.2%)だが、満たす関係の ID の入れ替わり(N8)が未記載 |
| ADR-0009 X6「解析がタイムアウトすると 504 … エクスポートと AI で共通」 | 解析は一致。変換のタイムアウトは 503(§1.2) |
| ADR-0008「定義の中の `satisfy` … 使用側から相対経路」「`SATISFY_NO_INSTANCE` は定義を使う part が無いときだけ」 | 再定義した使用では `SATISFY_NO_INSTANCE` が出る(N7b)。再定義との相互作用が未記載 |
| ADR-0008「`allocation` は `UNSUPPORTED_CONSTRUCT`」 | 無名の `allocate … to …` は `INVALID_ELEMENT`(§2.2) |
| ADR-0007「`scdlFromGraph` … 本番の読み込み経路」 | 誤り(§2.3) |

---

## 4. 項目別採点

### A1. 機能要件の充足度(MBSE 観点): **90 点**(外部確認待ち減点 5、合否点 95)

| チェック項目 | 状況 | 所見 |
|---|---|---|
| SysML v2 準拠のモデリング(読み込み・検証・編集・書き出し) | 達成(取り込みは .sysml のみ) | 公式実装で検証。標準 JSON/XMI の書き出しはライブラリ込みで通る(X1/X3/X5 解消) |
| システム階層をモデルから自動生成 | 達成 | 入れ子・型付き・特殊化・多重度警告・`part def` 所有の requirement の複製が正しい。再定義との組み合わせに穴(N7b) |
| トレーサビリティ(マトリクス・影響分析・整合性チェック) | 概ね達成 | N7 は修正。`verify`/`derive`/`refine` が沈黙で落ちる、関係要素の ID が編集で入れ替わる(N8) |
| ASAM SCDL ビュー | 達成(穴あり) | 公式検証・往復 OK。利用者の `@Scdl*` が黙って無視される(N10) |
| 標準形式のインポート/エクスポート | 一部 | 書き出しのみ。取り込み・API なし |

減点(合計 10 点): 取り込み・API 未対応 -2 / port・connection・allocation・state・`verify`・`derive`・`refine` が解析に使えない(うち `verify`/`derive` は無警告)-3 / SCDL ID の不安定(N4)-1 / 再定義と定義内 `satisfy` の穴・誤警告(N7b/c)-1 / `satisfy` の関係要素の ID の入れ替わり(N8)-1 / `@Scdl*` の黙った無視(N10)-1 / 要求起点のみの影響分析 -1。
R7 から +1: N6・N7 の修正、X1/X3/X5 の解消、タイムアウト分類の統一。ただし新たな欠陥(N8・N10・N7b)がそれを相殺。

### B3. 互換性・標準とのデータ交換: **87 点**(外部確認待ち減点 5、合否点 92)

- 前進: 標準ライブラリを追加入力に渡して、名前つきの `Real`・安定な XMI `href`・単位式・`@Scdl*` 付きモデルが JSON/XMI に変換できる(R7 の 85 の減点 -5 のうち大半を解消)。ev-powertrain の 2 回の出力がバイト一致。孤児 JVM の解消。504/503/429/409 の分類。変換の同時実行制限と一時ディレクトリの清掃は維持(10 並行で 200 が 6、429 が 4、残存 0)。
- 減点(合計 13 点): 取り込み(JSON/XMI/API)なし -4 / ID の安定化が不完全(同梱 2/9 例で非決定 7〜12%、`satisfy` の ID が編集で入れ替わる、XMI の `xmi:id` は毎回異なる)-3 / JSON のライブラリ要素の ID を書き換え、XMI と食い違う(N10b)-2 / SCDL を含む出力の未解決参照・配布されない `SCDL.sysmlx` への毎回異なる `href` -1 / ライブラリ追加判定の緩さで 25〜39 秒に(`[RFC]` のコメント)-1 / ADR-0009 の不正確(X4 のバイト一致、X6 と変換 503)-1 / 他ツールでの読み込み未確認・`modelRef` が文字列 -1(外部確認待ちと重複しない範囲)。
- 実務家の目では、JSON/XMI は「参照が閉じた、名前つきライブラリ付きの」実用的な出力になった。ただし**関係要素の ID の入れ替わりと、JSON/XMI 間のライブラリ ID の不一致**が残るので、版管理・差分・複数形式の突き合わせにはまだ使えない。

### C2. MBSE 専門家の観点: **90 点**(外部確認待ち減点 5、合否点 95)

- 長所: 定義内再定義、`requirement def`(型付き使用・特殊化・入れ子)、要求側/満たす側の両方のインスタンス経路、`part def` 所有の requirement の複製と暗黙の subject の解決、同名の根・ID 衝突の回避、全パターンの多重度警告、方向つき影響分析、`SATISFY_UNRESOLVED` の警告、SCDL の公式検証と往復(特殊な名前も)。
- 減点(合計 10 点): `verify`/`derive`/`refine`(無警告)・port・connection・allocation・state が導出されない -3 / 再定義した使用での定義内 `satisfy` の欠落と誤った警告文(N7b)-2 / 利用者の `@Scdl*` の黙った無視と ADR-0007 の誤記(N10)-1 / SCDL ID の不安定(N4)・`modelRef` が文字列 -1 / `a/b` と `a::b` の ID の曖昧さ -0.5 / 無名 `allocate` の誤った警告 -0.5 / 影響分析が要求起点のみ -1 / ほか(ADR の更新漏れ)-1。

### 外部確認待ち減点(各 5 点。点数とは別枠)

- G0 の MBSE 専門家による書面レビュー(ADR-0007/0008 の導出規約、SCDL ステレオタイプ設計、展開規約)。担当: 外部 MBSE 専門家。
- 他の SysML v2 ツール/API サーバー(公式 Pilot API、商用モデラ)での JSON / XMI / `@Scdl*` / `modelRef` の読み込み確認(特に N10b のライブラリ ID、`SCDL.sysmlx` の扱い)。担当: ツール担当 / MBSE 専門家。
- ASAM SCDL v1.6.0 仕様書との突合と法務確認、jar(jupyter-sysml-kernel 同梱物)の第三者ライセンス棚卸し。担当: 安全 + MBSE ドメイン担当 / 法務。

---

## 5. 優先修正(ファイル単位)

1. `apps/server/src/sysml/stable-ids.ts`(N8・N9): 無名の `SatisfyRequirementUsage` などの鍵に、子の `ReferenceSubsetting` の参照先名と `by` の連鎖の名前を含める。WL 署名の同点は、所有者・名前・参照先名で決める(実行順に依存させない)。テストに「`satisfy` の ID → 要求名の対応が編集の前後で不変」「examples 9 例すべてで 2 回の出力がバイト一致」を追加(`all-stereotypes` と `redundant-architecture` は現状で不合格)。
2. `apps/server/src/sysml/stable-ids.ts`(N10b): `isLibraryElement: true` の要素は ID を置き換えず、変換器の標準の ID(UUID v5)をそのまま残す。JSON と XMI で `Real` の ID が一致することをテスト。SCDL の `LibraryPackage` の `owner`/`owningRelationship` の未解決参照 2 件を処理する。
3. `packages/scdl/src/from-graph.ts` と `packages/analysis/src/scdl-map.ts`(N10): 利用者の `@Scdl*` を読むか、読まないなら `SCDL_ANNOTATION_IGNORED` の警告を出す。ADR-0007 の「本番の読み込み経路」を訂正。同梱の `all-stereotypes` の SCDL ビューが空に近いことをテストで固定しない(または例の位置づけを明記)。
4. `packages/sysml-graph/src/expand.ts`(N7b/c): 使用側の再定義(`part :>> front`、`requirement :>> r1`)に、定義内の `satisfy` を引き継ぐ。`SATISFY_NO_INSTANCE` の条件を「定義を使う part が無い」に限定(再定義した使用では出さない)。定義内の入れ子 requirement への `satisfy outer.nested by front` を解決。警告の `ref` にインスタンス経路を含める。
5. `tools/sysml-check/SysmlExtract.java` / `packages/sysml-graph`(沈黙の欠落): `verify`・`derive`・`refine`(dependency の種類)と無名の `allocate … to …` を `UNSUPPORTED_CONSTRUCT` として件数つきで警告する。`INVALID_ELEMENT` の文を「名前のない構成」と実態に合わせる。
6. `tools/sysml-check/convert.sh`(性能): ライブラリ追加の判定を、`import` 文と `[単位]` の構文に限定する(コメント・文字列を除外)。`SCDL.sysmlx` など `href` の宛先ファイルを zip で同梱するか、`href` を持たない出力にする。
7. `apps/server/src/sysml/convert.ts`(分類): 変換のタイムアウトを `SysmlTimeoutError` として 504 にそろえる(または ADR-0009 X6 に例外を書く)。
8. `docs/adr/0009-interoperability-scope.md` / `0007` / `0008`: 上記の事実に合わせて X4(バイト一致、`satisfy` の ID)、X6、`scdlFromGraph`、再定義、`allocate` の扱いを訂正。
9. 中長期: JSON/XMI の取り込み、SysML v2 API クライアント、`verify`/`derive`/`refine`/port/connection/allocation の導出、`modelRef` を SysML 上の参照にする、他ツールでの実読込テスト、jar の第三者ライセンス棚卸し。

---

## 6. 第 7 回の指摘 → 第 8 回での確認

| 第 7 回の指摘 | 判定 | 実測の根拠 |
|---|---|---|
| N6 捨てた JVM の exit で孤児 JVM | **修正済み** | タイムアウトと解析を 3 回交互に実行しても子プロセスは常に 1 個。`stale()` ガードをコードでも確認 |
| N6b 分類(export は 503、他は 409/200) | **ほぼ修正** | 全エクスポート・AI で 504。`GET project` は 200+`modelOk:false`(ADR 記載どおり)。変換のタイムアウトのみ 503 |
| X1 標準ライブラリ参照 | **修正済み(ID の食い違いが新規)** | `Real` が名前つき、XMI `href` が `ScalarValues.kermlx#UUID`。JSON と XMI の ID が不一致(N10b) |
| X3 単位式の JSON 不可 | **修正済み** | `unit.sysml` が JSON/XMI とも 200 |
| X5 SCDL 付きモデルの JSON 不可 | **修正済み(参照の穴が残る)** | `all-stereotypes` が JSON/XMI とも 200。JSON に未解決参照 2、XMI の `SCDL.sysmlx` `href` は毎回別 |
| ID 安定化(2 回の出力一致・編集後の安定) | **一部修正** | ev-powertrain は一致、編集後 95% 前後が不変。ただし 2/9 例で不一致、`satisfy` の ID の入れ替わり(N8) |
| N7 `part def` 所有の requirement・相対経路 | **修正済み(再定義との組み合わせに穴)** | `n7` で 3 件の誤りが解消。`va`/`vb` で再定義時に欠落 |
| ADR-0008/0009 の記述 | **一部不一致** | §3 の表 |
| N4 SCDL ID | 既知の制約(未修正) | 別枠 |
| `modelRef` が文字列のみ・取り込み未対応 | 既知の制約 | 別枠 |

## 最終サマリ

- **A1: 90(減点 5、合否点 95 = 合格)/ B3: 87(減点 5、合否点 92 = 合格)/ C2: 90(減点 5、合否点 95 = 合格)**。3 項目とも採点は 80 以上。
- R7 の主要指摘(N6・分類・X1/X3/X5・N7)は実測で修正を確認した。
- 最重要の新規指摘: (1) N8 `satisfy` の関係要素の ID が無関係な編集で入れ替わる、(2) N9/N10b 同梱 9 例中 2 例で 2 回の出力が一致しない・JSON と XMI でライブラリ ID が食い違う・SCDL 付き XMI の `href` が毎回変わる、(3) N10 利用者の `@Scdl*` が警告なしで無視され、ADR-0007 の「本番の読み込み経路」が事実と異なる。
