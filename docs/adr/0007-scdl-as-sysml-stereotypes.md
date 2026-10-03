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
- `importSysml(text)`: ステレオタイプが付いた宣言だけを読む部分パーサー。未対応の構文はエラー(黙って捨てない)。
  完全な SysML v2 パーサーは SysML アダプタ(ADR-0002)の責務で、置き換え後も同じモデル型(`ScdlModel`)を返す。
- 書き出し → 読み込みの往復でモデルが一致することをテストで保証する。

## 検証の状況(重要)

- 構文は、OMG 公式の SysML v2 リリース(KerML/SysML のテキスト BNF、ライブラリ `ModelingMetadata`・`CauseAndEffect` 等と
  メタデータ事例)に照らして書いた。第三者製の ANTLR 実装(`sysml-v2-lsp`)では、ライブラリと生成例に構文エラーは出なかった。
  ただしこの実装は未解決の参照を検出しない。
- **公式パイロット実装での検証は未実施。** P0 の PoC で、ライブラリ・生成例を取り込み、型・参照・多重度が通ることを確認する。
- 特に確認したい点: ① 名前付きメタデータ使用(要求グループ)や `dependency`(ペアリング)を別の `dependency` の端にすること
  ② `about` による群の注釈が、モデル参照 API で扱いやすいか。

## 代替案と今後

- インタラクションは、意図機能や安全機構が SysML の action/flow で書かれた段階では、`flow`/`succession` から導出する方が自然。
  現在の `dependency` 表現は、要求レベルで書く場合の最小形。振る舞いモデルが入った時点で再検討する。
- 要求グループをパッケージ+`alias` で表す案もあったが、`about`(アノテーション)の方が「ステレオタイプ適用」としての意味が明確なため採用しなかった。
