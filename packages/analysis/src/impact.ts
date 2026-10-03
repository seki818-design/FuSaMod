import type { ElementId } from "@fusamod/safety-core";
import type { ProjectAnalysis } from "./analyze.js";
import type { SafetyData } from "./project.js";

export interface RequirementImpact {
  /** 起点の要求(SysML または安全要求) */
  requirementId: string;
  /** 影響を受けうる他の要求(詳細化・導出・分解の先と元、同じ要素に紐づく要求) */
  requirements: string[];
  /** 影響を受けうる構造要素(satisfy / 配置先と、その下位) */
  elements: ElementId[];
  functions: string[];
  failures: string[];
  /** 見直すべき FMEA(構造要素) */
  fmeaElements: ElementId[];
  intendedFunctions: string[];
  mechanisms: string[];
  pairs: string[];
  decompositions: string[];
  /** 経路の説明(なぜ影響を受けるか) */
  reasons: string[];
}

type Rel = [from: string, to: string, label: string];

/** 要求間の関係(詳細化・導出・分解)。 */
function requirementRelations(s: SafetyData): Rel[] {
  const rel: Rel[] = [];
  for (const r of s.safetyRequirements) {
    if (r.refines) rel.push([r.refines, r.id, "詳細化"]);
    if (r.parentId) rel.push([r.parentId, r.id, "導出"]);
  }
  for (const d of s.decompositions) for (const c of d.childRequirementIds) rel.push([d.parentRequirementId, c, "分解"]);
  return rel;
}

/** 起点から、要求の関係を双方向に推移的にたどる。 */
function relatedRequirements(start: string, rel: Rel[], reasons: string[]): Set<string> {
  const out = new Set<string>();
  const seen = new Set([start]);
  const frontier = [start];
  while (frontier.length) {
    const cur = frontier.pop()!;
    for (const [from, to, label] of rel) {
      const other = from === cur ? to : to === cur ? from : undefined;
      if (other === undefined || seen.has(other)) continue;
      seen.add(other);
      frontier.push(other);
      out.add(other);
      reasons.push(`${cur} と ${other} は「${label}」の関係`);
    }
  }
  return out;
}

/** 要求が satisfy / 配置されている構造要素。 */
function rootElements(a: ProjectAnalysis, s: SafetyData, ids: string[], reasons: string[]): Set<ElementId> {
  const roots = new Set<ElementId>();
  for (const id of ids) {
    for (const e of a.derived.requirements.find((r) => r.id === id)?.satisfiedBy ?? []) {
      roots.add(e);
      reasons.push(`${id} は ${e} に satisfy されている`);
    }
    const allocated = s.safetyRequirements.find((x) => x.id === id)?.allocatedTo;
    if (allocated) {
      roots.add(allocated);
      reasons.push(`${id} は ${allocated} に配置されている`);
    }
  }
  return roots;
}

/** 起点の要素と、その下位。 */
function subtree(a: ProjectAnalysis, roots: Set<ElementId>): Set<ElementId> {
  const known = new Set(a.net.elements.map((e) => e.id));
  const children = new Map<ElementId, ElementId[]>();
  for (const e of a.net.elements) if (e.parentId) children.set(e.parentId, [...(children.get(e.parentId) ?? []), e.id]);
  const out = new Set<ElementId>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || !known.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/** 故障ノードと、故障がつながる上位の要素の FMEA(故障影響が変わりうるため見直し対象)。 */
function failureImpact(a: ProjectAnalysis, elements: Set<ElementId>) {
  const functions = a.net.functions.filter((f) => elements.has(f.ownerId)).map((f) => f.id);
  const fnSet = new Set(functions);
  const failures = a.net.failures.filter((f) => fnSet.has(f.functionId)).map((f) => f.id);
  const failureSet = new Set(failures);
  const fmeaElements = new Set<ElementId>(Object.keys(a.fmea).filter((id) => elements.has(id)));
  const ownerOf = (failureId: string) => {
    const f = a.net.failures.find((x) => x.id === failureId);
    return f && a.net.functions.find((x) => x.id === f.functionId)?.ownerId;
  };
  for (const l of a.net.links) {
    const owner = failureSet.has(l.causeId) ? ownerOf(l.effectId) : undefined;
    if (owner && a.fmea[owner]) fmeaElements.add(owner);
  }
  return { functions, failures, failureSet, fmeaElements };
}

/**
 * 要求の変更が波及する先を求める。
 * SysML の requirement → satisfy された part → その機能 → 故障ノード → FMEA、
 * 安全要求(refines / 導出 / 分解)、同じ要素の意図機能・安全機構・ペア、までを機械的にたどる。
 * 「影響しうる」範囲であり、影響の有無の判断は人が行う。
 */
export function impactOfRequirementChange(a: ProjectAnalysis, s: SafetyData, requirementId: string): RequirementImpact | undefined {
  const isSysml = a.derived.requirements.some((r) => r.id === requirementId);
  if (!isSysml && !s.safetyRequirements.some((r) => r.id === requirementId)) return undefined;

  const reasons: string[] = [];
  const reqs = relatedRequirements(requirementId, requirementRelations(s), reasons);
  const all = new Set([requirementId, ...reqs]);
  const elements = subtree(a, rootElements(a, s, [...all], reasons));
  const { functions, failures, failureSet, fmeaElements } = failureImpact(a, elements);

  const touches = (ids: string[] | undefined) => (ids ?? []).some((r) => all.has(r));
  const intendedFunctions = s.intendedFunctions.filter((f) => elements.has(f.elementId) || all.has(f.id) || touches(f.requirementIds));
  const mechanisms = s.mechanisms.filter((m) => elements.has(m.elementId) || touches(m.requirementIds) || (m.coversFailureIds ?? []).some((f) => failureSet.has(f)));
  const ifIds = new Set(intendedFunctions.map((f) => f.id));
  const mIds = new Set(mechanisms.map((m) => m.id));
  const pairs = s.pairs.filter((p) => ifIds.has(p.intendedFunctionId) || mIds.has(p.mechanismId)).map((p) => p.id);
  const decompositions = s.decompositions.filter((d) => all.has(d.parentRequirementId) || touches(d.childRequirementIds)).map((d) => d.id);
  for (const r of s.safetyRequirements)
    if (r.allocatedTo && elements.has(r.allocatedTo) && !all.has(r.id)) {
      reqs.add(r.id);
      reasons.push(`${r.id} は影響を受ける要素 ${r.allocatedTo} に配置されている`);
    }

  return {
    requirementId,
    requirements: [...reqs],
    elements: [...elements],
    functions,
    failures,
    fmeaElements: [...fmeaElements],
    intendedFunctions: intendedFunctions.map((f) => f.id),
    mechanisms: mechanisms.map((m) => m.id),
    pairs,
    decompositions,
    reasons: [...new Set(reasons)],
  };
}
