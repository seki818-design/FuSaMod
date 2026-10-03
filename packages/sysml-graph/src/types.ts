/**
 * SysML v2 の公式パイロット実装(tools/sysml-check/SysmlExtract.java)が出力する、
 * ツール非依存の汎用の要素グラフ。名前は完全修飾名で解決済み。
 * SCDL や安全分析ネットなどの利用側は、このグラフから必要な部分を読み取る。
 */
export interface GraphParameter {
  name: string | null;
  direction: "in" | "out" | "inout";
  type: string | null;
}

export interface GraphElement {
  /** PartUsage / ActionUsage / RequirementUsage / Package */
  kind: string;
  qualifiedName: string;
  name?: string | null;
  owner?: string | null;
  /** doc コメントの本文 */
  doc?: string;
  /** ActionUsage の入出力パラメータ */
  parameters?: GraphParameter[];
}

export interface GraphDependency extends GraphElement {
  client: string[];
  supplier: string[];
}

export interface GraphMetadata extends GraphElement {
  /** メタデータ定義名(ステレオタイプ名) */
  type: string | null;
  /** 注釈の対象(完全修飾名) */
  annotated: string[];
  attributes: Record<string, string | boolean>;
}

export interface GraphSatisfy {
  requirement: string | null;
  by: string | null;
}

/** `perform` 宣言: performer(part)が performed(action)を実施する。 */
export interface GraphPerform {
  performer: string | null;
  performed: string | null;
}

export interface ElementGraph {
  elements: GraphElement[];
  dependencies: GraphDependency[];
  metadata: GraphMetadata[];
  satisfies: GraphSatisfy[];
  performs?: GraphPerform[];
}
