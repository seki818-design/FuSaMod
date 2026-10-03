# ADR-0008: SysML v2 モデルから構造ネット・機能ネットを導出する規約

- 状態: 採用(G0 で MBSE 専門家がレビュー)
- 背景: 安全分析のネット(ADR-0003)を手入力にせず、SysML v2 モデルから導出する。モデルの正本は SysML(ADR-0002 の公式パイロット実装 → 要素グラフ)。

## 規約(SysML 標準の構文のみ。ステレオタイプは不要)

| ネット | SysML v2 の書き方 | 導出 |
|---|---|---|
| 構造 | `part` の入れ子 | 構造要素。ID は完全修飾名、親は入れ子の親。階層(システム/サブシステム/…)は入れ子の深さ |
| 機能 | `action` | 機能ノード。上位機能 = その action を所有する action(機能分解) |
| 機能の担当 | `perform <action>`(part の中で宣言) | 担当要素 = perform した part。perform が無ければ、action を所有する part、または所有する action の担当要素を引き継ぐ |
| 要求 | `requirement` + `satisfy <要求> by <part>` | 要求と、実現する構造要素の紐づけ(doc を本文とする) |
| 入出力 | action の `in` / `out` パラメータ | 出力パラメータごとの故障モード候補 |

例: `examples/sysml/ev-powertrain.sysml`(車両 > パワートレイン > インバータ/モータ。上位の action を下位 action に分解し、下位の part が perform する)。

## 導出するもの / しないもの

- 導出する: 構造ネット、機能ネット(担当要素・上位機能)、要求の紐づけ、故障モード**候補**(機能単位 + 出力パラメータ単位のガイドワード)。
- 導出しない: 故障ノード(FE/FM/FC)とそのリンク。人が候補から確定する(AI は候補の絞り込みと上下のリンクを**提案**するのみ。ADR-0005)。
- 導出結果には `validateNet` の指摘(未着手の機能など)と、導出時の指摘(担当 part を決められない action、複数 part が perform、part 以外の perform/satisfy)を含める。黙って捨てない。

## 実装

- `tools/sysml-check/SysmlExtract.java`: 公式実装から要素グラフ(part / action(パラメータ・doc つき)/ requirement / perform / satisfy / 依存 / メタデータ)を出力。
- `@fusamod/sysml-graph`: グラフの型と `deriveNet`。SCDL や安全分析など利用側に依存しない。
- 端から端までのテスト: SysML の例 → グラフ → ネット導出 → 故障ノード追加 → 上位/下位の FMEA が同一ノードで繋がる。

## 定義と型付き使用の展開(2 回目のレビューでの追補)

`part def` / `action def` と、型付きの使用(`part m : Motor`、`action go : Drive`、`perform action x : Def`)を扱う(`expandGraph`、`packages/sysml-graph/src/expand.ts`)。

- 定義の中身は、定義のままでは構造に入れない。**型付きの使用ごとに、`<使用の ID>::<名前>` のインスタンスとして複製**する(`front : Motor` と `rear : Motor` は別の構造要素)。上位の型(`:>`)の中身も展開する。
- 定義の中の `perform` は、複製されたインスタンスの機能に付け替える。定義側を指す `satisfy` は、複製された要素すべてに付け替える(同じ定義の使用が複数あれば、すべてが満たすとみなす)。
- action の入出力は、使用側に宣言が無ければ型(`action def`)のものを使う。
- `satisfy` の対象が action のときは、その action の担当 part への紐づけとして扱う。
- 型を使わないモデルでは、展開は何もしない(導出結果は従来と同じ)。

## インスタンスの経路と satisfy(3 回目の追補)

- 公式実装は `satisfy r by car1.front` を定義側の特徴(`Car::front`)に解決する。そのため `SysmlExtract` は **連鎖の途中も含めて**(`byChain`: `[car1, Car::front]`)出力し、展開では**その経路のインスタンス 1 つだけ**に紐づける。経路を特定できないときは紐づけず `SATISFY_UNRESOLVED` で警告する。
- 定義側の特徴を直接指す `satisfy`(経路なし)は、すべてのインスタンスに紐づけ、複数なら `SATISFY_AMBIGUOUS` で警告する。
- `by` を省略した `satisfy`(part の中で書く)は、囲んでいる part が満たす。
- usage 側の特殊化(`part ax2 :> ax`)と再定義(`part :>> ax`)は、元の使用(と、その型)の中身を引き継ぐ。
- `ref part` は構造の入れ子ではないので、構造に入れず警告する(`UNSUPPORTED_CONSTRUCT`)。
- 入れ子の `requirement` は、親子を残す(`parentId`、トレースに「導出」リンク)。

- 定義の中の入れ子の part の中の型付き使用も展開する。定義内の `ref part` は構造に入れず警告する。多重度の上限が 1 を超える使用(`Cell[4]`)は、1 つのインスタンスとして扱い、`MULTIPLICITY_IGNORED` で警告する。
- 名前のない再定義(`part :>> main`)は、再定義している特徴の名前を使う。
- 入れ子の `requirement` は、自身に `satisfy` が無ければ親の `satisfy` を引き継ぐ。

## 導出しない構成(黙って捨てず、必ず警告する)

| 構成 | 扱い | 警告コード |
|---|---|---|
| `port` / `connection` / `interface` / `flow` / `allocation` / `state` | 無視。インターフェースや状態からの故障モード候補は出ない | `UNSUPPORTED_CONSTRUCT`(種類ごとに件数つき) |
| 再定義(`:>>`) | 元の使用をそのまま使う | `REDEFINITION_IGNORED` |
| どこからも使われていない `part def` | 構造に入れない | `DEFINITION_NOT_INSTANTIATED` |
| 自分自身を含む定義 | 展開を止める | `RECURSIVE_DEFINITION` |
| part・action 以外の `perform` / `satisfy` | 無視 | `PERFORM_NOT_PART` / `PERFORM_NOT_ACTION` / `SATISFY_NOT_PART` |

## 制約と今後

- 導出は、上記の書き方(part の入れ子・型付き使用・`perform`・`satisfy`)に限る。ref による結び付け、`allocate`、port/connection/flow による**インターフェース**、状態機械は未対応。
- 階層レベルの名称(システム/サブシステム/コンポーネント/詳細)は、**入れ子の深さ**で付ける(ADR の規約。モデルの意味を見ない)。深さ 4 以上は「詳細」にまとめる。
- 他のツールとの SysML v2 のデータ交換(SysML v2 API の REST、標準 JSON、XMI)は**未対応**。入力は公式パイロット実装が読めるテキスト記法のみ。
- 実在の MBSE 専門家による G0 の書面レビューは未実施(シミュレートした採点のみ。docs/quality/reviews/)。
