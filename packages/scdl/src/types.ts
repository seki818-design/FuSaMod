/**
 * ASAM SCDL v1.6.0 の附属書 A(メタモデル)に対応するデータ型。
 * 名称は仕様に合わせる。図の記法(線種・配置)は含めず、描画は別層で行う。
 */

export type ScdlId = string;

/** 全要素の基底(SCDLType)。 */
export interface ScdlType {
  id: ScdlId;
  name?: string;
  /** 備考 */
  text?: string;
}

/** 重み付け(ASIL)。表記は "B" や、分解後の "A(B)"。 */
export type Weight = string;

/** エレメント: システム/サブシステム/コンポーネント等とその入れ子。 */
export interface Element extends ScdlType {
  parent?: ScdlId;
  weight?: Weight;
}

/** 要求と制約条件に共通(AbstractRequirement)。 */
export interface AbstractRequirement extends ScdlType {
  weight?: Weight;
  /** false = 配置先未決定(図では底辺を二重線)。true のとき allocation が必須。 */
  isAllocated: boolean;
  allocation?: ScdlId;
}

export interface Requirement extends AbstractRequirement {
  /**
   * システム境界の外側にあたる相手側の要求(図では表示が省略される)。
   * 仕様のメタモデル上は Interaction の端が Requirement であるための表現で、拡張属性。
   */
  isExternal?: boolean;
}

/** 制約条件(独立要求・無干渉要求など)。要求として表現される。 */
export type Constraint = AbstractRequirement;

/** 要求間の情報/信号の授受。1 つの出力元から複数の宛先へ分岐できる(出力は 1 つ)。 */
export interface Interaction extends ScdlType {
  source: ScdlId;
  targets: ScdlId[];
}

/** 要求グループの役割(拡張)。SCDL は名称("Main Function" / "Safety Mechanism")で区別している。 */
export type GroupRole = "intendedFunction" | "safetyMechanism";

/** 要求グループ。意図機能側と安全機構側のまとまりを表す。 */
export interface RequirementGroup extends ScdlType {
  requirements: ScdlId[];
  /** 拡張属性。ペアリングの両端が意図機能と安全機構の組かを検査するために使う。 */
  role?: GroupRole;
}

/** 冗長な 2 つの要求グループの組み合わせ(ISO 26262-9 の分解に対応)。 */
export interface RequirementGroupPairing extends ScdlType {
  set: [ScdlId, ScdlId];
}

/** 要求グループペアリングを詳細化した、要求 2 つの部分ペアリング。 */
export interface RequirementPairing extends ScdlType {
  set: [ScdlId, ScdlId];
}

export type InterferenceTargetRef =
  | { kind: "requirement"; id: ScdlId }
  | { kind: "group"; id: ScdlId }
  | { kind: "element"; id: ScdlId };

/** 無干渉: source のエレメントが target を侵害してはならない。 */
export interface CoexistenceTarget extends ScdlType {
  source: ScdlId;
  target: InterferenceTargetRef;
}

export type ConstraintTargetRef =
  | { kind: "group-pairing"; id: ScdlId }
  | { kind: "requirement-pairing"; id: ScdlId }
  | { kind: "coexistence"; id: ScdlId };

/** 制約条件と、その適用先(ペアリング/無干渉)を結ぶコネクティングライン。 */
export interface ConstraintPairing extends ScdlType {
  constraint: ScdlId;
  target: ConstraintTargetRef;
}

export interface ScdlModel {
  elements: Element[];
  requirements: Requirement[];
  constraints: Constraint[];
  interactions: Interaction[];
  groups: RequirementGroup[];
  groupPairings: RequirementGroupPairing[];
  requirementPairings: RequirementPairing[];
  coexistences: CoexistenceTarget[];
  constraintPairings: ConstraintPairing[];
}

export function emptyModel(): ScdlModel {
  return {
    elements: [],
    requirements: [],
    constraints: [],
    interactions: [],
    groups: [],
    groupPairings: [],
    requirementPairings: [],
    coexistences: [],
    constraintPairings: [],
  };
}
