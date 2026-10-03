# ラウンド 10 レビュー: MBSE / SysML v2 専門家の観点(A1・B3・C2)

- 立場: 独立・厳格な MBSE / SysML v2 専門家(シミュレートしたレビュアー。認証機関ではない)
- 基準: `docs/quality/rubric.md`(証拠主義、未検証は減点、外部確認待ち減点は点数と別に最大 10 点、採点そのものも 80 以上)
- 対象リビジョン: `4ca1753`(`docs: add round-9 response`。コード修正は `6b10d99`)。リポジトリのソース・テスト・文書は変更していない(作業物はスクラッチ `r10/mbse/` のみ。`git status` は clean)。
- 方法: `round-9-response.md` は信用せず、再実行・再現した。
  - `pnpm typecheck` / `pnpm lint` / `pnpm -r test`(safety-core 158 / sysml-graph 44 / scdl 50 / analysis 65 / ai 43 / web 20 / server 83 + skip 15)すべて合格。`FUSAMOD_IT=1 pnpm --filter @fusamod/server test` は 98 件合格。`./tools/sysml-check/run.sh` は SCDL.sysml・例 9 件・model.sysml すべて errors=false warnings=false。
  - 変換は、サーバーの `convertModel`(= `convert.sh` + `stable-ids.ts`)をスクラッチの `tsx` から直接呼んで測定。解析・導出・SCDL は、自分で別ポート(18810、`FUSAMOD_SYSML=java`)に起動したサーバーの API で測定。終了時に、自分の PID 指定で停止し、残プロセスなしを確認した。
  - 自作モデル: `a1〜a3`・`b1〜b3`・`c1`(定義/型付き/特殊化/再定義/`derive`/`allocate`/`verify`/`variation`/`connection`/`port`/`state`/`exhibit state`/`perform` の経路)、`s1〜s5`(SCDL 判定の探り)、`t1〜t9`・`c1〜c5`・`r1〜r3`(コメント除去の探り)、`mp*`(複数パッケージの編集)、書き出した SCDL の往復。

## 採点サマリー

| 項目 | R9 採点 | R10 採点 | 外部確認待ち減点 | 合否点 | 判定 |
|---|---|---|---|---|---|
| A1 機能要件の充足度(MBSE 観点) | 91 | **92** | 5 | 97 | 合格(採点 80 以上) |
| B3 互換性・標準とのデータ交換 | 88 | **90** | 5 | 95 | 合格(採点 80 以上) |
| C2 MBSE 専門家の観点 | 91 | **91** | 5 | 96 | 合格(採点 80 以上) |

第 9 回の主要指摘 N11・N12 は、**実測で修正を確認**した(N12 はコメントに関する部分のみ。下記)。一方、**N12 の修正そのものが作った退行(N15)**と、**新規の沈黙の誤り(N14)**を見つけた。最重要は次の 3 点。

1. **[N15 中・B3] コメント除去の perl 正規表現が、文字列内の `//` や `/*`、行コメント内の `/*` で誤動作し、本物の `import SCDL::*` / `@Scdl*` を「コメント」として消す。SCDL ライブラリが取り込まれず、HTTP 200 のまま不完全な JSON/XMI が出る(沈黙の誤り)。** 第 9 回の修正で入った退行(修正前の生 `grep` では起きない)。再現手順は §1.2。
2. **[N14 低〜中・A1/C2] `exhibit state st : S;` が、警告なしで「機能(action)」として導出される**(FMEA の機能ノードになり、故障モード候補の対象になる)。素の `state st1 : S;` は `UNSUPPORTED_CONSTRUCT` で警告されるのに、`exhibit` を付けると警告されない。ADR-0008 の「`state` は `UNSUPPORTED_CONSTRUCT`」と不一致。
3. **[N13・既知だが未対応] `variation` の `variant` が、無警告で全部同時に存在する部品として導出される**(`opt::x` と `opt::y` が両方入る)。`verify` / `derive` / `refine` / 名前なし `allocate` も第 9 回から変化なし。ADR-0008 の「導出しない構成は、黙って捨てず、必ず警告する」の見出しが、実装とまだ合わない。

## 1. 第 9 回の指摘の再検証(実測)

### 1.1 N11: トップレベルの編集で全 ID が入れ替わる — **修正を確認**

`convertModel(…, "json")` で、各例の(a)末尾に `part zzz;`、(b)先頭に `part aaa;` を足し、`payload.elementId` が編集前の出力にどれだけ残るかを測定。

| 例 | 要素数(元 → 編集後) | (a) 末尾の追加で残る ID | (b) 先頭の追加で残る ID |
|---|---|---|---|
| instance-paths | 109 → 111 | **109 / 109** | **109 / 109** |
| ev-powertrain | 113 → 115 | **113 / 113** | **113 / 113** |
| redundant-architecture | 1070 → 1072 | **1070 / 1070** | **1070 / 1070** |

(第 9 回は instance-paths で 2/109。)さらに自作の複数パッケージ `mp`(P1・P2、`satisfy` 各 1)で、先頭に `P0`、末尾に `P3` を追加: **55/55 が残り、`satisfy` 2 件の ID も不変**。`P1` を削除して `P2` だけにしても、`P2` の 26 要素の ID は全部残った。`stable-ids.ts` の変更は、根の `Namespace` のラベルを空にする 2 行で、第 9 回の「修正の方向」と一致する。統合テストは `instance-paths` への `part zzz;` で「90% 超が不変」を見る(実測は 100%)。

なお第 9 回で気づいた ev-powertrain の要素数は **326 → 113** に戻った(コメントの「SCDL」でライブラリが入らなくなったため。§1.2)。

### 1.2 N12: ライブラリの混入判定 — **コメントの誤判定は修正。ただし修正が新しい穴(N15)を作った**

**(a) 誤混入の解消(修正を確認)。** 次はいずれも SCDL / 単位系を取り込まなかった(JSON の要素数は自分の要素のみ)。

| 入力 | 結果 |
|---|---|
| `// SCDL note` + `package C1 { part p; }` | 5 要素、SCDL なし |
| `doc /* import SCDL::* ; @ScdlElement */` | 7 要素、ライブラリなし |
| `doc /* per section 3 [RFC] and 5 [ISO] */`(R9 は 18 秒) | 7 要素、**3.0 秒** |
| `attribute s = "SCDL:: x"`(文字列) | 9 要素、SCDL なし |
| `/* [RFC] */ // [kg]` | 7 要素、**2.6 秒** |
| `examples/sysml/ev-powertrain.sysml`(R9 は 326 要素、XMI に解決できない `href` 18 件) | **113 要素**、SCDL なし、XMI の `model.sysml#\|` は 0 件 |

**(b) 本物の構文は取り込まれる(確認)。** `import SCDL::*; part p { @ScdlElement; }` → 224 要素(SCDL 定義入り)。`ISQ::*` / `SI::*` の import と `[kg]` → 17 秒で成功(単位系入り)。`all-stereotypes` / `redundant-architecture` は SCDL 入りで変換できる。

**(c) [N15 中・B3] コメント除去の順序が悪く、本物のコードを消す。** `convert.sh` の perl は「ブロックコメント → 行コメント → 文字列 → 引用名(`'…'`)」の順に消す。字句の文脈(文字列の中にあるか)を見ずに順に消すため、次が誤動作する。

| 入力(すべて公式パーサーは `modelOk: true`) | 期待 | 実測 |
|---|---|---|
| **`s5`**: `part src { attribute u = "http://example.org/b"; }` の後ろに `private import SCDL::*;` と `part p { @ScdlElement {…} attribute w = "x"; }` | SCDL 取り込み | **取り込まれない**。JSON 31 要素(`MetadataDefinition` 0 件、`@ScdlElement` は名前のない `Type` のスタブ)、XMI に解決できない `model.sysml#\|` が 3 件。**HTTP 200** |
| **`s4`**: 1 行目 `// generated from docs/*.md`、`import SCDL::*` と `@ScdlElement`、最後に `/* end of model */` | 取り込み | **取り込まれない**。JSON 19 要素、`MetadataDefinition` 0 件、XMI に `\|N` が 3 件。HTTP 200 |
| `t2`: `attribute u = "a /* b"; … part q { @ScdlElement; } … attribute v = "c */ d";` | 取り込み | 取り込まれない(25 要素) |
| `t3`: `part 'a//b'; part q { @ScdlElement; }`(同じ行) | 取り込み | 取り込まれない |
| `t5`: `// start /* here` の次の行に `@ScdlElement`、後ろに `/* … */` | 取り込み | 取り込まれない |
| `t1`/`t6`/`t4`(`"http://…"` の後ろ、同じ行でない/後ろに別の文字列がない/コメント内のアポストロフィ) | 取り込み | 取り込まれる(偶然。`t1` は後続の `"` が無いので文字列規則が不成立) |

原因: (1) `s{//[^\n]*}{}` が文字列内の `//` 以降を行末まで消し、閉じ引用符も消えるため、その後の `"…"` の規則が、次の文字列の開始引用符まで(行をまたいで)を 1 つの文字列として消す。(2) `s{/\*.*?\*/}{}gs` が先に走るため、行コメントや文字列の中の `/*` から、離れた `*/` までのコードを消す。

影響: 第 9 回の修正前は生の `grep` だったため、この退行は無かった。URL を文字列に書き、その後ろで SCDL を使い、さらに後ろに別の文字列がある、は十分ありうる。出力は **HTTP 200・エラーなし**で、他ツールに渡す JSON/XMI から SCDL のメタデータ定義が欠ける。ADR-0009 X5 の「`import SCDL::*` や `@Scdl*` を含むモデルは…変換できる」が、この条件で成り立たない。
統合テストの N12 の回帰テストは「コメントに SCDL」を見るだけで、**本物の `import SCDL` / `@Scdl*` を取り込めること**、文字列・引用名を含むモデルを検査しない(正の例のテストが無い)。
修正の方向: 1 パスの字句解析(コメント・文字列・引用名を 1 つの正規表現の選択肢にして左から走査し、コードだけを残す)にする。判定は、そのコード部分で行う。回帰テストに §1.2(c) の 5 例と正の例を加える。

**(d) 副次**: `! grep -Eq '^[[:space:]]*(library[[:space:]]+)?package[[:space:]]+SCDL\b' "$file"` は元のファイルを見るので、コメント内の行頭 `package SCDL` で SCDL 取り込みを抑止しうる(未再現、低)。

### 1.3 例 9 件で 2 回の出力がバイト一致か — **JSON は 9/9 一致、XMI は記載のとおり不一致**

各例を `convertModel` で JSON と XMI を 2 回ずつ(計 36 回、JVM は毎回新規)。

| 形式 | 結果 |
|---|---|
| JSON | **9 例すべてでバイト一致**(all-stereotypes、def-owned-requirements、definition-redefinition、ev-powertrain、instance-paths、nested-definitions、redundant-architecture、requirement-paths、typed-definitions) |
| XMI | 9 例すべて `cmp` で不一致(`xmi:id` が毎回ランダム)。ADR-0009 X4 に記載どおり(置き換えない) |

SCDL 入りの `all-stereotypes` と `redundant-architecture` の XMI には、`model.sysml#|N` 形式の解決できない参照が各 18 件残る(暗黙ライブラリへの参照。ADR 未記載のまま)。他の 7 例は 0 件。SCDL 定義自体への `SCDL.sysmlx#` の `href` は 0 件。JSON の未解決の `@id` 参照は、書き出した SCDL をモデルとして読み込んだ `scdlrt`(878 要素)で 0 件。

### 1.4 ADR-0008 / 0009 の記述と実装・実測の一致

| 記述 | 判定 |
|---|---|
| ADR-0009 X4「同梱の例 9 件すべてで、2 回の出力がバイト単位で一致」 | **JSON は一致**(§1.3)。トップレベル編集での ID の安定は第 9 回の指摘どおり**修正済み**(§1.1)。ただし ADR にはトップレベル編集での安定が書かれていない |
| ADR-0009 X5「`import SCDL::*` や `@Scdl*` を含むモデルは…変換できる」 | **文字列の `//` や `/*` を含む場合に不成立**(N15)。暗黙ライブラリの `\|N` 参照が残る点も未記載 |
| ADR-0009 X3「単位式は約 15 秒」 | 一致(17 秒)。コメント中の「3 [RFC]」では 3.0 秒に改善 |
| ADR-0009 X6「タイムアウトは 504」 | 第 9 回で確認済み、変更なし(今回は再測定せず) |
| ADR-0008「`port`/`connection`/…/`state` は `UNSUPPORTED_CONSTRUCT`」 | `port`・`connection`・素の `state` は警告(件数と例つき)。**`exhibit state` は警告なしで機能に導出される**(N14) |
| ADR-0008「`allocation` は `UNSUPPORTED_CONSTRUCT`」 | 名前なしの `allocate … to …` は **`INVALID_ELEMENT`「完全修飾名の無い要素が 1 件あります(同じ名前の重複など、モデルの誤りの可能性)。無視しました」**。文言が実態と違う(第 9 回から変化なし) |
| ADR-0008「導出しない構成は黙って捨てず、必ず警告」 | `variation`/`variant`・`dependency derive/refinement`・`verify`・`verification def` は無警告(第 9 回から変化なし。ADR 見出しと不一致) |
| ADR-0008「`verify`/`derive`/`refine` は導出していない」 | この一文は正しい。ただし警告が出ない点は書かれていない |

## 2. 新たな欠陥・沈黙の誤り(自作モデル)

| 検証 | 結果 | 評価 |
|---|---|---|
| `b3`: `part h1 { state st1 : S; }` と `part h2 { exhibit state st2 : S; }` | `st1` は `UNSUPPORTED_CONSTRUCT`(例: `B3::h1::st1`)。**`st2` は警告なしで機能ノード `B3::h2::st2`(担当 `h2`)になる** | **N14(新規、沈黙の誤り)**。`SysmlExtract.java` で `ExhibitStateUsage` が `PerformActionUsage` の分岐(200 行目付近)に先に入り、`perform` + `action` として出力される。状態機械が機能として FMEA の故障モード候補の対象になる |
| `b1`: `variation part def Opt { variant part x; variant part y; } part opt : Opt;` | `opt::x`・`opt::y` が両方、構造要素に入る。警告なし | N13(第 9 回から変化なし。未対応と応答書に明記) |
| `b1`: 名前なし `allocate veh.ctrl to veh.brake;` | `INVALID_ELEMENT`(文言が誤誘導) | 第 9 回から変化なし。応答書で未対応と明記 |
| `b1`/`b3`: `dependency derive from R2 to R1;`・`dependency refinement …`・`dependency from R3 to R1;`・`verification def V1 { objective obj { verify R1; } }` | 無警告で落ちる。`R2`/`R3` は `TRACE_UNCOVERED` | 既知の制約(別枠)。ただし警告が出ないので、利用者は「要求が孤立している」と受け取る(誤誘導の余地) |
| `b1`: `connection c connect …`・`port pp : P` | `UNSUPPORTED_CONSTRUCT`(件数と例つき) | 妥当 |
| `b1`: `action top : Top`(どの part にも属さない action 型) | `FUNCTION_NO_OWNER` ×3、機能には入らない | 妥当(担当不明を明示) |
| `b2`: usage 側の特殊化 `part r :> p`・型付き `part s : S1`・再定義 `part s2 :> s { part :>> q2 { part extra; } }`・`satisfy R1 by s2.q2.extra`・入れ子要求 `satisfy R3.R3a by s2` | 構造 9 要素が正しい。`R1 → p`(`part p { satisfy R1; }`)と `R1 → s2::q2::extra`、`R3::R3a → s2` が正しく付く。`R3` は未カバー表示(`uncovered: ['B2::R3']`)で、入れ子の子が満たされていても親は未カバー | 妥当(親要求の扱いは設計判断) |
| `a3`: 相互再帰定義・`part y[3] : B`・`ref part rr : B` | `RECURSIVE_DEFINITION` ×2、`MULTIPLICITY_IGNORED`、`UNSUPPORTED_CONSTRUCT`(ref part は 1 件にまとまった: 第 9 回の「4 件の重複」は解消) | 妥当 |
| `c1`: 型付き `perform` と、別 part からの `perform sys.chain.a2`、同じ型の 2 インスタンス(`ecu`/`backup`)が同じ要求を満たす | 機能 6 件。`ecu::d` と `backup::d` は別ノード。`rs` は両方に付く。`perform sys.chain.a2` は `other` の担当 | 妥当(`FUNCTION_HIERARCHY` の警告も適切) |
| SCDL の往復: `projects/ev-powertrain` の安全データから `scdl.sysml`(112 行)を書き出し、新規プロジェクトとして読み込み | `modelOk: true`、構造 8 要素、`SCDL_ANNOTATIONS_NOT_IMPORTED` で明示。JSON 878 要素・未解決参照 0、XMI も 200 | 妥当(往復は警告つきの一方向。注釈の取り込みは未対応のまま) |
| 公式チェック(`./tools/sysml-check/run.sh`) | SCDL.sysml・例 9 件・model.sysml すべて errors=false warnings=false | 合格 |
| 引用名 `'vehicle/powertrain'` を含む SCDL の構造の ID | ID に引用符が残る(`ScdlView…::'vehicle/powertrain'`)。`a/b` と `a::b` の曖昧さは第 9 回から変化なし | 低(既知) |

既知の制約(N4: SCDL ID の名前ベースの不安定、`modelRef` が文字列のみ、取り込み(JSON/XMI/API)未対応、N7b: 再定義と定義内 `satisfy`)は第 9 回から変わらない。別枠として、今回は再評価せず据え置いた。

## 3. 項目別採点

### A1. 機能要件の充足度(MBSE 観点): **92 点**(外部確認待ち減点 5、合否点 97)

| チェック項目 | 状況 | 所見 |
|---|---|---|
| SysML v2 準拠のモデリング(読み込み・検証・編集・書き出し) | 達成(取り込みは .sysml のみ) | 公式実装で検証。JSON は 9 例でバイト一致。文字列を含む SCDL 利用で不完全な出力(N15) |
| システム階層をモデルから自動生成 | 達成 | 入れ子・型付き・特殊化・再定義・再帰・多重度が正しい。`variation` が全部入る(N13)、`exhibit state` が機能になる(N14) |
| トレーサビリティ | 概ね達成 | `satisfy` の ID は編集に対して安定(N11 解消)。`verify`/`derive`/`refine` は無警告で落ちる(既知) |
| ASAM SCDL ビュー | 達成 | 往復・公式検証 OK。`@Scdl*` の無視は警告で明示 |
| 標準形式のインポート/エクスポート | 一部 | 書き出しのみ。取り込み・API なし |

減点(合計 8 点): 取り込み・API 未対応 -2 / port・connection・allocation・state・`verify`・`derive`・`refine` が解析に使えない(うち `verify`/`derive` は無警告)-3 / SCDL ID の不安定(N4)-1 / 再定義と定義内 `satisfy` の穴(N7b)-1 / `variation` の沈黙(N13)-0.5 / `exhibit state` の沈黙(N14)-0.5。
R9 から +1: N11 の解消で標準 JSON が編集に対して安定したことを評価(B3 側と重複しないよう、A1 は 0.5 の上積みに留め、残りは N13 の据え置きで相殺)。

### B3. 互換性・標準とのデータ交換: **90 点**(外部確認待ち減点 5、合否点 95)

- 前進: N11 の解消(トップレベルの追加・削除で ID が 100% 残る。3 例 + 複数パッケージ)。ev-powertrain の JSON が 113 要素に戻り、他ツールに渡すデータが汚れない。単位系の誤読み込み(コメントの「3 [RFC]」)が解消(18 秒 → 3 秒)。JSON は 9 例すべてで 2 回の出力がバイト一致。
- 減点(合計 10 点): 取り込み(JSON/XMI/API)なし -4 / **コメント除去の誤動作で SCDL が欠け、HTTP 200 のまま不完全な JSON/XMI(N15)-2** / XMI の `xmi:id` が毎回異なる、FuSaMod の ID との対応表なし -1.5 / SCDL 入りの XMI に解決できない `model.sysml#\|N`(各 18 件)が残る、ADR 未記載 -1 / 回帰テストが正の例(本物の `import SCDL` / `@Scdl*`、文字列・引用名)を見ない -0.5 / 他ツールでの読み込み未確認(外部確認待ちとは別に、スタブ参照が残る点)-1。
- 実務家の目では、JSON は版管理に使えるところまで来た(編集に対する ID の安定が実測で確認できた)。ただし、変換前の前処理(SCDL 判定)が字句を理解しない正規表現で、無音で出力の質を落とす穴が残っている。

### C2. MBSE 専門家の観点: **91 点**(外部確認待ち減点 5、合否点 96)

- 長所: 定義内再定義、`requirement def`、要求側/満たす側の経路、`part def` 所有の requirement の複製、同名の根・ID 衝突の回避、再帰定義の停止、多重度の警告、`SATISFY_UNRESOLVED`、SCDL の公式検証と往復、`@Scdl*` 無視の警告、ID の編集安定性。
- 減点(合計 9 点): `verify`/`derive`/`refine`(無警告)・port・connection・allocation・state が導出されない -3 / 再定義した使用での定義内 `satisfy` の欠落(N7b)-2 / `variation` の沈黙(N13)-1 / **`exhibit state` が機能に誤分類(N14)-0.5** / SCDL ID の不安定(N4)・`modelRef` が文字列 -1 / `a/b` と `a::b` の ID の曖昧さ -0.5 / 名前なし `allocate` の `INVALID_ELEMENT` の文言 -0.5 / ADR-0008「必ず警告」と実装の不一致(未修正)-0.5。
- R9 と同点: N11(B3 側の項目)の解消に対し、N14 の新規の誤分類と、ADR と実装の不一致が未修正であることで相殺。

### 外部確認待ち減点(各 5 点。点数とは別枠)

- G0 の MBSE 専門家による書面レビュー(ADR-0007/0008 の導出規約、SCDL ステレオタイプ設計、展開規約、`variation` と `exhibit state` の扱い)。担当: 外部 MBSE 専門家。
- 他の SysML v2 ツール/API サーバー(公式 Pilot API、商用モデラ)での JSON / XMI / `@Scdl*` / `modelRef` の読み込み確認(特に暗黙ライブラリへのスタブ参照と `model.sysml#|N` の扱い)。担当: ツール担当 / MBSE 専門家。
- ASAM SCDL v1.6.0 仕様書との突合と法務確認、jar(jupyter-sysml-kernel 同梱物)の第三者ライセンス棚卸し。担当: 安全 + MBSE ドメイン担当 / 法務。

## 4. 次に直す点(優先順)

1. `tools/sysml-check/convert.sh`(N15): コメント除去を、コメント・文字列・引用名を 1 つの選択肢にした 1 パスの走査(例: `s{(/\*.*?\*/|//[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')}{ substr($1,0,1) =~ m{[/]} ? " " : "" }gse` のように、先頭の文字で分岐)に置き換える。回帰テストに、§1.2(c) の `s4`・`s5`・`t2`・`t3`・`t5` と、本物の `import SCDL::*` / `@ScdlElement` / `[kg]` の正の例を加える。出力の SCDL 欠落は、変換後に `@Scdl*` の参照が名前のない `Type` になっていないかを検査してエラーにする。
2. `tools/sysml-check/SysmlExtract.java`(N14): `ExhibitStateUsage` を `PerformActionUsage` より先に判定し、`StateUsage` として `UNSUPPORTED_CONSTRUCT` の対象にする。回帰テストに `exhibit state` を加える。
3. `tools/sysml-check/SysmlExtract.java` / `packages/sysml-graph`(N13): `variation` / `variant`、`verify` / `derive` / `refine`、名前なし `allocate … to …` を `UNSUPPORTED_CONSTRUCT`(件数つき)で警告し、`INVALID_ELEMENT` の文言を実態に合わせる。ADR-0008 を実態に合わせる。
4. ADR-0009 X4/X5 に、トップレベル編集での ID の安定、暗黙ライブラリの `|N` 参照の残りを書く。
5. `packages/analysis/src/analyze.ts`: `SCDL_ANNOTATIONS_NOT_IMPORTED` に、無視した要素の件数と例を付ける。
6. `packages/sysml-graph/src/expand.ts`(N7b/c): 使用側の再定義に、定義内の `satisfy` を引き継ぐ。
7. 中長期: JSON/XMI の取り込み、SysML v2 API クライアント、`verify`/`derive`/`refine`/port/connection/allocation の導出、`modelRef` を SysML 上の参照にする、他ツールでの実読込テスト、jar の第三者ライセンス棚卸し。

## 5. 第 9 回の指摘 → 第 10 回での確認

| 第 9 回の指摘 | 判定 | 実測の根拠 |
|---|---|---|
| N11 トップレベル編集で全 ID が入れ替わる | **修正済み** | 3 例 + 複数パッケージ(追加・削除)で 100% 残る |
| N12 コメントの「SCDL」「[RFC]」でライブラリ混入 | **コメント・文字列の誤混入は修正。ただし新しい穴 N15** | 6 種の誤混入ケースは解消、ev-powertrain 326 → 113 要素。文字列内の `//`・`/*` で本物の SCDL が欠落(HTTP 200) |
| 例 9 件で 2 回の出力がバイト一致 | **JSON 9/9 一致** | XMI は `xmi:id` が毎回異なる(ADR 記載どおり) |
| コメント中の「数字 + `[語]`」で単位系 | **修正済み** | 18.1 秒 → 3.0 秒 |
| N13 `variation` の沈黙 | 未修正(応答書に明記) | `b1` で `opt::x`・`opt::y` が両方入る |
| 名前なし `allocate` の文言、`verify`/`derive` の無警告 | 未修正(応答書に明記) | `b1`/`b3` |
| N4・`modelRef`・取り込み未対応・N7b | 既知の制約(未修正) | 別枠 |

## 最終サマリ

- **A1: 92(減点 5、合否点 97 = 合格)/ B3: 90(減点 5、合否点 95 = 合格)/ C2: 91(減点 5、合否点 96 = 合格)**。3 項目とも採点は 80 以上。
- R9 の N11・N12(コメント誤混入)・コメント中の `[RFC]` は実測で修正を確認。typecheck / lint / 単体 / 結合(98 件)/ 公式チェックは合格。
- 最重要の新規指摘: (1) **N15** コメント除去の正規表現が文字列内の `//`・`/*` で本物の `import SCDL` / `@Scdl*` を消し、HTTP 200 のまま SCDL 定義の欠けた JSON/XMI を返す(R9 の修正による退行)、(2) **N14** `exhibit state` が警告なしで機能に導出される、(3) N13 / `verify`・`derive`・名前なし `allocate` の無警告は未修正。
