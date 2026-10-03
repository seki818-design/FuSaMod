export type ElementId = string;
export type FunctionId = string;
export type FailureId = string;
export type LinkId = string;

/** 構造ネットのノード。SysML v2 の part usage/definition を modelRef で参照する。 */
export interface StructureElement {
  id: ElementId;
  name: string;
  parentId?: ElementId;
  /** SysML v2 要素の永続参照(qualified name / element ID) */
  modelRef?: string;
}

/** 機能ネットのノード。action / requirement を modelRef で参照する。 */
export interface FunctionNode {
  id: FunctionId;
  name: string;
  ownerId: ElementId;
  /** 上位要素の機能のうち、この機能が寄与するもの */
  parentFunctionId?: FunctionId;
  modelRef?: string;
}

/**
 * エラーネットのノード。FE/FM/FC は固定の種別ではなく、見る階層で決まる役割。
 * 1 つの実体を上位 FMEA では FC、下位 FMEA では FE として共有する。
 */
export interface FailureNode {
  id: FailureId;
  description: string;
  functionId: FunctionId;
  /** 重大度。最上位の故障影響に付け、下位へは継承して参照する。 */
  severity?: number;
  /** 下位要素を持たない根本原因(部品固有の劣化など)。原因なしでも警告しない。 */
  isBasicCause?: boolean;
}

/** causeId の故障が effectId の故障を引き起こす。原因→影響の向き。 */
export interface FailureLink {
  id: LinkId;
  causeId: FailureId;
  effectId: FailureId;
  occurrence?: number;
  detection?: number;
  preventionControl?: string;
  detectionControl?: string;
}

/** 構造・機能・エラーの 3 ネットをまとめた解析対象。 */
export interface SafetyNet {
  elements: StructureElement[];
  functions: FunctionNode[];
  failures: FailureNode[];
  links: FailureLink[];
}
