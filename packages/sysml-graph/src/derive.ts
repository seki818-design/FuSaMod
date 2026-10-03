import {
  failureModeCandidates,
  outputFailureModeCandidates,
  validateNet,
  type ElementId,
  type FailureModeCandidate,
  type FunctionNode,
  type Issue,
  type SafetyNet,
  type StructureElement,
} from "@fusamod/safety-core";
import { expandGraph } from "./expand.js";
import type { ElementGraph, GraphElement, GraphParameter } from "./types.js";

export interface DerivedRequirement {
  id: string;
  text?: string;
  /** 入れ子の requirement の、親の requirement */
  parentId?: string;
  /** satisfy で結びつく構造要素 */
  satisfiedBy: ElementId[];
}

export interface DerivedNet {
  /** 構造ネットと機能ネット。故障ノード/リンクは人または AI が追加する(空で返す)。 */
  net: SafetyNet;
  /** 機能ごとの入出力パラメータ(機能 ID → パラメータ) */
  parameters: Record<string, GraphParameter[]>;
  requirements: DerivedRequirement[];
  /** 故障モード候補(機能単位 + 出力パラメータ単位)。確定は人が行う。 */
  candidates: FailureModeCandidate[];
  /** 導出時の指摘のみ(担当 part を決められない action など) */
  deriveIssues: Issue[];
  /** deriveIssues と、導出したネットの validateNet の結果(未着手の故障モード等)を合わせたもの */
  issues: Issue[];
}

type Warn = (code: string, message: string, ref?: string) => void;

interface Graph {
  g: ElementGraph;
  byQn: Map<string, GraphElement>;
  isPart(qn: string | null | undefined): boolean;
  isAction(qn: string | null | undefined): boolean;
}

const nameOf = (e: GraphElement) => e.name ?? (e.redefinedFeatures?.[0] ? e.redefinedFeatures[0].split("::").pop()! : e.qualifiedName);

function deriveStructure(x: Graph): StructureElement[] {
  return x.g.elements
    .filter((e) => e.kind === "PartUsage")
    .map((e) => ({
      id: e.qualifiedName,
      name: nameOf(e),
      modelRef: e.qualifiedName,
      ...(x.isPart(e.owner) ? { parentId: e.owner! } : {}),
    }));
}

/** performed(action) → それを perform した part の一覧。part 以外・action 以外の perform は警告して無視する。 */
function indexPerforms(x: Graph, warn: Warn): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of x.g.performs ?? []) {
    if (!p.performer || !p.performed) continue;
    if (!x.isPart(p.performer)) {
      warn("PERFORM_NOT_PART", "part 以外が perform しています(無視します)", p.performer);
      continue;
    }
    if (!x.isAction(p.performed)) {
      warn("PERFORM_NOT_ACTION", "action 以外を perform しています(無視します)", p.performed);
      continue;
    }
    out.set(p.performed, [...(out.get(p.performed) ?? []), p.performer]);
  }
  return out;
}

/** 担当する part: perform した part → action を所有する part → 所有する action の担当、の順。 */
function performerOf(x: Graph, performers: Map<string, string[]>, qn: string, seen = new Set<string>()): string | undefined {
  if (seen.has(qn)) return undefined;
  seen.add(qn);
  const explicit = performers.get(qn);
  if (explicit?.length) return explicit[0];
  const owner = x.byQn.get(qn)?.owner;
  if (x.isPart(owner)) return owner!;
  if (x.isAction(owner)) return performerOf(x, performers, owner!, seen);
  return undefined;
}

function deriveFunctions(x: Graph, warn: Warn): { functions: FunctionNode[]; parameters: Record<string, GraphParameter[]> } {
  const performers = indexPerforms(x, warn);
  const functions: FunctionNode[] = [];
  const parameters: Record<string, GraphParameter[]> = {};
  for (const e of x.g.elements) {
    if (e.kind !== "ActionUsage") continue;
    const list = performers.get(e.qualifiedName) ?? [];
    if (new Set(list).size > 1) warn("FUNCTION_MULTIPLE_PERFORMERS", `複数の part が perform しています(先頭を担当要素とします): ${list.join(", ")}`, e.qualifiedName);
    const owner = performerOf(x, performers, e.qualifiedName);
    if (!owner) {
      warn("FUNCTION_NO_OWNER", "担当する part を決められません(part が所有する action か、perform が必要です)", e.qualifiedName);
      continue;
    }
    functions.push({
      id: e.qualifiedName,
      name: nameOf(e),
      ownerId: owner,
      modelRef: e.qualifiedName,
      ...(x.isAction(e.owner) ? { parentFunctionId: e.owner! } : {}),
    });
    parameters[e.qualifiedName] = e.parameters ?? [];
  }
  // 上位の action が機能として採用されなかった場合は、上位機能を外す
  const ids = new Set(functions.map((f) => f.id));
  for (const f of functions) if (f.parentFunctionId && !ids.has(f.parentFunctionId)) delete f.parentFunctionId;
  return { functions, parameters };
}

function deriveRequirements(x: Graph, warn: Warn, ownerOfAction: (qn: string) => string | undefined): DerivedRequirement[] {
  const satisfiedBy = new Map<string, ElementId[]>();
  for (const s of x.g.satisfies) {
    if (!s.requirement || !s.by) continue;
    if (x.byQn.get(s.requirement)?.kind !== "RequirementUsage") continue;
    // action への satisfy は、その action を担当する part への紐づけとして扱う
    const target = x.isPart(s.by) ? s.by : x.isAction(s.by) ? ownerOfAction(s.by) : undefined;
    if (!target) {
      warn("SATISFY_NOT_PART", "part(または担当 part を持つ action)以外への satisfy です(構造ネットには紐づけません)", s.requirement);
      continue;
    }
    const list = satisfiedBy.get(s.requirement) ?? [];
    if (!list.includes(target)) satisfiedBy.set(s.requirement, [...list, target]);
  }
  const list: DerivedRequirement[] = x.g.elements
    .filter((e) => e.kind === "RequirementUsage")
    .map((e) => ({
      id: e.qualifiedName,
      ...(e.doc ? { text: e.doc } : {}),
      ...(e.owner && x.byQn.get(e.owner)?.kind === "RequirementUsage" ? { parentId: e.owner } : {}),
      satisfiedBy: satisfiedBy.get(e.qualifiedName) ?? [],
    }));
  // 入れ子の requirement は、自身に satisfy が無ければ、親の satisfy を引き継ぐ(親が満たされていれば、子も同じ要素が担う)
  const byId = new Map(list.map((r) => [r.id, r]));
  for (const r of list) {
    const seen = new Set<string>([r.id]);
    for (let p = r.parentId ? byId.get(r.parentId) : undefined; r.satisfiedBy.length === 0 && p && !seen.has(p.id); p = p.parentId ? byId.get(p.parentId) : undefined) {
      seen.add(p.id);
      if (p.satisfiedBy.length > 0) r.satisfiedBy = [...p.satisfiedBy];
    }
  }
  return list;
}

function deriveCandidates(functions: FunctionNode[], parameters: Record<string, GraphParameter[]>): FailureModeCandidate[] {
  const out: FailureModeCandidate[] = [];
  for (const f of functions) {
    out.push(...failureModeCandidates(f));
    for (const p of parameters[f.id] ?? []) if (p.direction !== "in" && p.name) out.push(...outputFailureModeCandidates(f, p.name));
  }
  return out;
}

/**
 * 要素グラフから、安全分析の構造ネット・機能ネットを導出する。
 *
 * 規約:
 *  - 構造ネット: part の入れ子。ID は完全修飾名。
 *  - 機能ネット: action。performer(perform を宣言した part)が担当要素。perform が無ければ、
 *    action を所有する part、または所有する action の担当要素を引き継ぐ。
 *    上位機能は、その action を所有する action(機能分解)。
 *  - 要求: requirement と satisfy。
 */
export function deriveNet(original: ElementGraph): DerivedNet {
  const expanded = expandGraph(original);
  const graph = expanded.graph;
  const issues: Issue[] = [...expanded.issues];
  const warn: Warn = (code, message, ref) => void issues.push({ code, severity: "warning", message, ...(ref ? { ref } : {}) });
  const byQn = new Map<string, GraphElement>(graph.elements.map((e) => [e.qualifiedName, e]));
  const x: Graph = {
    g: graph,
    byQn,
    isPart: (qn) => !!qn && byQn.get(qn)?.kind === "PartUsage",
    isAction: (qn) => !!qn && byQn.get(qn)?.kind === "ActionUsage",
  };
  const elements = deriveStructure(x);
  const { functions, parameters } = deriveFunctions(x, warn);
  const owners = new Map(functions.map((f) => [f.id, f.ownerId]));
  const requirements = deriveRequirements(x, warn, (qn) => owners.get(qn));
  const candidates = deriveCandidates(functions, parameters);
  if (elements.length === 0) issues.push({ code: "NO_STRUCTURE", severity: "error", message: "構造ネットが空です(part が見つかりません)" });
  const net: SafetyNet = { elements, functions, failures: [], links: [] };
  return { net, parameters, requirements, candidates, deriveIssues: [...issues], issues: [...issues, ...validateNet(net)] };
}
