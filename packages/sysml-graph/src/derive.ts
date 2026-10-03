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
import type { ElementGraph, GraphElement, GraphParameter } from "./types.js";

export interface DerivedRequirement {
  id: string;
  text?: string;
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
export function deriveNet(graph: ElementGraph): DerivedNet {
  const issues: Issue[] = [];
  const warn = (code: string, message: string, ref?: string) =>
    issues.push({ code, severity: "warning", message, ...(ref ? { ref } : {}) });
  const error = (code: string, message: string, ref?: string) =>
    issues.push({ code, severity: "error", message, ...(ref ? { ref } : {}) });

  const byQn = new Map<string, GraphElement>(graph.elements.map((e) => [e.qualifiedName, e]));
  const isPart = (qn: string | null | undefined) => !!qn && byQn.get(qn)?.kind === "PartUsage";
  const isAction = (qn: string | null | undefined) => !!qn && byQn.get(qn)?.kind === "ActionUsage";
  const nameOf = (e: GraphElement) => e.name ?? e.qualifiedName;

  // 構造ネット
  const elements: StructureElement[] = graph.elements
    .filter((e) => e.kind === "PartUsage")
    .map((e) => ({
      id: e.qualifiedName,
      name: nameOf(e),
      modelRef: e.qualifiedName,
      ...(isPart(e.owner) ? { parentId: e.owner! } : {}),
    }));

  // performer の索引
  const performersOf = new Map<string, string[]>();
  for (const p of graph.performs ?? []) {
    if (!p.performer || !p.performed) continue;
    if (!isPart(p.performer)) {
      warn("PERFORM_NOT_PART", "part 以外が perform しています(無視します)", p.performer);
      continue;
    }
    if (!isAction(p.performed)) {
      warn("PERFORM_NOT_ACTION", "action 以外を perform しています(無視します)", p.performed);
      continue;
    }
    performersOf.set(p.performed, [...(performersOf.get(p.performed) ?? []), p.performer]);
  }

  const performerOf = (qn: string, seen = new Set<string>()): string | undefined => {
    if (seen.has(qn)) return undefined;
    seen.add(qn);
    const explicit = performersOf.get(qn);
    if (explicit?.length) return explicit[0];
    const owner = byQn.get(qn)?.owner;
    if (isPart(owner)) return owner!;
    if (isAction(owner)) return performerOf(owner!, seen);
    return undefined;
  };

  // 機能ネット
  const functions: FunctionNode[] = [];
  const parameters: Record<string, GraphParameter[]> = {};
  const functionIds = new Set<string>();
  for (const e of graph.elements) {
    if (e.kind !== "ActionUsage") continue;
    const performers = performersOf.get(e.qualifiedName) ?? [];
    if (new Set(performers).size > 1)
      warn("FUNCTION_MULTIPLE_PERFORMERS", `複数の part が perform しています(先頭を担当要素とします): ${performers.join(", ")}`, e.qualifiedName);
    const owner = performerOf(e.qualifiedName);
    if (!owner) {
      warn("FUNCTION_NO_OWNER", "担当する part を決められません(part が所有する action か、perform が必要です)", e.qualifiedName);
      continue;
    }
    functionIds.add(e.qualifiedName);
    functions.push({
      id: e.qualifiedName,
      name: nameOf(e),
      ownerId: owner,
      modelRef: e.qualifiedName,
      ...(isAction(e.owner) ? { parentFunctionId: e.owner! } : {}),
    });
    parameters[e.qualifiedName] = e.parameters ?? [];
  }
  // 上位の action が機能として採用されなかった場合は、上位機能を外す
  for (const f of functions)
    if (f.parentFunctionId && !functionIds.has(f.parentFunctionId)) delete f.parentFunctionId;

  // 要求
  const satisfiedBy = new Map<string, ElementId[]>();
  for (const s of graph.satisfies) {
    if (!s.requirement || !s.by) continue;
    if (byQn.get(s.requirement)?.kind !== "RequirementUsage") continue;
    if (!isPart(s.by)) {
      warn("SATISFY_NOT_PART", "part 以外への satisfy です(構造ネットには紐づけません)", s.requirement);
      continue;
    }
    satisfiedBy.set(s.requirement, [...(satisfiedBy.get(s.requirement) ?? []), s.by]);
  }
  const requirements: DerivedRequirement[] = graph.elements
    .filter((e) => e.kind === "RequirementUsage")
    .map((e) => ({
      id: e.qualifiedName,
      ...(e.doc ? { text: e.doc } : {}),
      satisfiedBy: satisfiedBy.get(e.qualifiedName) ?? [],
    }));

  // 故障モード候補
  const candidates: FailureModeCandidate[] = [];
  for (const f of functions) {
    candidates.push(...failureModeCandidates(f));
    for (const p of parameters[f.id] ?? [])
      if (p.direction !== "in" && p.name) candidates.push(...outputFailureModeCandidates(f, p.name));
  }

  const net: SafetyNet = { elements, functions, failures: [], links: [] };
  if (elements.length === 0) error("NO_STRUCTURE", "構造ネットが空です(part が見つかりません)");
  const deriveIssues = [...issues];
  return { net, parameters, requirements, candidates, deriveIssues, issues: [...deriveIssues, ...validateNet(net)] };
}
