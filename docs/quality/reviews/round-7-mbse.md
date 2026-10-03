# ラウンド 7 レビュー: MBSE / SysML v2 専門家の観点(A1・B3・C2)

- 立場: 独立・厳格な MBSE / SysML v2 専門家(シミュレートしたレビュアー。認証機関ではない)
- 基準: `docs/quality/rubric.md`(証拠主義、未検証は減点、外部確認待ち減点は点数と別に最大 10 点)
- 対象リビジョン: `aeda725`。リポジトリのソースは変更していない(作業物はスクラッチパッドの `m7/` のみ。サーバーは esbuild でスクラッチに同梱ビルドし、別ポートで実行)。
- 方法(`round-6-response.md` は鵜呑みにせず再検証):
  - `./tools/sysml-check/run.sh`(公式 Pilot 0.62.0、Java 21): SCDL.sysml・examples・model.sysml 全件エラー・警告ゼロ。`pnpm -r test` 全件合格(safety-core 135 / sysml-graph 40 / scdl 50 / analysis 61 / ai 37 / web 20 / server 76 + skip 8)。
  - 同梱サーバー(`FUSAMOD_SYSML=java`)に**新規の敵対的モデル**を HTTP で投入:
    3,000 part(156KB、`big`)、`r7b`(型付き requirement の入れ子・`requirement def` の特殊化・入れ子 requirement 内の型付き requirement への `satisfy`、`[n]` `[0]` `[0..1]` `[0..*]` `[*]` `[3]` `[2..5]` `[z]` と定義内多重度)、
    `r7d`/`r7e`(part 内の requirement、定義内 `satisfy`、ref 経由、属性への `satisfy`、再定義した入れ子 requirement、`requirement r3 :> r1`)、
    SCDL ID 用(`ids0/1/2`、`coll2`: `'a/b'`・`x@E`・`x#2`・同名の根)、誤りモデル `bad`、単位式 `unit`、`all-stereotypes`。
  - 変換器: `GET export/model.json|model.xmi` を反復・10 並行・小さな編集後に比較。公式 `SysML2JSON`/`SysML2XMI` を**自分で直接起動してライブラリを渡す実験**(X1 の修正可否)。
  - SCDL: `export/scdl.sysml` → `PilotCheck`(SCDL.sysml と同一セッション)→ `importSysml` → `exportSysml` の往復。影響分析は `impactOfRequirementChange` を実データで呼出し。

---

## 総括

| 項目 | 採点 | 外部確認待ち減点 | 合否点 | 判定 |
|---|---|---|---|---|
| A1 機能要件(モデリング/トレーサビリティ/階層/SCDL の観点) | **89** | 5 | 94 | 合格(採点 80 以上) |
| B3 互換性・相互運用性 | **85** | 5 | 90 | 合格(ぎりぎり。採点 80 以上、合否点 90) |
| C2 MBSE 専門家の観点 | **89** | 5 | 94 | 合格(採点 80 以上) |

ラウンド 6 の主要な指摘のうち、**N1(タイムアウト後のサーバー停止)のクラッシュ、N2(要求側の経路つき `satisfy`)、N3(多重度の警告)、N5(ADR-0008 の古い記述)は実測で修正を確認**した。
一方で、(1) 同じ N1 の周辺に**新たな欠陥(タイムアウト後に Java プロセスが孤児として増える)**を再現、(2) X1(標準ライブラリ参照)・X3/X5(単位式・SCDL 付きモデルの JSON 不可)は
応答文書が「未検証」としていたが、**変換器にライブラリを渡すだけで直ることを私が実測**した(未着手のまま)、(3) JSON の `elementId` 安定化は「ほぼ決定的」だが、同梱の ev-powertrain でも**2 回の出力が一致しない**・
**小さな編集で関係要素の ID の約 3 割がずれる**(設計の欠陥を特定)、(4) `part def` の中の requirement と `satisfy` の扱いが誤解を招く(新規)、(5) タイムアウトの分類は export では 503 だが CSV/レポート等では依然 409、を確認した。
B3 は採点 85 で、外部確認待ち減点を足して 90(最小限の合格)。

---

## 1. SysmlServer のクラッシュ/EPIPE(N1)

再現手順: 156KB・3,000 part(`part pN : C { attribute kN = N; part q; }`)の `big` を作成し、`GET export/model.json` を実行 → 約 60〜72 秒でタイムアウト。続けて `export/model.xmi`、`/api/health`、別プロジェクトの解析を投入。

| 試験 | 結果 | 判定 |
|---|---|---|
| タイムアウトした要求(`big` の JSON) | **503**「SysML の解析に失敗しました: SysML の解析がタイムアウトしました…」(409 ではない) | 修正を確認(export) |
| タイムアウト直後、並行/直後の `model.xmi`・`/api/health`(3 回繰り返し) | 503 / 200。**サーバープロセスは生存**(`EPIPE` なし、`server.log` に Unhandled なし) | **クラッシュ(N1)は修正を確認** |
| 次の正常な要求(`r7a` 解析) | 200(約 7 秒。JVM を再起動) | 回復 |
| `GET /api/projects/big`(タイムアウト) | **200**(`modelOk:false`、`sysmlError` に理由)。504 にはならない | 後述(分類) |
| 子プロセス数を監視(別サーバー `ppid` 限定で計測) | タイムアウト直後 0 → 次の要求で 1 → **さらに次の要求で 2 個の JVM**(最初のものが孤児)。サーバー終了で消える | **新規欠陥 N6** |

### 新規欠陥(実装)

**[N6 中] タイムアウトのたびに JVM が孤児として増える(資源リーク)。**
`java-service.ts` の `proc.on("exit")` が、**どの子プロセスの終了かを確認せず**に `this.reset()` / `this.failPending()` を呼ぶ。
`kill()` が先に `reset()` して新しい JVM(B)を起動した後で、**殺した旧 JVM(A)の遅れた `exit` イベント**が `this.proc`/`this.ready` を消し、生きている B を参照できなくなる。
次の要求は C を起動し、B は誰も参照しない孤児(約 400〜600MB)になる。実測: 同じサーバー(ppid 一定)で「warm 1 個 → timeout 後 0 個 → 要求 1 回目で 1 個(7.5 秒)→ 要求 2 回目で 2 個(8.7 秒、再度コールドスタート)」。
さらに旧 JVM の遅れた exit は `failPending` で**新しい要求を「SysML サービスが終了しました」で失敗させうる**(サーバーログに「SysML サービスが利用できません」が出た)。
修正: `proc.on("exit"/"error", …)` と各リスナーの先頭で `if (this.proc !== proc) return;`(世代の確認)。回帰テスト: 代役プロセスで「timeout → 次の要求 → 旧プロセスの exit を遅延発火 → 3 つ目の要求が同じプロセスに載る・起動回数が増えない」。

**[N6b 低〜中] タイムアウトの分類は export(JSON/XMI)だけ 503。他は誤分類/隠蔽。**
- `services.ts` の `parseModel` が `SysmlTimeoutError` を捕まえて `{error: msg}` にするため、`app.ts` の `SysmlTimeoutError → 504` の分岐は**到達しない(死んだコード)**。応答文書・ADR-0009 の「504(または 503)」は実装と一致しない(実際は export で 503、他は 200+`modelOk:false`)。
- `needAnalysis`(`fmea.csv` `trace.csv` `issues.csv` `report.md` `scdl.sysml` `analysis.json`)は `!out.analysis` を **409「モデルにエラーがあるため」**に写す。タイムアウトや Java 停止でも 409(コード読解。タイムアウトの再現は環境の負荷で不安定だったため未再現)。
- 実測で、3,000 part は JVM が温まった状態で約 10 秒、他エージェントの負荷下では 60 秒超になる。性能上の限界(B2/B5 の領域)は残る。

---

## 2. 要求側の経路つき `satisfy` と、インスタンス経路の解決(N2)

`r7b`(valid、診断ゼロ)の `trace.cells`(実測):

```
R7B::r1::subB::deep        -> R7B::v::front::brake        (r1 : ReqD, satisfy r1.subB.deep by v.front.brake)
R7B::r2::subA              -> R7B::v::rear::brake
R7B::r3::subC              -> R7B::v2::front::hub         (r3 : ReqE :> ReqD)
R7B::r3::subB::deep        -> R7B::v2::rear::hub          (継承した入れ子)
R7B::top::mid::subB::deep  -> R7B::v::rear::hub           (入れ子 requirement の中の型付き requirement)
R7B::top::mid2::leaf       -> R7B::v2::front::brake
```

- **N2 は修正済み**。定義側(`ReqD::…`)に誤って付く現象は無く、`r1` と `r2` は別インスタンスに正しく分離される。
- `r7d`(part 内 requirement、`requirement :>> s1 { requirement extra; }`、`requirement r3 :> r1`)も正しい: `r2::s1::extra → c2::front::hub`、`r3::s1 → c2::rear::brake`、`c1::carReq → c1::front::brake`。
- 影響分析(`r7b`、方向つき): `r1` 下位 3 件・要素 `v::front::brake`、`r1::subB::deep` は `upstream=[subB, r1]`・下位 0、`top` は下位 6 件・要素 2 件。**下位/上位が分離**され、上位の要素・FMEA は範囲に含めない(設計どおり)。
- 影響分析は**要求起点のみ**。構造要素の変更から要求・FMEA への逆方向(要素 → satisfy 元の要求)は提供されない(軽微)。HTTP API には無く、画面側の呼出し。

### 新規欠陥 / 沈黙に近い誤り

**[N7 中・トレーサビリティ] `part def` が所有する requirement と、その中の `satisfy` が、インスタンスに付かず、かつ警告が事実と異なる。**
`r7e`:
```
part def Car { part front : Axle; requirement inCar; satisfy inCar;            // 暗黙の subject
                requirement inCar2; satisfy inCar2 by front; }
part c1 : Car; part c2 : Car; part c3 : Car {...}
```
実測: `trace.cells` に `c1::inCar` `c1::inCar2` などは**無く**(未カバーとして 10 件)、`REQUIREMENT_NOT_SATISFIED` が付く。しかし:
- `inCar` に出る警告 `SATISFY_NO_INSTANCE`「**使われていない定義の中の要素**です」は誤り(`Car` は 3 インスタンスで使用中)。
- `inCar2` に出る `SATISFY_AMBIGUOUS`「3 個のインスタンスすべてに紐づけました」は**事実と異なる**(要求 ID が定義側 `Car::inCar2` のままで、トレース行にもセルにも現れない)。
- `part c3 : Car { requirement extra; satisfy extra by front.brake; }`(使用側で型の中身へ相対経路)は `SATISFY_UNRESOLVED`(警告は出るが、解決できるはずの書き方)。`resolveChain` が先頭を `insideDefinition` で拒否するため。
- 要求を part の中に置く書き方は SysML v2 の標準的な作法であり、実務で頻出する。「黙って」ではないが、**警告文が誤誘導**で、カバレッジ(`TRACE_UNCOVERED`/`REQUIREMENT_NOT_SATISFIED`)が実態と異なる。
- 修正先: `packages/sysml-graph/src/expand.ts`(定義が所有する requirement を使用ごとに複製し、定義内の `satisfy` を `<使用>::<名前>` に付け替える。相対経路の先頭を、満たす側の part のインスタンスから解決する)、`SATISFY_NO_INSTANCE`/`AMBIGUOUS` の文言と条件。ADR-0008 に規約を追記。

**[確認済み(警告あり)] 解決不能なものは警告つきで落ちる。** `ref part` 経由(`holder.rp`)・属性への `satisfy`(`c1.front.w`)は `SATISFY_UNRESOLVED`、action への `satisfy` は `SATISFY_NOT_PART`、`Unused` 定義内は `SATISFY_NO_INSTANCE`、`ref part` は `UNSUPPORTED_CONSTRUCT`。ここは「黙って落ちる」ではない。

---

## 3. 多重度の警告(N3)

`r7b` の実測(`MULTIPLICITY_IGNORED`、1 使用 1 回、定義内は `Holder::inner` のように 1 回):

| 記述 | 結果 |
|---|---|
| `[n]`(属性 n=3)・`[z]`(z=0) | 警告「上限が式のため解析できません」 |
| `[0]` | 警告「多重度が 0 です…1 つとして扱います」 |
| `[0..1]`・定義内 `[0..1]` | 警告「下限が 0(任意)…常に存在するものとして扱います」 |
| `[0..*]`・`[*]` | 警告「上限なし(*)」 |
| `[3]` `[2..5]` `[4]`(定義内)`[2]`(入れ子の中) | 警告(上限を表示) |
| `[1]`(`one`) | 警告なし(正しい) |

- **N3 は修正済み**。使用ごとの重複も解消(`Holder::inner` は `h1`/`h2` の 2 使用でも 1 回)。
- 残る軽微な点: 警告が「モデル上の使用」を指し、インスタンス経路は出ない(`h1::inner` か `h2::inner` かは示さない)。`[0..*]` の警告が「上限なし」のみで下限 0 に触れない。ADR-0008 末尾に `[n]` `[0]` 下限 0 `[*]` の記載はあるが、「1 つとして数える」ことによるカバレッジ/SPOF 判定への影響(冗長性の過大・過小評価)の説明はない。

---

## 4. 標準形式エクスポート(convert.sh / convert.ts / stable-ids.ts)

### 4.1 elementId 安定化の妥当性

| 検証 | 結果 |
|---|---|
| 衝突 | ev-powertrain JSON 234 要素・ID 234 種で重複 0。参照(`@id`)の未解決 0、`identity.@id` と `elementId` の不一致 0 → **参照は閉じており、衝突も無い** |
| 同じモデルを 2 回(ev-powertrain) | **ファイルは一致しない**(diff 多数)。ID の集合は 234 件とも一致するが、**同じ ID が別の要素を指す**ものが 8 件(すべて `FeatureTyping`) |
| 原因(8 件) | `FeatureTyping.type` の宛先が、**名前を持たないライブラリ参照の `Type` スタブ**(X1)。スタブどうしが区別できず、署名が同一 → どの ID がどのスタブかが実行ごとに入れ替わる。つまり X1 が決定性まで壊している |
| 小さな編集後の安定性 | ev-powertrain に (a) 先頭に `part` 追加、(b) 中ほどに `action` 追加 → 経路・種類・名前が一意に対応する要素のうち、**(a) 74 件一致 / 37 件変化、(b) 79 一致 / 32 変化**。変化した型: `OwningMembership` `FeatureMembership` `FeatureTyping` `ReferenceSubsetting`。名前を持つ `PartUsage` `ActionUsage` `ReferenceUsage` `Documentation` などは**すべて安定** |
| 原因(編集時のずれ) | `stable-ids.ts` の鍵は `p.owner` を所有者の経路に使うが、**関係要素(Membership・FeatureTyping 等)の JSON には `owner` が無く `owningRelatedElement`/`owningNamespace` がある**。所有者の鍵が空になり、`"/OwningMembership:"` のように**全モデルで同じ鍵**となる。出現順は全要素の署名(WL ハッシュ)順で決まるため、要素が増減すると関係要素の ID が広くずれる。`owningRelatedElement` と `owningNamespace` も所有者として扱えば解消する見込み |
| XMI | `xmi:id` は置き換えていない(ADR-0009 に明記)。2 回の出力は 2 行目から異なる |

評価: 「全く別の ID が毎回出る」(ラウンド 6)よりは大きく前進(名前のある要素は安定、集合は一致、参照は閉じる)。しかし **版管理・差分・他ツールでの追跡には不十分**:
(a) 同梱の例でも 2 回の出力が一致しない、(b) 編集で関係要素の ID の約 3 割が動く。ADR-0009 X4 は(a)の原因を「完全に対称な要素」としているが、実際は X1 のスタブ、(b)の記載は ADR に無い(`stable-ids.ts` のコメントにのみ)。

### 4.2 X1(標準ライブラリ参照)は直せるか — 実測

`convert.sh` は `java … SysML2JSON <model.sysml>` の 1 ファイルのみ。公式の変換器は**追加の入力ファイルを同時に処理でき**、`-l <ライブラリのパス>` は入力の基準パスである(それ自体は読み込まない)。実験(スクラッチ `m7/conv*`):

| 実験 | 結果 |
|---|---|
| ev-powertrain + `-l`(単独) | 以前と同じ。`Type`/`Namespace` の名前なし 8+2 件 |
| **ev-powertrain + `ScalarValues.kerml` を同じ起動で追加入力** | JSON に `DataType: Real`(`LibraryPackage: ScalarValues`、`isLibraryElement: true`)が現れ、`FeatureTyping.type` が**名前つきの Real に解決**。`Type` スタブ 0 件(`Namespace` が 1 件残る。暗黙要素)。ライブラリ要素の ID は変換器が決定的に付与(UUID v5 形式) |
| **同 + XMI** | `href="ScalarValues.kermlx#904d28f1-df99-5ef5-bb01-00fad2e84d26"` のように、**ライブラリへの安定な ID つきの参照**に変わる(以前の `href="model.sysml#\|0"` 9 件が消える)。ただし `-l` をつけると XMI はライブラリ全体を読みに行き、空白を含む相対パスで失敗。スペースの無いコピーの絶対パスを渡すと成功 |
| **`all-stereotypes.sysml`(`import SCDL::*`)+ `SCDL.sysml` + `ScalarValues.kerml` を追加入力** | **JSON 化に成功**(561KB)。単独では NPE(`Element.eResource() is null`) = X5 |
| **単位式 `[kg]`(`ISQ::*`,`SI::*`)+ ライブラリ 6 ファイルを追加入力** | **JSON 化に成功**(25KB)。単独では NPE = X3 |

結論: **X1・X3・X5 は「変換器の挙動で本ツールでは直せない」ものではなく、ライブラリを同じ起動に渡していないことによる**(X3/X5 の NPE は、未解決の参照 = `eResource()` が null のライブラリ要素が原因)。
応答文書は「直せないと断定しない・未検証」としていたが、検証すれば直る。修正は `convert.sh`/`convert.ts` の小さな改修(使用している import から必要なライブラリ・`SCDL.sysml` を、スペースの無い一時パスにコピーして追加入力に渡す)。ID の決定性(X4)も、ライブラリのスタブが消えれば 8 件のずれは解消する。

### 4.3 409 / 422 / 429 / 503 の分類

| 状況 | 実測 | 判定 |
|---|---|---|
| 誤りモデル(`bad`) | JSON・XMI とも **409**(約 0.03 秒) | 正しい |
| 単位式 `[kg]`・`all-stereotypes` の JSON | **422**(XMI は 200) | 分類は正しい。ただし上記のとおり直せる |
| 10 並行(JSON/XMI 混在) | 200 と **429**(`Retry-After`)。同時 2 + 待ち 4。孤児プロセス・一時ディレクトリ 0 | 正しい |
| 解析タイムアウト | **503**(export) | 正しい(他ルートは §1 の N6b) |
| 並行負荷下の有効モデル | **ev-powertrain の JSON が 422**(最初の 10 並行で 1/10、次の 18 件で 4/18)。同条件の再試行(24 件、30 件)では 0 件 | **再現は不安定**。バックグラウンドで他の処理(テスト・他レビュアーのサーバー)が走っていた時間帯。原因は特定できていない。**資源起因の変換失敗が「モデルの誤り」として 422 になる**可能性があり、メッセージが誤誘導 |

### 4.4 ADR-0009 の正直さ(X1〜X6)

- 正確: 書き出しのみ、取り込み・API なし、他ツール未確認、`Commit` で包んでいない、X2(409/422)、同時 2/待ち 4、X5(SCDL を含むモデルの JSON は 422、XMI は成功)。ラウンド 6 の欠落(SCDL による JSON 不可)は記載済み。
- 不正確/不足:
  - **X1/X3/X5 を「公式変換器の挙動」と位置づけ、見出し「既知の制約」として固定**している。実測では本ツール側の呼び出し方で直る(§4.2)。
  - **X6**「504(または 503)」は実装と一致しない(export は 503、他のルートは 200 + `modelOk:false` または 409)。504 の分岐は到達しない。
  - **X4**「同じモデルなら elementId の集合は一致」は正しいが、「完全に対称な要素の割り当てのみ入れ替わりうる」は過小な記述: 実際は X1 のスタブ、および関係要素の編集時のずれ(§4.1)。
  - 「方針: 公式 API を利用する形で追加」は、実装が「.sysml → 変換器」の一方向である点とずれたまま(軽微)。
- ADR-0008: 5 回目の追補を含め、実装と一致(要求側経路・多重度)。ただし §2 の N7(`part def` が所有する requirement)の規約は未記載。ADR-0007 の SCDL ID の記述は実測と一致(§5)。

---

## 5. SCDL(ID・modelRef・往復・衝突)

- `export/scdl.sysml` は、`ids1`(同名の根)・`r7b`・`r7d`・`coll2`・ev-powertrain のいずれも **SCDL.sysml と同一セッションで `PilotCheck` エラー・警告ゼロ**。
- `importSysml` → `exportSysml` → `importSysml` の往復は、5 件すべてモデルが完全一致(ids1 / r7b / r7d / coll2 / ev-powertrain)。
- ID 衝突の回避: `coll2`(`x`/`x#2`/`x#3`、`'x@E'`、`'y@E@E'`、`Q3::y` と要求 `y` など)で、SCDL の全要素 ID 11 件が重複 0。
- **N4(パッケージ追加で同名の根の ID がずれる)は未修正**(ADR-0007 に記載済み)。`ids0` → `A0::v` を追加(`ids1`)で `P1::v`: `v` → `v#2`、子 `P1::v::a`: `v/a` → `v#2/a`、`P2::v`: `v#2` → `v#3`。`Z9::v` 追加(`ids2`)は既存 ID が不変(末尾追加は安全)。
- 軽微な曖昧さ: `part 'a/b'` に `a/b`、ネストした `a::b` に `a/b#2` が付く(経路としては後者が `a/b`)。`modelRef` は完全修飾名の**文字列**で、SysML 上の参照(`allocate` 等)ではない。
- 同名の根を複数使う運用では、`modelRef`(完全修飾名)での追跡が前提。ID の世代間安定は保証されない。

---

## 6. 項目別採点

### A1. 機能要件の充足度(モデリング/トレーサビリティ/階層/SCDL の観点): 89 点(外部確認待ち減点 5)

| チェック項目 | 状況 | 所見 |
|---|---|---|
| SysML v2 準拠のモデリング(読み込み・検証・編集・書き出し) | 達成(取り込みは .sysml のみ) | 公式実装で検証。標準 JSON/XMI は書き出し可。X1/X5 の品質は未達 |
| システム階層をモデルから自動生成 | ほぼ達成 | 定義・再定義・特殊化・型付き requirement の展開は正しい。多重度は全パターン警告(1 つとして数える点は仕様) |
| トレーサビリティ(マトリクス・影響分析・整合性チェック) | 概ね達成 | 要求側経路・入れ子・特殊化は正しい。方向つき影響分析は機能。`part def` 所有の requirement(N7)と一部の相対経路が未対応で、警告文に誤りがある |
| ASAM SCDL ビュー | 達成(穴あり) | 公式検証と往復 OK、衝突回避 OK。同名の根の ID はパッケージ追加でずれる |
| 標準形式のインポート/エクスポート | 一部 | 書き出しのみ。取り込み・API なし |

減点: 取り込み・API(§範囲)と JSON/XMI の X1 -3 / N7 -2 / port・connection・allocation・state・`verify`・`derive`・`refine` が解析に使えない(警告のみ)-3 / SCDL ID の不安定 -1 / N6(孤児 JVM)・N6b(409 の誤分類)-1 / 要求影響のみで要素起点の逆方向影響がない -1(合計で 11 点)。

### B3. 互換性・相互運用性: 85 点(外部確認待ち減点 5)

- 前進: 誤りモデル 409、変換失敗/空 422、並行上限 429、タイムアウト 503(export)、プロセスグループ停止、起動時掃除。JSON の ID が内容から決まる(名前のある要素は安定)。ADR-0009 が X5・X6 まで記載。ADR-0008 の古い記述を訂正。公式検証・SCDL 往復は維持。N1 のクラッシュは解消。
- 減点: 取り込み(JSON/XMI/API)なし -5(ADR に記載済みの未対応) / **X1 標準ライブラリ参照**(直せることを実測、未着手)-3 / **X3・X5**(単位式・SCDL 付きモデルの JSON 不可。直せることを実測、未着手)-2 /
  ID の安定化が不完全(同梱の例で 2 回の出力が不一致、関係要素の ID が編集で約 3 割ずれる、XMI の id は毎回別)-2 / ADR-0009 の誤り(X6 の 504、X4 の原因、X1 を「変換器の挙動」と固定)-1 /
  並行下の不定の 422(誤誘導)・N6 の孤児 JVM -1 / 他ツール(API サーバー・商用モデラ)での読込未確認・`modelRef` が文字列のみ -1(外部確認待ちと重複しない範囲)。合計で 15 点。
- 実務家の目では、現状の JSON/XMI は「公式変換器の出力を、エラーを弾いて配る」機能。ライブラリ参照が空要素で、ID が編集で動くため、**版管理や他ツールへの投入にはまだ使えない**。ただし修正の道筋は明確(§4.2)。

### C2. MBSE 専門家の観点: 89 点(外部確認待ち減点 5)

- 長所: 定義内再定義、`requirement def`(型付き使用・特殊化・入れ子内の型付き使用)、要求側/満たす側の両方のインスタンス経路、同名の根・ID 衝突の回避、全パターンの多重度警告、方向つき影響分析(下位/上位/相手の分離)、解決不能時の `SATISFY_UNRESOLVED`、SCDL の公式検証と往復。
- 減点: N7(`part def` 所有の requirement、誤った警告文、相対経路の拒否)-2 / `verify`・`derive`・`refine`・port・connection・allocation・state が導出されない(警告のみ)-3 / SCDL ID の不安定(N4)-1 /
  `modelRef` が文字列 -1 / `@E`/`#n`/`/` の曖昧さ(`a/b` と `a::b`)-1 / 影響分析が要求起点のみ・多重度を 1 つとして数える影響の説明がない -1 / ほか(ADR に N7 未記載、専門家レビュー未実施の一部)-2。

### 外部確認待ち減点(各 5 点)

- G0 の MBSE 専門家による書面レビュー(ADR-0007/0008 の導出規約、SCDL ステレオタイプ設計、展開規約)。担当: 外部 MBSE 専門家。
- 他の SysML v2 ツール/API サーバー(公式 Pilot API、商用モデラ)での JSON / XMI / `@Scdl*` / `modelRef` の読み込み確認。担当: ツール担当 / MBSE 専門家。
- ASAM SCDL v1.6.0 仕様書との突合と法務確認、jar(jupyter-sysml-kernel 同梱物)の第三者ライセンス棚卸し。担当: 安全 + MBSE ドメイン担当 / 法務。

---

## 7. 実務の MBSE 担当者がまだ拒否する点

実装の欠陥(直せる):
1. タイムアウトのたびに JVM が孤児として増え続ける(N6)。export 以外のルートでは、タイムアウトが 200 または 409(モデルの誤り)に化ける(N6b)。
2. 標準 JSON/XMI のライブラリ参照が名前なしスタブ/解決不能 `href`(X1)。単位式・SCDL 注釈付きモデルの JSON が 422(X3/X5)。いずれも**ライブラリを渡せば直る**ことを実測。
3. `elementId`: 同梱の例で出力が一致しない、編集で関係要素の ID が大きくずれる(`owner` 欠落の鍵の設計)。XMI の id は毎回別、FuSaMod の ID との対応表なし。
4. `part def` が所有する requirement と、その中の `satisfy` の扱い(N7)。警告文が事実と異なる。
5. 並行下で有効モデルが 422 になることがある(再現は不安定)。

範囲の問題(ADR に記載済みの未対応):
- SysML v2 API(REST)接続、JSON/XMI の取り込み・往復、`Commit` で包んだ投入形式、他ツールでの読込確認。
- port / connection / interface / flow / state / allocation を解析に使えない。`verify` / `derive` / `refine` がない。
- SCDL ステレオタイプは独自のメタデータ定義で、他ツールでの解釈は未確認。`modelRef` は文字列。

---

## 8. 優先修正(ファイル単位)

1. `apps/server/src/sysml/java-service.ts`(N6): `exit`/`error`/`stdin error` のリスナーの先頭で `if (this.proc !== proc) return;`(世代の確認)。回帰テスト `apps/server/test/fake-processes.test.ts`: 「timeout → 次の要求 → 旧プロセスの遅れた exit → 更に次の要求」で、起動回数が増えず、孤児が出ない。
2. `apps/server/src/services.ts` / `apps/server/src/app.ts`(N6b): タイムアウト・Java 停止を `modelOk:false` に畳まず、`SysmlTimeoutError`/`SysmlUnavailableError` を呼び出し側へ伝える(または `AnalysisOutcome` に区別を持たせる)。`needAnalysis` の 409 は「診断にエラーがある」ときだけ。死んだ 504 の分岐を整理し、ADR-0009 X6 を実装に合わせる。
3. `tools/sysml-check/convert.sh`、`apps/server/src/sysml/convert.ts`(X1/X3/X5): 変換時に必要なライブラリ(`ScalarValues.kerml`、使われる `ISQ`/`SI` など、`libs/sysml/scdl/SCDL.sysml`)を、スペースの無い一時パスにコピーして**同じ起動の追加入力**に渡す。出力が `model.json`/`model.sysmlx` のみであることを確認。回帰: `unit`/`all-stereotypes` が 200、XMI の `href` が `…kermlx#<UUID>` になる。
4. `apps/server/src/sysml/stable-ids.ts`(X4): 所有者に `owningRelatedElement`/`owningNamespace`/`owningMembership` も使う。ライブラリスタブが消えた後も、(a)同一モデルの 2 回の出力が**バイト一致**する、(b) 編集後も名前つき要素と関係要素の ID が安定する、をテストに入れる(ev-powertrain を 2 回、編集前後を比較)。`qualifiedName` と `elementId` の対応表(`GET export/model.ids.json` など)も検討。
5. `packages/sysml-graph/src/expand.ts`(N7)・`docs/adr/0008`: 定義が所有する requirement を使用ごとに複製し、定義内の `satisfy`(暗黙 subject・`by front`)を `<使用>::<名前>` に付ける。`SATISFY_NO_INSTANCE`/`SATISFY_AMBIGUOUS` の条件と文言を実態に合わせる。使用側の相対経路(`front.brake`)を解決する。
6. `packages/analysis/src/scdl-map.ts`(N4): 同名の根の ID を、パッケージ名由来の安定な接尾辞にする(または現仕様を維持して UI で `modelRef` 追跡を明示)。`'a/b'` と `a::b` の区別。
7. `docs/adr/0009-interoperability-scope.md`: X1/X3/X5 を「変換器の挙動」から「未対応(実装で直せる)」に改める。X4 の原因・編集時の挙動、X6 の実装との一致を訂正。
8. 中長期: JSON/XMI の取り込み、SysML v2 API クライアント(`Commit` 形式)、`verify`/`derive`/`refine`/port/connection/allocation の導出、`modelRef` を SysML 上の参照にする、他ツールでの実読込テスト、jar の第三者ライセンス棚卸し。

---

## 9. ラウンド 6 の指摘 → ラウンド 7 での確認

| ラウンド 6 の指摘 | 判定 | 実測の根拠 |
|---|---|---|
| N1 解析タイムアウト後にサーバーが EPIPE で停止 | **修正済み**(ただし N6 が残る) | 156KB・3,000 part のタイムアウト後、xmi・health・別モデルの要求が成功し、プロセスは生存。ログに Unhandled/EPIPE なし |
| N1 タイムアウトが 409 で返る | **一部修正** | export(JSON/XMI)は **503**。`needAnalysis` 系(CSV/レポート/`scdl.sysml`/`analysis.json`)は 409 のまま(コード読解)。504 分岐は到達しない |
| N2 `requirement def` 入れ子への `satisfy`(要求側経路) | **修正済み** | `r1::subB::deep → v::front::brake`、`r3`(特殊化)・`top::mid` の入れ子内型付き要求も正しい |
| N3 多重度 `[n]` `[0]` 下限 0 の無警告・使用ごとの重複 | **修正済み** | 全パターンで警告、1 使用 1 回。インスタンス経路は出ない(軽微) |
| N4 SCDL ID がパッケージ追加でずれる | **未修正**(ADR-0007 に記載済み) | `A0::v` 追加で `P1::v`: `v` → `v#2` |
| N5 ADR-0008 の「標準形式は未対応」 | **修正済み** | ADR-0008 の「制約と今後」が「書き出しは対応(ADR-0009)」に |
| X1 標準ライブラリ参照の欠落 | **未修正** | 変換器に `ScalarValues.kerml` を同時に渡すと名前つき `Real`・安定な `href` になることを実測(**直せる**) |
| X2 エラーモデルで 200 | **修正済みを維持** | `bad` で 409 |
| X3 JSON 不可(単位式) | **未修正(直せる)** | 422。ライブラリを追加入力すれば JSON 化できる(実測) |
| X4 elementId 非決定 | **一部修正** | 名前つき要素は安定、集合は一致。ただし ev-powertrain で 2 回の出力が不一致(8 件)、編集で関係要素の ID が約 3 割ずれる。XMI は毎回別 |
| X5(ADR)SCDL import による JSON 不可の未記載 | **修正済み**(記載) | ADR-0009 X5。実装としては直せる(実測) |
| X6 並行実行の上限 | **修正済みを維持** | 10 並行で 200 と 429。ただし並行負荷下で有効モデルが 422 になる事象を観測(不安定) |
| X7 一時ディレクトリ残存 | **維持** | 並行後も `fusamod-convert-*` 0 件 |
| 起動時 `sweepConvertTemp(0)` の全削除/親死亡時の変換器残存 | **未確認(今回は検証せず)** | コード上の変更なし |
| C2-O3 `verify`/`derive`/`refine` 未導出 | **未修正(ADR 記載済み)** | ADR-0008 |
| C2-O4 `@E` 接尾辞方式 | **維持** | `coll2` で重複 0、公式検証 OK |
| `modelRef` が文字列のみ | **未修正** | ADR-0007 追補 |
| 応答文書「X1・X4 は直せない」の断定 | **応答では「断定しない・未検証」に改めた。実測では直る** | §4.2 |
| 応答文書「JSON の elementId を決定的に」 | **一部のみ正しい** | 集合は一致、割り当ては不一致(§4.1) |
| `pnpm -r test` / `run.sh` | **維持** | 全件合格、公式実装でエラー・警告ゼロ |
| B3 jar の第三者ライセンス棚卸し | **未確認** | 証跡なし |

## 最終サマリ

- **A1: 89(減点 5、合否点 94 = 合格)/ B3: 85(減点 5、合否点 90 = 合格、余裕なし)/ C2: 89(減点 5、合否点 94 = 合格)**。3 項目とも採点は 80 以上。
- ラウンド 6 の重大指摘(サーバー停止 N1、型付き要求の `satisfy` の誤り N2、多重度 N3)は修正を実測で確認。
- 優先して直すべきは (1) `java-service.ts` の旧プロセス `exit` による状態の巻き戻し(孤児 JVM とタイムアウト後の再起動連鎖)、(2) 変換器へのライブラリ受け渡し(X1/X3/X5 が一度に解消)、(3) `stable-ids.ts` の所有者の鍵(関係要素)、
  (4) タイムアウトを 409 に化かす `needAnalysis` の分類、(5) `part def` 所有の requirement の展開(N7)。
