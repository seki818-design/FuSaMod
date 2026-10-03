/*
 * SCDL ステレオタイプ・ライブラリ(SysML v2)
 *
 * ASAM SCDL v1.6.0 のメタモデル(附属書 A)の概念を、SysML v2 のメタデータ定義(metadata def)で表す。
 * 「ステレオタイプ」に相当するのが metadata def、「適用」に相当するのが @Name { ... } または
 * metadata ... about ... である。
 *
 * 対応(SCDL メタモデル → SysML v2):
 *   Element                  → part 使用 + @ScdlElement(入れ子が parent/elements)
 *   Requirement              → requirement 使用 + @ScdlRequirement
 *   Constraint               → requirement 使用 + @ScdlConstraint
 *   allocation / isAllocated → 標準の satisfy <要求> by <エレメント>(無ければ未配置)
 *   Interaction              → dependency + @ScdlInteraction(client=source, supplier=targets)
 *   RequirementGroup         → metadata <id> : ScdlRequirementGroup about <要求>, ...
 *   RequirementGroupPairing  → dependency + @ScdlRequirementGroupPairing(2 つの要求グループ)
 *   RequirementPairing       → dependency + @ScdlRequirementPairing(2 つの要求)
 *   CoexistenceTarget        → dependency + @ScdlCoexistence(client=干渉元エレメント, supplier=干渉先)
 *   ConstraintPairing        → dependency + @ScdlConstraintPairing(client=制約条件, supplier=適用先)
 *   Weight                   → weight / decomposedFrom 属性(表記 A(B) = weight A, decomposedFrom B)
 *   SCDLType.id              → 宣言名(declaredName)。SCDLType.name → title、text → note
 *
 * 拡張(ASAM 仕様には無い): ScdlRequirementGroup.role と ScdlRequirement.isExternal。
 */
library package SCDL {
    private import ScalarValues::String;
    private import ScalarValues::Boolean;

    doc /* ASAM SCDL v1.6.0 のメタモデルに対応するステレオタイプ群。 */

    /* 重み付け(ASIL)の値。 */
    enum def Asil {
        doc /* 重み付け(ASIL)の値。 */
        QM;
        A;
        B;
        C;
        D;
    }

    /* 要求グループの役割(拡張)。SCDL では名称("Main Function" / "Safety Mechanism")で区別している。 */
    enum def ScdlGroupRole {
        doc /* 要求グループの役割。 */
        intendedFunction;
        safetyMechanism;
    }

    /* すべての SCDL 要素の基底。id は宣言名で表す。 */
    abstract metadata def ScdlType {
        doc /* SCDLType: title = name(名称・短縮名)、note = text(備考)。 */
        attribute title : String [0..1];
        attribute note : String [0..1];
    }

    /* 重み付けを持てる型(WeightableType)。 */
    abstract metadata def ScdlWeightable :> ScdlType {
        doc /* weight = ASIL、decomposedFrom = 分解前の ASIL。A(B) は weight=A, decomposedFrom=B。 */
        attribute weight : Asil [0..1];
        attribute decomposedFrom : Asil [0..1];
    }

    metadata def ScdlElement :> ScdlWeightable {
        doc /* エレメント。システム/サブシステム/コンポーネントなど。入れ子は part の入れ子で表す。 */
        :>> annotatedElement : SysML::PartUsage;
    }

    metadata def ScdlRequirement :> ScdlWeightable {
        doc /* 要求。配置先は satisfy で表す。 */
        :>> annotatedElement : SysML::RequirementUsage;
        /* システム境界の外側にあたる相手側の要求(図では表示が省略される)(拡張)。 */
        attribute isExternal : Boolean = false;
    }

    metadata def ScdlConstraint :> ScdlWeightable {
        doc /* 制約条件(独立要求・無干渉要求など)。要求として表す。 */
        :>> annotatedElement : SysML::RequirementUsage;
    }

    metadata def ScdlRequirementGroup :> ScdlType {
        doc /* 要求グループ。about に列挙した要求がメンバー(重複不可)。 */
        :>> annotatedElement : SysML::RequirementUsage;
        attribute role : ScdlGroupRole [0..1];
    }

    metadata def ScdlInteraction :> ScdlType {
        doc /* インタラクション。client = 出力元の要求(1 つ)、supplier = 宛先の要求(1 つ以上)。 */
        :>> annotatedElement : SysML::Dependency;
    }

    metadata def ScdlRequirementGroupPairing :> ScdlType {
        doc /* 要求グループペアリング。2 つの異なる要求グループ(順序に意味は無い)。 */
        :>> annotatedElement : SysML::Dependency;
    }

    metadata def ScdlRequirementPairing :> ScdlType {
        doc /* 部分ペアリング。2 つの異なる要求(順序に意味は無い)。 */
        :>> annotatedElement : SysML::Dependency;
    }

    metadata def ScdlCoexistence :> ScdlType {
        doc /* 無干渉。client = 干渉元のエレメント、supplier = 干渉先(要求/要求グループ/エレメント)。 */
        :>> annotatedElement : SysML::Dependency;
    }

    metadata def ScdlConstraintPairing :> ScdlType {
        doc /* 制約条件からのコネクティングライン。client = 制約条件、supplier = ペアリングまたは無干渉。 */
        :>> annotatedElement : SysML::Dependency;
    }
}
