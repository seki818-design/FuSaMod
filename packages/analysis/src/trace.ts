import type { DerivedNet } from "@fusamod/sysml-graph";
import type { Asil, ElementId } from "@fusamod/safety-core";
import type { LevelKey } from "./levels.js";
import type { SafetyData } from "./project.js";

export interface TraceRow {
  id: string;
  label: string;
  kind: "sysml" | "safety";
  text?: string;
  asil?: Asil;
  originAsil?: Asil;
}
export interface TraceCell {
  requirementId: string;
  elementId: ElementId;
  relation: "satisfy" | "allocate";
}
export interface TraceLink {
  from: string;
  to: string;
  kind: "derives" | "decomposes" | "refines";
}
export interface TraceMatrix {
  rows: TraceRow[];
  elements: { id: ElementId; name: string; level: LevelKey }[];
  cells: TraceCell[];
  links: TraceLink[];
  /** どの構造要素にも紐づいていない要求 */
  uncovered: string[];
}

/** 完全修飾名の最後の名前(引用符を外す)。 */
export function shortName(qn: string): string {
  const last = qn.split("::").pop() ?? qn;
  return last.replace(/^'(.*)'$/, "$1");
}

/** 要求(SysML の requirement と安全要求)と構造要素のトレースマトリクス、要求間の導出リンク。 */
export function buildTrace(
  derived: DerivedNet,
  s: SafetyData,
  levelOf: Record<ElementId, LevelKey>,
): TraceMatrix {
  const rows: TraceRow[] = [];
  const cells: TraceCell[] = [];
  for (const r of derived.requirements) {
    rows.push({ id: r.id, label: shortName(r.id), kind: "sysml", ...(r.text ? { text: r.text } : {}) });
    for (const e of r.satisfiedBy) cells.push({ requirementId: r.id, elementId: e, relation: "satisfy" });
  }
  const known = new Set(derived.net.elements.map((e) => e.id));
  for (const r of s.safetyRequirements) {
    rows.push({ id: r.id, label: r.id, kind: "safety", text: r.text, asil: r.asil, ...(r.originAsil ? { originAsil: r.originAsil } : {}) });
    if (r.allocatedTo && known.has(r.allocatedTo)) cells.push({ requirementId: r.id, elementId: r.allocatedTo, relation: "allocate" });
  }
  const links: TraceLink[] = [];
  const seen = new Set<string>();
  const link = (from: string, to: string, kind: TraceLink["kind"]) => {
    const k = `${from}|${to}|${kind}`;
    if (!seen.has(k)) { seen.add(k); links.push({ from, to, kind }); }
  };
  const sysmlIds = new Set(derived.requirements.map((r) => r.id));
  for (const r of s.safetyRequirements) {
    if (r.parentId) link(r.parentId, r.id, "derives");
    if (r.refines && sysmlIds.has(r.refines)) link(r.refines, r.id, "refines");
  }
  for (const d of s.decompositions) for (const c of d.childRequirementIds) link(d.parentRequirementId, c, "decomposes");
  const covered = new Set(cells.map((c) => c.requirementId));
  return {
    rows,
    elements: derived.net.elements.map((e) => ({ id: e.id, name: e.name, level: levelOf[e.id] ?? "system" })),
    cells,
    links,
    uncovered: rows.filter((r) => !covered.has(r.id)).map((r) => r.id),
  };
}
