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
  /** PartUsage / ActionUsage / RequirementUsage / PartDefinition / ActionDefinition / Package。導出の対象外の PortUsage / ConnectionUsage / StateUsage / AllocationUsage なども、種類と名前だけ含む */
  kind: string;
  qualifiedName: string;
  name?: string | null;
  owner?: string | null;
  /** doc コメントの本文 */
  doc?: string;
  /** ActionUsage / ActionDefinition の入出力パラメータ */
  parameters?: GraphParameter[];
  /** 使用(usage)の宣言された型(`: Def`)の完全修飾名 */
  types?: string[];
  /** 定義・使用の宣言された上位の型(`:>`)の完全修飾名 */
  supertypes?: string[];
  /** 再定義(`:>>`)を含む使用 */
  redefines?: boolean;
  /** 再定義している特徴(完全修飾名)。定義側の同名の使用の中身を引き継ぐために使う */
  redefinedFeatures?: string[];
  /** `ref part`(参照。構造の入れ子ではない) */
  isRef?: boolean;
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
  /** 満たす特徴(連鎖なら最後の特徴。定義側の特徴の場合がある) */
  by: string | null;
  /** `car.front.rotor` のような連鎖の、途中も含む特徴の完全修飾名(先頭がインスタンスの起点) */
  byChain?: string[];
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
