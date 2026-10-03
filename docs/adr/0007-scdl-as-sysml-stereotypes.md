# ADR-0007: SCDL メタモデルを SysML v2 のステレオタイプ(metadata def)で表す

- 状態: 採用(公式実装での検証は P0 の PoC、MBSE 専門家のレビューは G0)
- 前提: ASAM SCDL のメタモデルは SCDL 独自(Part 1・Part 2 のみ。交換形式の文書は無い)。そこで概念を取り入れ、SysML v2 の世界で扱えるようにする。

## 決定

SCDL の各メタモデル要素を、UML の「ステレオタイプ」に相当する SysML v2 の **メタデータ定義(`metadata def`)** にする。
定義は `libs/sysml/scdl/SCDL.sysml`、適用例は `examples/sysml/redundant-architecture.sysml`(`@fusamod/scdl` の `exportSysml` が生成)。

| SCDL メタモデル | SysML v2 での表現 | 理由 |
|---|---|---|
| `SCDLType.id` | 要素の宣言名(`'E-1'` の無制限名) | ID を変換せずそのまま保つ。名前の衝突は種類ごとのパッケージで避ける |
| `SCDLType.name` / `text` | `title` / `note` 属性 | 宣言名を ID に使うため |
| `Element`(入れ子) | `part` 使用 + `@ScdlElement`、入れ子が `parent`/`elements` | 構造ネット(part の分解)と同一の表現になる |
| `Requirement` / `Constraint` | `requirement` 使用 + `@ScdlRequirement` / `@ScdlConstraint` | SysML 標準の要求をそのまま使う |
| `allocation` / `isAllocated` | 標準の `satisfy <要求> by <エレメント>`(無ければ未配置) | 要求の充足は SysML の標準的な書き方 |
| `Interaction`(出力元 1・宛先 1..*) | `dependency` + `@ScdlInteraction`(client=出力元, supplier=宛先) | 1 対多の形が一致 |
| `RequirementGroup` | `metadata <id> : ScdlRequirementGroup about <要求>, ...` | 複数要求への注釈=グループ。1 要求が複数グループに属せる(0..*)のも一致 |
| `RequirementGroupPairing` / `RequirementPairing` | `dependency` + `@ScdlRequirementGroupPairing` / `@ScdlRequirementPairing` | 2 者の間の関係。順序に意味は無い |
| `CoexistenceTarget`(無干渉) | `dependency` + `@ScdlCoexistence`(client=干渉元エレメント, supplier=干渉先) | |
| `ConstraintPairing` | `dependency` + `@ScdlConstraintPairing`(client=制約条件, supplier=ペアリング/無干渉) | 関係を関係に結ぶ形 |
| `Weight` | `weight` / `decomposedFrom` 属性(`A(B)` = weight A, decomposedFrom B) | ISO 26262 の分解表記を損なわず保持 |

SCDL に無い拡張は 2 つだけで、どちらも任意属性: `ScdlRequirementGroup.role`(`intendedFunction` / `safetyMechanism`)と
`ScdlRequirement.isExternal`(システム境界の外側の相手要求。図では表示が省略される要求)。

## 実装

- `exportSysml(model, {packageName})`: SCDL モデル → SysML v2 テキスト。
- `scdlFromGraph(graph)`: 公式パイロット実装が出力した要素グラフ(完全修飾名で解決済み)から SCDL モデルを組み立てる。**本番の読み込み経路。**
- `importSysml(text)`: ステレオタイプが付いた宣言だけを読む部分パーサー(Java 無しで動く簡易版)。名前は末尾一致で解決するため、
  解決できない/曖昧な参照はエラー。未対応の構文もエラー(黙って捨てない)。
- 書き出し → 読み込みの往復でモデルが一致することをテストで保証する。

## 検証の状況

- **公式パイロット実装(0.62.0)で検証済み。** `tools/sysml-check/run.sh` が、ライブラリと `examples/sysml/*.sysml` をエラー・警告ゼロで通す。
  誤りを入れた対照実験では、不正な enum 値・未知の属性・適用先の誤り(`annotatedElement` 制約)・未解決の参照・属性の二重指定を検出した。
  つまりステレオタイプは UML のプロファイルと同様に型として検査される。
- 公式実装での検証で見つかり、修正した点: ① 上書き可能な既定値は `= false` ではなく `default false`(`=` は束縛で上書き不可)
  ② `satisfy ... by` の対象は特徴連鎖なので、入れ子の part は `::` ではなく `.` でたどる(`dependency` の端は `::` のまま)。
- 公式実装から取り出した要素グラフ(`examples/sysml/*.graph.json`)を `scdlFromGraph` で SCDL モデルに戻すと、元のモデルと完全に一致する。
- 未確認: 名前つきメタデータ使用(要求グループ)と `dependency`(ペアリング)を別の `dependency` の端にする書き方は、公式実装では通ったが、
  他のツール(商用モデラなど)での解釈は未確認。MBSE 専門家のレビュー項目(G0)。

## 代替案と今後

- インタラクションは、意図機能や安全機構が SysML の action/flow で書かれた段階では、`flow`/`succession` から導出する方が自然。
  現在の `dependency` 表現は、要求レベルで書く場合の最小形。振る舞いモデルが入った時点で再検討する。
- 要求グループをパッケージ+`alias` で表す案もあったが、`about`(アノテーション)の方が「ステレオタイプ適用」としての意味が明確なため採用しなかった。


## 追補: 拡張属性と制約

- 拡張属性(ASAM 仕様には無い): `ScdlRequirementGroup.role`、`ScdlRequirement.isExternal`、**`ScdlType.modelRef`**(元のモデル要素=構造要素の完全修飾名。生成した SCDL から元のモデルへ機械的にたどるため)。
- エレメントの ID は、構造要素の名前に基づく(根は名前、子は `親/名前`)。兄弟の並べ替えや、別名の根の追加では変わらない(**同名の根が複数あるモデルに、さらに同名の根(別パッケージ)を足すと、`#2`、`#3` の割り当てがずれうる**。完全修飾名の順で決めるため、並び順には依存しない)。名前を変えると ID が変わる(`modelRef` は完全修飾名で追跡できる)。
- エレメント・要求・制約条件・要求グループの ID は、種類をまたいで一意でなければならない(`ID_COLLISION`)。
- SCDL にエラー(`validateScdl` や生成時の参照エラー)がある間は、SysML としての書き出しを拒否する(API は 409)。
- 他の SysML v2 ツールが `@Scdl*` のステレオタイプ(`SCDL.sysml`)を読めるかは**未確認**(外部確認待ち)。
- **正本は 2 つ**(SysML モデル + `safety.json`)。SCDL(`@Scdl*`)はそこから生成する派生物で、人が `@Scdl*` を直接編集して正本にする運用は想定しない(読み込みは往復確認とツール間の交換のため)。
- 同名のエレメントの `#2` のような区別は、**完全修飾名の順**で割り当てる(並び順に依存しない。同名の根を足すと割り当てが変わりうる)。エレメントの ID は、要求・制約条件・要求グループ・ペア・信号フローの ID と衝突しないよう、衝突する名前には `@E` を付ける。
- 安全要求が SysML の requirement を詳細化している(`refines`)ときは、SCDL の要求の `modelRef` にその完全修飾名が入る。
