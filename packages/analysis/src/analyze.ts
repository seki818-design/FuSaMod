import {
  buildFmeaView,
  buildIndex,
  compileApTable,
  validateDecompositions,
  validateFaultTree,
  validateHara,
  validateNet,
  validatePairing,
  type ApLookup,
  type ElementId,
  type FmeaView,
  type Issue,
  type SafetyNet,
} from "@fusamod/safety-core";
import { validateScdl, type ScdlModel } from "@fusamod/scdl";
import { deriveNet, type DerivedNet, type ElementGraph } from "@fusamod/sysml-graph";
import { computeLevels, LEVELS, type LevelKey } from "./levels.js";
import type { SafetyData } from "./project.js";
import { toScdl } from "./scdl-map.js";
import { buildTrace, type TraceMatrix } from "./trace.js";

/** パズルビューの 4 つの視点。 */
export type Viewpoint = "requirements" | "structure" | "behavior" | "safety";
export const VIEWPOINTS: readonly { key: Viewpoint; label: string; en: string }[] = [
  { key: "requirements", label: "要求", en: "Requirements" },
  { key: "structure", label: "構造", en: "Structure" },
  { key: "behavior", label: "振る舞い", en: "Behavior" },
  { key: "safety", label: "安全", en: "Safety" },
];

/** どの視点・階層の問題かを持つ指摘。 */
export interface AnalysisIssue extends Issue {
  source: string;
  viewpoint: Viewpoint;
  elementId?: ElementId;
}

export type CellStatus = "consistent" | "review" | "inconsistent" | "undetermined" | "none";
export interface PuzzleCell {
  count: number;
  errors: number;
  warnings: number;
  status: CellStatus;
}
export interface Puzzle {
  levels: { key: LevelKey; label: string; elementIds: ElementId[] }[];
  cells: Record<LevelKey, Record<Viewpoint, PuzzleCell>>;
}

export interface ProjectAnalysis {
  net: SafetyNet;
  derived: DerivedNet;
  levelOf: Record<ElementId, LevelKey>;
  issues: AnalysisIssue[];
  /** 機能を持つ構造要素ごとの FMEA(ネットの射影) */
  fmea: Record<ElementId, FmeaView>;
  apAvailable: boolean;
  puzzle: Puzzle;
  trace: TraceMatrix;
  scdl: ScdlModel;
  scdlElementIds: Record<ElementId, string>;
  summary: {
    errors: number;
    warnings: number;
    elements: number;
    functions: number;
    failures: number;
    requirements: number;
    maxRpn?: number;
  };
}

const newCell = (): PuzzleCell => ({ count: 0, errors: 0, warnings: 0, status: "none" });

/**
 * モデル(SysML の要素グラフ)と安全分析データを突き合わせ、ネット・FMEA・整合性・パズルビュー・トレース・SCDL を一括で解析する。
 * 純粋関数。入力は変更しない。
 */
export function analyzeProject(graph: ElementGraph, s: SafetyData): ProjectAnalysis {
  const derived = deriveNet(graph);
  const net: SafetyNet = { ...derived.net, failures: s.failures, links: s.links };
  const idx = buildIndex(net);
  const levelOf = computeLevels(net, s.levelOverrides ?? {});
  const issues: AnalysisIssue[] = [];

  // --- 指摘の所在(視点・要素)を引くための索引 ---
  const failureOwner = (fid: string) => idx.fn.get(idx.failure.get(fid)?.functionId ?? "")?.ownerId;
  const intendedById = new Map(s.intendedFunctions.map((f) => [f.id, f]));
  const mechById = new Map(s.mechanisms.map((m) => [m.id, m]));
  const pairById = new Map(s.pairs.map((p) => [p.id, p]));
  const safetyReqById = new Map(s.safetyRequirements.map((r) => [r.id, r]));
  const sysmlReq = new Map(derived.requirements.map((r) => [r.id, r]));
  const decompById = new Map(s.decompositions.map((d) => [d.id, d]));
  const treeById = new Map(s.faultTrees.map((t) => [t.id, t]));
  const rootEl = net.elements.find((e) => e.parentId === undefined)?.id;

  const locate = (ref: string | undefined): { viewpoint: Viewpoint; elementId?: ElementId } | undefined => {
    if (ref === undefined) return undefined;
    if (idx.element.has(ref)) return { viewpoint: "structure", elementId: ref };
    const fn = idx.fn.get(ref);
    if (fn) return { viewpoint: "behavior", elementId: fn.ownerId };
    if (idx.failure.has(ref)) return withEl("safety", failureOwner(ref));
    const link = net.links.find((l) => l.id === ref);
    if (link) return withEl("safety", failureOwner(link.effectId));
    const sr = sysmlReq.get(ref);
    if (sr) return withEl("requirements", sr.satisfiedBy[0]);
    const f = intendedById.get(ref);
    if (f) return withEl("safety", f.elementId);
    const m = mechById.get(ref);
    if (m) return withEl("safety", m.elementId);
    const p = pairById.get(ref);
    if (p) return withEl("safety", intendedById.get(p.intendedFunctionId)?.elementId);
    const r = safetyReqById.get(ref);
    if (r) return withEl("requirements", r.allocatedTo);
    const d = decompById.get(ref);
    if (d) return withEl("safety", safetyReqById.get(d.parentRequirementId)?.allocatedTo);
    const t = treeById.get(ref);
    if (t) return withEl("safety", failureOwner(t.top));
    return undefined;
  };
  const withEl = (viewpoint: Viewpoint, elementId: ElementId | undefined) =>
    elementId !== undefined && idx.element.has(elementId) ? { viewpoint, elementId } : { viewpoint };

  const defaultViewpoint: Record<string, Viewpoint> = {
    derive: "behavior", net: "safety", consistency: "behavior", hara: "safety", pairing: "safety",
    decomposition: "safety", "safety-req": "requirements", fta: "safety", fmea: "safety", scdl: "safety", trace: "requirements",
  };
  const push = (source: string, list: Issue[], forced?: Viewpoint) => {
    for (const i of list) {
      const loc = locate(i.ref);
      issues.push({
        ...i,
        source,
        viewpoint: forced ?? loc?.viewpoint ?? defaultViewpoint[source] ?? "safety",
        ...(loc?.elementId !== undefined ? { elementId: loc.elementId } : {}),
      });
    }
  };

  // --- 1. 導出時の指摘 / ネットの整合性 ---
  push("derive", derived.deriveIssues);
  push("net", validateNet(net));

  // --- 2. 階層をまたいだ整合性(構造・振る舞い・要求) ---
  const consistency: Issue[] = [];
  const childElements = new Map<ElementId, ElementId[]>();
  for (const e of net.elements) if (e.parentId) childElements.set(e.parentId, [...(childElements.get(e.parentId) ?? []), e.id]);
  for (const f of net.functions) {
    const kids = childElements.get(f.ownerId) ?? [];
    if (kids.length > 0 && !net.functions.some((g) => g.parentFunctionId === f.id))
      consistency.push({ code: "FUNCTION_NOT_DECOMPOSED", severity: "warning", message: "下位要素があるのに、この機能が下位の機能に分解されていません", ref: f.id });
  }
  for (const e of net.elements)
    if (!net.functions.some((f) => f.ownerId === e.id))
      consistency.push({ code: "ELEMENT_NO_FUNCTION", severity: "warning", message: "この構造要素が担当する機能がありません", ref: e.id });
  for (const r of derived.requirements)
    if (r.satisfiedBy.length === 0)
      consistency.push({ code: "REQUIREMENT_NOT_SATISFIED", severity: "warning", message: "どの構造要素にも satisfy されていない要求です", ref: r.id });
  push("consistency", consistency);

  // --- 3. 安全分析のデータ ---
  push("hara", validateHara(s.hara));

  const pairingIssues: Issue[] = [];
  for (const x of [...s.intendedFunctions, ...s.mechanisms])
    if (!idx.element.has(x.elementId))
      pairingIssues.push({ code: "UNKNOWN_ELEMENT", severity: "error", message: `構造要素が存在しません: ${x.elementId}`, ref: x.id });
  push("pairing", [...pairingIssues, ...validatePairing(s.intendedFunctions, s.mechanisms, s.pairs)]);

  const safetyReqIssues: Issue[] = [];
  for (const r of s.safetyRequirements) {
    if (r.allocatedTo !== undefined && !idx.element.has(r.allocatedTo))
      safetyReqIssues.push({ code: "UNKNOWN_ELEMENT", severity: "error", message: `配置先の構造要素が存在しません: ${r.allocatedTo}`, ref: r.id });
    if (r.parentId !== undefined && !safetyReqById.has(r.parentId))
      safetyReqIssues.push({ code: "UNKNOWN_REF", severity: "error", message: `上位の要求が存在しません: ${r.parentId}`, ref: r.id });
    if (r.asil !== "QM" && r.allocatedTo === undefined)
      safetyReqIssues.push({ code: "REQ_NOT_ALLOCATED", severity: "warning", message: `ASIL ${r.asil} の安全要求が構造要素に配置されていません`, ref: r.id });
  }
  push("safety-req", safetyReqIssues);
  push("decomposition", validateDecompositions(s.safetyRequirements, s.decompositions));

  for (const t of s.faultTrees) {
    const list = validateFaultTree(t);
    for (const n of t.nodes)
      if (n.failureId !== undefined && !idx.failure.has(n.failureId))
        list.push({ code: "FT_UNKNOWN_FAILURE", severity: "error", message: `対応する故障ノードが存在しません: ${n.failureId}`, ref: n.id });
    push("fta", list.map((i) => (i.ref !== undefined && t.nodes.some((n) => n.id === i.ref) ? { ...i, ref: t.id } : i)));
  }

  // --- 4. FMEA(ネットの射影)と AP 表 ---
  let ap: ApLookup | undefined;
  if (s.apTable && s.apTable.length > 0) {
    try {
      ap = compileApTable(s.apTable);
    } catch (e) {
      push("fmea", [{ code: "AP_TABLE_INVALID", severity: "error", message: `AP 表が不正です: ${(e as Error).message}` }]);
    }
  } else {
    push("fmea", [{ code: "AP_TABLE_MISSING", severity: "warning", message: "AIAG-VDA の AP 表が未設定です(RPN のみ表示します)。ハンドブックの正式な表を設定してください" }]);
  }
  const fmea: Record<ElementId, FmeaView> = {};
  let maxRpn: number | undefined;
  for (const e of net.elements) {
    if (!net.functions.some((f) => f.ownerId === e.id)) continue;
    const v = buildFmeaView(net, e.id, ap);
    fmea[e.id] = v;
    for (const row of v.rows) for (const c of row.causes) if (c.rpn !== undefined && (maxRpn === undefined || c.rpn > maxRpn)) maxRpn = c.rpn;
  }

  // --- 5. SCDL ---
  const mapped = toScdl(net, s);
  push("scdl", [...mapped.issues, ...validateScdl(mapped.model)]);

  // --- 6. トレース ---
  const trace = buildTrace(derived, s, levelOf);
  push(
    "trace",
    trace.uncovered.map((id) => ({
      code: "TRACE_UNCOVERED",
      severity: "warning" as const,
      message: "どの構造要素にも紐づいていない要求です",
      ref: id,
    })),
  );

  // --- パズルビュー ---
  const levelElements = (k: LevelKey) => net.elements.filter((e) => levelOf[e.id] === k).map((e) => e.id);
  const cells = Object.fromEntries(
    LEVELS.map((l) => [l.key, Object.fromEntries(["requirements", "structure", "behavior", "safety"].map((v) => [v, newCell()]))]),
  ) as Record<LevelKey, Record<Viewpoint, PuzzleCell>>;
  const levelOfRef = (elementId: ElementId | undefined): LevelKey =>
    elementId !== undefined && levelOf[elementId] ? levelOf[elementId]! : rootEl !== undefined ? levelOf[rootEl] ?? "system" : "system";
  for (const l of LEVELS) {
    const ids = new Set(levelElements(l.key));
    cells[l.key].structure.count = ids.size;
    cells[l.key].behavior.count = net.functions.filter((f) => ids.has(f.ownerId)).length;
    cells[l.key].requirements.count =
      derived.requirements.filter((r) => r.satisfiedBy.some((e) => ids.has(e))).length +
      s.safetyRequirements.filter((r) => r.allocatedTo !== undefined && ids.has(r.allocatedTo)).length;
    cells[l.key].safety.count =
      net.failures.filter((f) => ids.has(failureOwner(f.id) ?? "")).length +
      s.intendedFunctions.filter((f) => ids.has(f.elementId)).length +
      s.mechanisms.filter((m) => ids.has(m.elementId)).length +
      (l.key === "system" ? s.hara.goals.length : 0);
  }
  for (const i of issues) {
    const cell = cells[levelOfRef(i.elementId)][i.viewpoint];
    if (i.severity === "error") cell.errors++;
    else cell.warnings++;
  }
  for (const l of LEVELS) {
    const exists = levelElements(l.key).length > 0;
    for (const v of VIEWPOINTS) {
      const c = cells[l.key][v.key];
      c.status = !exists ? "none" : c.errors > 0 ? "inconsistent" : c.warnings > 0 ? "review" : c.count === 0 ? "undetermined" : "consistent";
    }
  }
  const puzzle: Puzzle = {
    levels: LEVELS.map((l) => ({ key: l.key, label: l.label, elementIds: levelElements(l.key) })),
    cells,
  };

  return {
    net,
    derived,
    levelOf,
    issues,
    fmea,
    apAvailable: ap !== undefined,
    puzzle,
    trace,
    scdl: mapped.model,
    scdlElementIds: mapped.elementIds,
    summary: {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      elements: net.elements.length,
      functions: net.functions.length,
      failures: net.failures.length,
      requirements: trace.rows.length,
      ...(maxRpn !== undefined ? { maxRpn } : {}),
    },
  };
}
