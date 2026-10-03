# ADR-0006: ASAM SCDL ビューは生成ビュー(最後に描画を実装)

- 状態: 採用(仕様 v1.6.0 の確認済み。描画は P6)
- 参照: ASAM SCDL Notation Specification v1.6.0 / Practical Example v1.6.0(2021-11-09)。
  仕様書は ASAM e.V. の著作物のためリポジトリには含めない。利用条件は www.asam.net/license で確認する(下記「未確認事項」)。

## 決定

1. 正本は SCDL に依存させない。SCDL は意図機能・安全機構・ASIL 分解・構造/フローのモデルから**生成するビュー**とする。
2. `@fusamod/scdl` に、附属書 A のメタモデルをそのまま型にして持つ(`packages/scdl`)。
   モデルとして判定できる制約(多重度・重複・循環・配置の整合・ペアリングの条件)を `validateScdl` で検証する。
3. 描画(幾何・自動レイアウト)は別層(P6)。図の幾何規則(重なり・内接の禁止など)は描画層の責務。

SCDL を SysML v2 のモデル上でどう持つかは [ADR-0007](0007-scdl-as-sysml-stereotypes.md) を参照。

## 仕様から分かったこと(設計への影響)

- SCDL に「意図機能」「安全機構」という専用の型は無い。**RequirementGroup**(例: "Main Function" / "Safety Mechanism")と
  **RequirementGroupPairing**、独立性の **Constraint** + **ConstraintPairing** で表す。ASIL 分解は**重み付け** `A(B)` で表す。
- 図の骨格は要求間の **Interaction**(情報/信号の授受)。出力は要求ごとに 0..1 で、複数宛先へは 1 つのインタラクションを分岐させる。入力の合流は禁止。
- 要求とエレメントは別物。要求をエレメントに**配置**する。未配置は許容(図では二重線)。
- 無干渉(CoexistenceTarget)は「エレメント → 要求/要求グループ/エレメント」の関係で、制約条件で説明する。

## safety-core との対応(P6 のマッパー設計)

| safety-core | SCDL |
|---|---|
| `StructureElement`(構造ネット) | `Element`(`parent` で入れ子) |
| `IntendedFunction` | `Requirement`(意図機能要求)を含む `RequirementGroup` |
| `SafetyMechanism` | `Requirement`(安全要求)を含む `RequirementGroup` |
| `FunctionMechanismPair` | `RequirementGroupPairing` |
| `Decomposition.independenceEvidence` | 独立要求の `Constraint` + `ConstraintPairing` |
| `SafetyRequirement.asil` / `originAsil` | `weight`(`B`、`A(B)`) |
| `SafetyRequirement.allocatedTo` | `allocation` |
| (SysML のフロー/接続/action) | `Interaction`。**安全分析コアには無い。P1 以降の SysML アダプタから取得する** |

## 未確認事項

- ASAM のライセンス条件が、製品内での記法の実装・図の出力・配布に与える制約(法務確認)
- ~~SCDL のツール間の交換形式~~ → 無い(Part 1・Part 2 のみ)。SysML v2 での表現は ADR-0007 で独自に定義する
- 重み付けの「エレメントへの割付」規則は仕様上「関連する安全規格のルールに従う」とのみ書かれている。現状は「配置された要求の最大 ASIL 以上」を警告として検査する(ISO 26262 専門家が確認)
- ペアの ASIL 分解検査は、元 ASIL を持つ要求の最大 ASIL をグループの ASIL とみなすヒューリスティック(同上)
