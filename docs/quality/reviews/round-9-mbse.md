# ラウンド 9 レビュー: MBSE / SysML v2 専門家の観点(A1・B3・C2)

- 立場: 独立・厳格な MBSE / SysML v2 専門家(シミュレートしたレビュアー。認証機関ではない)
- 基準: `docs/quality/rubric.md`(証拠主義、未検証は減点、外部確認待ち減点は点数と別に最大 10 点、採点そのものも 80 以上)
- 対象リビジョン: `069e894`(`fix: round-8 review findings`)。リポジトリのソース・テスト・文書は変更していない(作業物はスクラッチ `r9/mbse/` のみ)。
- 方法: `round-8-response.md` は信用せず、再実行・再現した。
  - `pnpm typecheck` / `pnpm lint` / `pnpm -r test`(safety-core 146 / sysml-graph 44 / scdl 50 / analysis 65 / ai 41 / web 20 / server 79 + skip 13)/ `FUSAMOD_IT=1 pnpm --filter @fusamod/server test`(92 件合格、187 秒)/ `./tools/sysml-check/run.sh`(SCDL.sysml・examples 9 件・model.sysml すべて errors=false warnings=false)。すべて合格。
  - サーバーは `esbuild` でスクラッチに同梱ビルドし、別ポートで `FUSAMOD_SYSML=java` 実行。変換器のタイムアウト実験用に、同梱物のコピー(スクラッチ内のみ)の 180 秒を 0.9 秒に書き換えた版を使用。終了時に、自分で起動したサーバー・JVM を PID 指定で止めた(別セッションのもののサーバー `apps/server/dist/server.mjs` が動いているが、私のものではないので触れていない)。
  - 自作モデル: 同梱 9 例の編集版(先頭・中ほど・末尾・パッケージ外への追加、`satisfy` の追加)、`m1`(typed part・特殊化・alias・再定義・`ref part`・`item`・`port`・`variation`)、`m2`(再帰定義・`variation` の使用・`part group[3]`・同名の複数パッケージ)、`m3`(`allocate`・`derive`・`verify`)、`u/a〜d`(ライブラリ判定の探り)、`evp`(`projects/ev-powertrain` の安全データつき)。
  - 公式チェック: `PilotCheck` を自分で起動し、`SCDL.sysml` と同一セッションで書き出した `scdl.sysml` を検査(errors=false warnings=false)。

## 採点サマリー

| 項目 | R8 採点 | R9 採点 | 外部確認待ち減点 | 合否点 | 判定 |
|---|---|---|---|---|---|
| A1 機能要件の充足度(MBSE 観点) | 90 | **91** | 5 | 96 | 合格(採点 80 以上) |
| B3 互換性・標準とのデータ交換 | 87 | **88** | 5 | 93 | 合格(採点 80 以上) |
| C2 MBSE 専門家の観点 | 90 | **91** | 5 | 96 | 合格(採点 80 以上) |

第 8 回の指摘(N8・N9・N10・N10b・変換のタイムアウト・`[RFC]`)は、**ほぼすべて実測で修正を確認**した。一方、**N8 の修正が引き起こした退行**と、**SCDL の取り込み判定の緩さ**という、第 8 回と同型の「修正の穴」を新たに見つけた。最重要は次の 3 点。

1. **[N11 中〜高・B3] N8 の修正により、トップレベルに 1 要素を足すだけで、モデル全体の ID が入れ替わる(退行)。** `instance-paths` の末尾(パッケージの外)に `part zzz;` を足すと、109 要素のうち 2 要素(ライブラリ)しか ID が残らない。R8 時点のコード(`61439b1`)では 109/109 が残っていた。原因は `labelOf` が、名前のない根の `Namespace` の「ラベル」に全トップレベル要素の名前を連結するため、根の鍵が変わり、全要素の鍵が変わること。N8 の回帰テストはパッケージの中への編集しか見ていない。
2. **[N12 中・B3] `SCDL` という単語が、コメントに 1 回あるだけで、SCDL のライブラリ(メタデータ定義 一式)が標準 JSON/XMI に混入する。** 同梱の `ev-powertrain`(コメントで「SCDL ステレオタイプは不要」と書いただけ)の JSON は、R8 の 227 要素から 326 要素に増え、XMI には `href="model.sysml#|9"` のような解決できない参照が 18 件出る。`package C { part p; }` の前に `// ここは SCDL の説明のみ` と書くだけで、218 要素になる。R8 で直した `[RFC]` の誤判定と同じ型の穴が、SCDL の判定(`grep -E '\bSCDL\b|@Scdl'`)に残っている。
3. **[N13 低〜中・A1/C2] `variation part def` の `variant` が、すべて同時に存在する部品として導出され、警告がない(沈黙の誤り)。** 択一の選択肢が、FMEA の構造要素として同時に入る。

## 1. 第 8 回の指摘の再検証(実測)

### 1.1 N8: `satisfy` の関係要素の ID が無関係な編集で入れ替わる — **パッケージ内の編集は修正を確認、トップレベルの編集は退行(N11)**

方法: 各モデルを、(a) パッケージ内の末尾 `part zzz; requirement 'ZZ-1'; satisfy 'ZZ-1' by zzz;`、(b) パッケージ内の先頭に `part aaa {…}`、(c) 中ほどに `part newMid`、(d) パッケージの外の末尾 `part zzz;`、(e) パッケージの外の先頭に `part aaa` を足して JSON に変換。`SatisfyRequirementUsage` ごとに、子孫の参照先の名前を取り出し、編集の前後で「ID → 参照先の名前」が変わったものを数えた。

| モデル | `satisfy` 数 | パッケージ内 (a)(b)(c) | パッケージの外 (d)(e) |
|---|---|---|---|
| ev-powertrain | 2 | ID・対応とも不変(326/326 の ID が残る) | **ID が 24/326 しか残らない**(`satisfy` の ID は全部消える) |
| redundant-architecture(13 件、同一 `E-1-2` に 2 件など) | 13 | 不変(1070/1070) | 22/1070 |
| all-stereotypes(`NF-1〜3` が同じ `SYS`) | 6 | 不変(592/592) | 22/592 |
| instance-paths | 3 | 不変(109/109) | 2/109 |
| m1(自作: 同じ要求を 2 か所で満たす) | 3 | 不変(パッケージ内の末尾追加で 136/151 の ID が残る、`satisfy` の対応の変化 0) | 未計測 |

`satisfy` の ID が別の要求を指す入れ替わり(R8 の N8)は、**パッケージ内では再現しなくなった**。N8 は修正を確認。

**[N11 中〜高・B3] 退行の再現と原因(コード読解と一致)。**

- 同じ生の変換出力に対し、R8 時点の `stable-ids.ts`(`git show 61439b1:…`)と現行を、スクラッチの `tsx` で比べた(`instance-paths` の末尾に `part zzz;`): 旧 109/109 が残る、**新 2/109**。
- 原因: `labelOf()` は、名前のない要素の鍵に「所有する要素・参照先の名前」を連結する(N8 の修正)。根の `Namespace` は名前がなく、所有する全トップレベル要素の名前が連結されるため、`/Namespace:T2` が `/Namespace:T2|zzz` に変わり、`buildKeys` が所有者の鍵を前置するので**全要素の鍵が変わる**。
- 影響: 複数パッケージのモデルで、パッケージを足す・消す、トップレベルの `part` や `import` を足す編集のたびに、全 ID が入れ替わる。版管理・差分・外部ツールとの突き合わせという ID 安定化の目的に反する。ADR-0009 X4 の「無関係な編集の前後で同じ要求を指し続ける」は、パッケージ内に限り成り立つ。
- 修正の方向: 根の `Namespace`(所有者を持たない要素)は、ラベルを空にする。もしくは `labelOf` を「名前のない要素のうち、使用・関係の種類」に限る。回帰テストに「トップレベルに要素を足しても、既存の ID が 95% 以上不変」を加える(現在の統合テストは `ev-powertrain` のパッケージ内の編集のみ)。

### 1.2 N9: 例 9 件で 2 回の出力がバイト一致か — **修正を確認**

`examples/sysml/*.sysml` の 9 件を、それぞれ別プロジェクトにして `export/model.json` を 2 回取得(計 18 回、JVM は毎回新規)し、`cmp`:

| 例 | 1 回目 / 2 回目 | バイト一致 |
|---|---|---|
| all-stereotypes | 200 / 200 | 一致 |
| def-owned-requirements | 200 / 200 | 一致 |
| definition-redefinition | 200 / 200 | 一致 |
| ev-powertrain | 200 / 200 | 一致 |
| instance-paths | 200 / 200 | 一致 |
| nested-definitions | 200 / 200 | 一致 |
| redundant-architecture | 200 / 200 | 一致 |
| requirement-paths | 200 / 200 | 一致 |
| typed-definitions | 200 / 200 | 一致 |

R8 で不一致だった all-stereotypes と redundant-architecture も一致。redundant-architecture は、さらに 3 回(計 5 回)取得して全部一致。ADR-0009 X4 の「同梱の例 9 件すべてで一致」は**事実と一致**(ただし「同一のテキストを再変換したとき」に限る。上の N11 参照)。XMI の `xmi:id` は ADR のとおり毎回異なる(置き換えない)。

### 1.3 N10b: JSON と XMI のライブラリ ID、SCDL を含む XMI の `href`、SCDL 定義を取り込んだ JSON の自己完結 — **主要部分は修正、周辺に穴(N12)**

- `Real` の ID: JSON は `904d28f1-df99-5ef5-bb01-00fad2e84d26`、XMI の `href="ScalarValues.kermlx#904d28f1-…"` と**一致**(ev-powertrain で確認。他の 5 つの `ScalarValues` の ID も XMI の `href` に含まれる)。N10b の食い違いは解消。
- SCDL を含む XMI(all-stereotypes): `SCDL.sysmlx#<UUID>` への `href` は 0。SCDL の定義は出力に取り込まれた。R8 の「配布されないファイルへの毎回変わる `href`」は解消。
- JSON の自己完結(all-stereotypes 592 要素・ev-powertrain 326 要素): 全 `@id` 参照が出力内の要素に解決する(未解決 0。R8 は 2 件)。**ただし**、SCDL 定義が取り込まれると、公式の暗黙ライブラリ(`Metaobject::annotatedElement`、`Anything` など)への参照が、**名前のない `Feature` / `Type` のスタブ**(ev-powertrain で Feature 16・Type 9)として残る。`FeatureTyping` と `Redefinition` の各 9 件がそれを指す。XMI では対応する参照が `href="model.sysml#|9"` 形式(18 件)で、他ツールが解決できる宛先ではない。ADR-0009 X1 の「Base など暗黙の要素は渡していない」に含まれるが、X5 の「対応済み」には書かれていない。
- 「自己完結」の主張(`convert.sh` のコメントと R8 応答)は、**「SCDL 定義の参照は出力内で閉じる」までは正しいが、「暗黙ライブラリへの参照はスタブ/`|N`」**であり、他ツールでの解決は未確認。外部確認待ちに含める。

**[N12 中・B3] SCDL 判定が緩く、SCDL を使わないモデルの標準出力に SCDL が混入する。**

`convert.sh` は `grep -Eq '\bSCDL\b|@Scdl'` で判定する。コメントや文字列にも反応する。

| 入力 | 結果 |
|---|---|
| `// ここは SCDL の説明のみ` + `package C { part p; }` | JSON **218 要素**(自分の要素は数個)、XMI に `ScdlElement` と `model.sysml#\|N` が 18 件 |
| `examples/sysml/ev-powertrain.sysml`(1〜2 行目のコメントに「SCDL ステレオタイプは不要」) | JSON 326 要素(R8 の 227 から増加)、XMI に `ScdlElement` が 2 件、解決できない `href` 18 件 |
| `examples/sysml/instance-paths.sysml`(コメントに SCDL なし) | XMI の `model.sysml#\|` は 0 件 |

利用者の SysML に無いライブラリ定義が標準出力に混ざり、他ツールに渡すデータが汚れる。R8 で「`[RFC]` のコメント」を直したのと同じ型の穴で、判定を `import SCDL` / `@Scdl*` の構文に限り、コメント・文字列を除く必要がある。

### 1.4 N10: 利用者の `@Scdl*` と ADR-0007 — **修正を確認(軽微な指摘あり)**

- `all-stereotypes` を読み込んだ解析に `warning SCDL_ANNOTATIONS_NOT_IMPORTED`(「モデルに @Scdl* の注釈がありますが、SCDL ビューには反映されません…」)が出る。`SCDL.sysml` の `import SCDL::*` だけで `@Scdl*` が無いモデル、`ev-powertrain`、`m1`〜`m3` では出ない(誤警告なし)。`scdl.sysml` として書き出した SCDL をそのまま新しいプロジェクトにすると、警告が出る(書き出したものを読み戻せない、が警告で明示される)。
- ADR-0007 の記述(`scdlFromGraph` は「ライブラリとしての読み込み関数。アプリの解析経路では呼ばれない」)は、`grep` の結果(`packages/analysis/src/analyze.ts` は呼ばない)と**一致**。R8 の誤記は訂正済み。
- 軽微: 警告は件数や例の要素を示さない。`@Scdl*` を書いた人が、どの要素が無視されたか分からない。
- 公式チェック: 書き出した `ScdlView_evp`(`projects/ev-powertrain` の安全データ。`@ScdlElement` の `weight`・`decomposedFrom` を含む)を `SCDL.sysml` と同一セッションで `PilotCheck` に通して errors=false warnings=false。

### 1.5 変換器のタイムアウト — **504 を確認**

スクラッチ版(変換器の制限 0.9 秒)で、同梱の ev-powertrain の `export/model.json` と `model.xmi`: どちらも **504** `{"error":"変換がタイムアウトしました"}`。ADR-0009 X6(504)と一致。R8 で 503 だった不一致は解消。

### 1.6 単位系ライブラリを読み込む条件 — **`[RFC]` 単独は修正、コメント中の「数字 + `[語]`」は残る**

| 入力(単位なし、`part p` のみ) | 変換時間(JSON) |
|---|---|
| `doc /* see [RFC] for details and [x] */`(R8 で 25 秒) | **3.0 秒**(単位系を読み込まない) |
| `doc /* per section 3 [RFC] and 5 [ISO] */` | **18.1 秒**(単位系を読み込む。出力は 7 要素のまま) |
| `doc /* time:: unit */` | 2.6 秒 |

正規表現 `[0-9)] *\[ *[A-Za-z]` が、コメントの「3 [RFC]」にも反応する。R8 の指摘(コメント・文字列を除く)は一部しか直っていない。実害は「15 秒の追加」(出力は正しい)で、N12 より軽い。

## 2. 新たな欠陥・沈黙の誤り(自作モデル)

| 検証 | 結果 | 評価 |
|---|---|---|
| `m1`: typed part・多重度・特殊化(`Truck :> Vehicle`)・alias・`:>>` の再定義・`satisfy` の対象が alias(`V.fa`)・`requirement def` 型付き | 構造 19 要素が正しい。`satisfy r1 by V.fa` は `M1::v::fa`、`r2 by t.fa.w` は `M1::t::fa::w`。入れ子の `sub` は親の `satisfy` を引き継ぐ(ADR のとおり) | 妥当 |
| `m1`: `ref part driver` | `UNSUPPORTED_CONSTRUCT`(定義側 1 件 + インスタンスごとに 3 件の重複) | 動くが、同じ警告が 4 件並ぶ。ノイズ(低) |
| `m2`: 再帰定義(`Node` が `Node` を含む、`Other` との相互再帰) | `RECURSIVE_DEFINITION` で展開を止める。`root::child` を `satisfy` の対象にできる | 妥当 |
| `m2`: `part group[3]`(使用側の多重度)・`[0..1]` | `MULTIPLICITY_IGNORED`(1 つとして扱う) | 妥当 |
| `m2`: 同名の `root` が別パッケージ | `M2::root` と `Other2::root` が別要素 | 妥当 |
| **`m2`: `variation part def Var { variant part va; variant part vb { part inner; } }` と `part vv : Var;`** | **`vv::va` と `vv::vb` と `vv::vb::inner` が、同時に存在する構造要素として入る。警告なし。`Var` が未使用のときは `DEFINITION_NOT_INSTANTIATED` だけ** | **沈黙の誤り(N13)**。バリアントは択一なので、FMEA の構造に全部入ると過大な分析対象になる |
| `m3`: 名前なし `allocate sys.a to sys.b;` | **`INVALID_ELEMENT`「完全修飾名の無い要素が 1 件あります(…モデルの誤りの可能性)」** | R8 §2.2 の指摘が未対応。ADR-0008 は「allocation は `UNSUPPORTED_CONSTRUCT`」と書く(不一致)。誤誘導 |
| `m3`: `dependency derive from R2 to R1;`・`verify R1;` | 警告なし。`R2` は `TRACE_UNCOVERED` | 既知の制約(別枠)。ADR-0008 の見出し「導出しない構成(黙って捨てず、必ず警告する)」と、`verify`/`derive` が無警告な点が矛盾 |
| `m3`: `refine dependency rd from … to …;` | 公式パーサーの構文エラー(私の記述の誤り)。公式実装由来 | 評価対象外 |
| `evp`: `projects/ev-powertrain` の安全データを PUT | 200、SCDL の要素 8・要求 9・インタラクション 3。SCDL エクスポートは `PilotCheck` 合格 | 妥当 |
| SCDL の往復 | `evscdl`(書き出した SCDL をモデルとして読み込み)は `modelOk:true`、`SCDL_ANNOTATIONS_NOT_IMPORTED` のみ | 警告で明示される |

既知の制約(N4: SCDL ID の名前ベースの不安定、`modelRef` が文字列のみ、取り込み(JSON/XMI/API)未対応、N7b: 再定義と定義内 `satisfy`、`verify`/`derive` の脱落)は、R8 から変わらず別枠。今回の再現では再評価していない。

## 3. ADR-0008 / 0009 / 0007 の記述と実装・実測の一致

| 記述 | 判定 |
|---|---|
| ADR-0009 X4「同梱の例 9 件すべてで、2 回の出力がバイト単位で一致」 | **一致**(§1.2) |
| ADR-0009 X4「標準ライブラリ要素の ID はそのまま残すので、JSON と XMI で `Real` などの ID が一致」 | **一致**(§1.3) |
| ADR-0009 X4「`satisfy` の ID は無関係な編集の前後で同じ要求を指し続ける」 | **パッケージ内の編集は一致**。パッケージの外の編集では全 ID が変わる(N11)。記載なし |
| ADR-0009 X5「`import SCDL::*` や `@Scdl*` を含むモデルは…変換できる」 | 一致。ただし判定が緩く、コメントの「SCDL」でも取り込まれる(N12)、暗黙ライブラリのスタブ/`\|N` が残る点は未記載 |
| ADR-0009 X6「タイムアウトは 504」 | **一致**(変換のタイムアウトも 504) |
| ADR-0009 X3「単位式は約 15 秒」 | 一致(コメント中の「3 [RFC]」でも 15 秒かかる点は未記載) |
| ADR-0007「`scdlFromGraph`…アプリの解析経路では呼ばれない…`SCDL_ANNOTATIONS_NOT_IMPORTED`」 | **一致** |
| ADR-0008「`allocation` は `UNSUPPORTED_CONSTRUCT`」 | 名前なしの `allocate … to …` は `INVALID_ELEMENT`(不一致が残る) |
| ADR-0008「導出しない構成は黙って捨てず、必ず警告」 | `verify` / `derive` / `variation` は無警告(不一致) |

## 4. 項目別採点

### A1. 機能要件の充足度(MBSE 観点): **91 点**(外部確認待ち減点 5、合否点 96)

| チェック項目 | 状況 | 所見 |
|---|---|---|
| SysML v2 準拠のモデリング(読み込み・検証・編集・書き出し) | 達成(取り込みは .sysml のみ) | 公式実装で検証。標準 JSON/XMI は例 9 件で再現可能に出力 |
| システム階層をモデルから自動生成 | 達成 | 入れ子・型付き・特殊化・再帰・多重度が正しい。`variation` が沈黙で全部入る(N13) |
| トレーサビリティ | 概ね達成 | `satisfy` の ID の入れ替わり(N8)は解消。`verify`/`derive` は沈黙で落ちる(既知) |
| ASAM SCDL ビュー | 達成 | 往復・公式検証 OK。`@Scdl*` の無視は警告で明示 |
| 標準形式のインポート/エクスポート | 一部 | 書き出しのみ。取り込み・API なし |

減点(合計 9 点): 取り込み・API 未対応 -2 / port・connection・allocation・state・`verify`・`derive`・`refine` が解析に使えない(うち `verify`/`derive` は無警告)-3 / SCDL ID の不安定(N4)-1 / 再定義と定義内 `satisfy` の穴(N7b)-1 / `variation` の沈黙(N13)-1 / `allocate` の誤誘導 -0.5 / 要求起点のみの影響分析 -0.5。
R8 から +1: N8・N10 の解消。

### B3. 互換性・標準とのデータ交換: **88 点**(外部確認待ち減点 5、合否点 93)

- 前進: 例 9 件で 2 回の JSON がバイト一致(R8 は 7/9)。JSON と XMI で `Real` の ID が一致。SCDL を含む XMI は配布されない `SCDL.sysmlx` を指さない。JSON の未解決参照 0。変換のタイムアウトが 504。`[RFC]` 単独で単位系を読み込まない。パッケージ内の編集で `satisfy` の ID が安定。
- 減点(合計 12 点): 取り込み(JSON/XMI/API)なし -4 / **トップレベル編集で全 ID が入れ替わる(N11)-2** / **SCDL 判定が緩く標準出力に SCDL が混入、暗黙ライブラリのスタブと `model.sysml#|N`(N12)-2** / XMI の `xmi:id` が毎回異なる、FuSaMod の ID との対応表なし -1.5 / コメント中の「数字 + `[語]`」で単位系を読み込む(+15 秒)-0.5 / 他ツールでの読み込み未確認(外部確認待ちとは別に実装側で、スタブ参照が残る点)-1 / SCDL の `href`/`|N` の扱いが ADR 未記載 -1。
- 実務家の目では、JSON は版管理に使えるところまで来た。ただし、複数パッケージのモデルでパッケージを足すたびに全 ID が変わるうえ、コメントの語で出力が汚れるので、まだ「どんな編集でも安定」ではない。

### C2. MBSE 専門家の観点: **91 点**(外部確認待ち減点 5、合否点 96)

- 長所: 定義内再定義、`requirement def`、要求側/満たす側の経路、`part def` 所有の requirement の複製、同名の根・ID 衝突の回避、再帰定義の停止、多重度の警告、`SATISFY_UNRESOLVED`、SCDL の公式検証と往復、`@Scdl*` 無視の警告と ADR-0007 の訂正。
- 減点(合計 9 点): `verify`/`derive`/`refine`(無警告)・port・connection・allocation・state が導出されない -3 / 再定義した使用での定義内 `satisfy` の欠落(N7b)-2 / **`variation` の沈黙(N13)-1** / SCDL ID の不安定(N4)・`modelRef` が文字列 -1 / `a/b` と `a::b` の ID の曖昧さ -0.5 / 名前なし `allocate` の `INVALID_ELEMENT` -0.5 / ADR-0008「必ず警告」と実装の不一致 -0.5 / `ref part` の重複警告 -0.5。

### 外部確認待ち減点(各 5 点。点数とは別枠)

- G0 の MBSE 専門家による書面レビュー(ADR-0007/0008 の導出規約、SCDL ステレオタイプ設計、展開規約、`variation` の扱い)。担当: 外部 MBSE 専門家。
- 他の SysML v2 ツール/API サーバー(公式 Pilot API、商用モデラ)での JSON / XMI / `@Scdl*` / `modelRef` の読み込み確認(特に暗黙ライブラリへのスタブ参照と `model.sysml#|N` の扱い)。担当: ツール担当 / MBSE 専門家。
- ASAM SCDL v1.6.0 仕様書との突合と法務確認、jar(jupyter-sysml-kernel 同梱物)の第三者ライセンス棚卸し。担当: 安全 + MBSE ドメイン担当 / 法務。

## 5. 次に直す点(優先順)

1. `apps/server/src/sysml/stable-ids.ts`(N11): 根の `Namespace` など所有者のない要素は `labelOf` を空にする(または名前のない要素のうち関係要素に限る)。回帰テストに「トップレベルへの要素追加で、既存 ID の 95% 以上が不変」と「`satisfy` の ID → 要求名の対応が不変」を、パッケージ外の編集でも加える。
2. `tools/sysml-check/convert.sh`(N12): SCDL 判定を、コメントと文字列を除いた上での `import SCDL` / `@Scdl*` に限る。同様に単位系の判定(「3 [RFC]」)も、コメント・文字列を除く。ADR-0009 X5 に、暗黙ライブラリのスタブ/`model.sysml#|N` が残ることを書く。
3. `tools/sysml-check/SysmlExtract.java` / `packages/sysml-graph`(N13): `variation` / `variant` を `UNSUPPORTED_CONSTRUCT`(またはバリアント警告)にする。`verify` / `derive` / `refine`、名前なし `allocate … to …` も `UNSUPPORTED_CONSTRUCT` として件数つきで警告し、`INVALID_ELEMENT` の文を実態に合わせる。ADR-0008 を実態に合わせる。
4. `packages/analysis/src/analyze.ts`: `SCDL_ANNOTATIONS_NOT_IMPORTED` に、無視した要素の件数と例を付ける。`ref part` の警告を要素ごとに 1 件にまとめる。
5. `packages/sysml-graph/src/expand.ts`(N7b/c): 使用側の再定義に、定義内の `satisfy` を引き継ぐ。
6. 中長期: JSON/XMI の取り込み、SysML v2 API クライアント、`verify`/`derive`/`refine`/port/connection/allocation の導出、`modelRef` を SysML 上の参照にする、他ツールでの実読込テスト、jar の第三者ライセンス棚卸し。

## 6. 第 8 回の指摘 → 第 9 回での確認

| 第 8 回の指摘 | 判定 | 実測の根拠 |
|---|---|---|
| N8 `satisfy` の関係要素の ID の入れ替わり | **修正済み(パッケージ内)。トップレベルで退行(N11)** | 4 例 + 自作で ID → 要求名の対応が不変。パッケージ外の編集で全 ID が変わる |
| N9 例 9 件で 2 回の出力が一致 | **修正済み** | 9/9 バイト一致、redundant-architecture は 5 回とも一致 |
| N10b JSON と XMI のライブラリ ID、SCDL 付き XMI の `href` | **修正済み** | `Real` の ID が一致、`SCDL.sysmlx` への `href` は 0 |
| SCDL 定義を取り込んだ JSON の自己完結 | **ほぼ修正(スタブ参照が残る、混入の判定が緩い: N12)** | 未解決参照 0。名前なしの `Feature`/`Type` スタブ、XMI の `model.sysml#\|N` |
| N10 利用者の `@Scdl*` の無視と ADR-0007 | **修正済み** | `SCDL_ANNOTATIONS_NOT_IMPORTED`、誤警告なし、ADR と grep が一致 |
| 変換のタイムアウトが 504 | **修正済み** | JSON・XMI とも 504 |
| `[RFC]` だけで単位系を読み込む | **一部修正** | `[RFC]` 単独は 3.0 秒、「3 [RFC]」は 18.1 秒 |
| allocate の `INVALID_ELEMENT`、`verify`/`derive` の沈黙 | 未対応(既知の制約) | `m3` |
| N4・`modelRef`・取り込み未対応・N7b | 既知の制約(未修正) | 別枠 |

## 最終サマリ

- **A1: 91(減点 5、合否点 96 = 合格)/ B3: 88(減点 5、合否点 93 = 合格)/ C2: 91(減点 5、合否点 96 = 合格)**。3 項目とも採点は 80 以上。
- R8 の主要指摘(N8・N9・N10・N10b・504・`[RFC]`)は実測で修正を確認した。
- 最重要の新規指摘: (1) N11 トップレベルに 1 要素を足すだけで全 ID が入れ替わる(N8 の修正による退行。旧 109/109 → 新 2/109)、(2) N12 コメントに「SCDL」と書くだけで SCDL のライブラリが標準 JSON/XMI に混入し、XMI に解決できない `model.sysml#|N` が出る、(3) N13 `variation` のバリアントが沈黙で全部同時に存在する部品として導出される。
