import {
  buildFmeaView,
  buildIndex,
  compileApTable,
  validateAsilInheritance,
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
  /** AP 表の状態: none=未設定 / declared=出典あり / unofficial=非公式のサンプル / unknown=出典が未記入 */
  apStatus: "none" | "declared" | "unofficial" | "unknown";
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
 * パズルビューを、指摘の一部を除いて再計算する(例: 階層をまたいだ整合性チェック "consistency" をオフにする)。
 * 件数(count)は変えず、指摘の件数と状態だけを求め直す。入力は変更しない。
 */
export function recomputePuzzle(a: ProjectAnalysis, opts: { excludeSources?: string[] } = {}): Puzzle {
  const exclude = new Set(opts.excludeSources ?? []);
  const rootEl = a.net.elements.find((e) => e.parentId === undefined)?.id;
  const cells = Object.fromEntries(
    LEVELS.map((l) => [
      l.key,
      Object.fromEntries(VIEWPOINTS.map((v) => [v.key, { ...a.puzzle.cells[l.key][v.key], errors: 0, warnings: 0 }])),
    ]),
  ) as Record<LevelKey, Record<Viewpoint, PuzzleCell>>;
  for (const i of a.issues) {
    if (exclude.has(i.source)) continue;
    const lvl = i.elementId !== undefined && a.levelOf[i.elementId] ? a.levelOf[i.elementId]! : rootEl !== undefined ? a.levelOf[rootEl] ?? "system" : "system";
    const c = cells[lvl][i.viewpoint];
    if (i.severity === "error") c.errors++;
    else c.warnings++;
  }
  for (const l of a.puzzle.levels) {
    const exists = l.elementIds.length > 0;
    for (const v of VIEWPOINTS) {
      const c = cells[l.key][v.key];
      c.status = !exists ? "none" : c.errors > 0 ? "inconsistent" : c.warnings > 0 ? "review" : c.count === 0 ? "undetermined" : "consistent";
    }
  }
  return { levels: a.puzzle.levels, cells };
}

/** 指摘がどの視点・構造要素の問題かを引くための索引。 */
type Locate = (ref: string | undefined) => { viewpoint: Viewpoint; elementId?: ElementId } | undefined;

function makeLocator(net: SafetyNet, derived: DerivedNet, s: SafetyData): Locate {
  const idx = buildIndex(net);
  const linkById = new Map(net.links.map((l) => [l.id, l]));
  const failureOwner = (fid: string) => idx.fn.get(idx.failure.get(fid)?.functionId ?? "")?.ownerId;
  const intended = new Map(s.intendedFunctions.map((f) => [f.id, f]));
  const mech = new Map(s.mechanisms.map((m) => [m.id, m]));
  const pairs = new Map(s.pairs.map((p) => [p.id, p]));
  const safetyReq = new Map(s.safetyRequirements.map((r) => [r.id, r]));
  const sysmlReq = new Map(derived.requirements.map((r) => [r.id, r]));
  const decomps = new Map(s.decompositions.map((d) => [d.id, d]));
  const trees = new Map(s.faultTrees.map((t) => [t.id, t]));
  const withEl = (viewpoint: Viewpoint, elementId: ElementId | undefined) =>
    elementId !== undefined && idx.element.has(elementId) ? { viewpoint, elementId } : { viewpoint };
  return (ref) => {
    if (ref === undefined) return undefined;
    if (idx.element.has(ref)) return { viewpoint: "structure", elementId: ref };
    const fn = idx.fn.get(ref);
    if (fn) return { viewpoint: "behavior", elementId: fn.ownerId };
    if (idx.failure.has(ref)) return withEl("safety", failureOwner(ref));
    const link = linkById.get(ref);
    if (link) return withEl("safety", failureOwner(link.effectId));
    const sr = sysmlReq.get(ref);
    if (sr) return withEl("requirements", sr.satisfiedBy[0]);
    const f = intended.get(ref);
    if (f) return withEl("safety", f.elementId);
    const m = mech.get(ref);
    if (m) return withEl("safety", m.elementId);
    const p = pairs.get(ref);
    if (p) return withEl("safety", intended.get(p.intendedFunctionId)?.elementId);
    const r = safetyReq.get(ref);
    if (r) return withEl("requirements", r.allocatedTo);
    const d = decomps.get(ref);
    if (d) return withEl("safety", safetyReq.get(d.parentRequirementId)?.allocatedTo);
    const t = trees.get(ref);
    if (t) return withEl("safety", failureOwner(t.top));
    return undefined;
  };
}

const DEFAULT_VIEWPOINT: Record<string, Viewpoint> = {
  derive: "behavior", net: "safety", consistency: "behavior", hara: "safety", pairing: "safety",
  decomposition: "safety", "safety-req": "requirements", fta: "safety", fmea: "safety", scdl: "safety", trace: "requirements",
};

/** 階層をまたいだ整合性(構造・振る舞い・要求): 機能の分解、機能の無い要素、満たされない要求。 */
function crossLayerIssues(net: SafetyNet, derived: DerivedNet): Issue[] {
  const out: Issue[] = [];
  const hasChildren = new Set(net.elements.filter((e) => e.parentId).map((e) => e.parentId!));
  const decomposed = new Set(net.functions.map((g) => g.parentFunctionId).filter((x): x is string => x !== undefined));
  const owners = new Set(net.functions.map((f) => f.ownerId));
  for (const f of net.functions)
    if (hasChildren.has(f.ownerId) && !decomposed.has(f.id))
      out.push({ code: "FUNCTION_NOT_DECOMPOSED", severity: "warning", message: "下位要素があるのに、この機能が下位の機能に分解されていません", ref: f.id });
  for (const e of net.elements)
    if (!owners.has(e.id))
      out.push({ code: "ELEMENT_NO_FUNCTION", severity: "warning", message: "この構造要素が担当する機能がありません", ref: e.id });
  for (const r of derived.requirements)
    if (r.satisfiedBy.length === 0)
      out.push({ code: "REQUIREMENT_NOT_SATISFIED", severity: "warning", message: "どの構造要素にも satisfy されていない要求です", ref: r.id });
  return out;
}

/** 意図機能・安全機構・安全要求の参照整合。 */
/** 同じ種類の ID の重複(要求・分解・意図機能・安全機構・ペア・信号フロー・故障ノード・リンク・フォールトツリー)。 */
function duplicateIdIssues(s: SafetyData): Issue[] {
  const out: Issue[] = [];
  const groups: [string, { id: string }[]][] = [
    ["安全要求", s.safetyRequirements],
    ["デコンポジション", s.decompositions],
    ["意図機能", s.intendedFunctions],
    ["安全機構", s.mechanisms],
    ["ペア", s.pairs],
    ["信号フロー", s.signalFlows],
    ["故障ノード", s.failures],
    ["故障リンク", s.links],
    ["フォールトツリー", s.faultTrees],
  ];
  for (const [label, items] of groups) {
    const seen = new Set<string>();
    for (const { id } of items) {
      if (seen.has(id)) out.push({ code: "DUP_ID", severity: "error", message: `${label} の ID が重複しています: ${id}`, ref: id });
      seen.add(id);
    }
  }
  return out;
}

/** 診断カバレッジ(DC)と、FMEA の検出度(D)の整合: DC が高いのに、対象の故障の検出度が悪い(大きい)のは矛盾。 */
function coverageConsistencyIssues(net: SafetyNet, s: SafetyData): Issue[] {
  const maxD = { high: 3, medium: 5 } as const;
  const out: Issue[] = [];
  for (const m of s.mechanisms) {
    const limit = m.diagnosticCoverage === "high" ? maxD.high : m.diagnosticCoverage === "medium" ? maxD.medium : undefined;
    if (limit === undefined) continue;
    for (const fid of m.coversFailureIds ?? []) {
      for (const l of net.links) {
        if (l.causeId !== fid || l.detection === undefined || l.detection <= limit) continue;
        out.push({ code: "MECH_DC_D_MISMATCH", severity: "warning", message: `安全機構 ${m.id} の診断カバレッジは「${m.diagnosticCoverage}」ですが、対象の故障 ${fid} の検出度(D)が ${l.detection} です(${limit} 以下が目安)。検出管理か診断カバレッジを見直してください`, ref: m.id });
      }
    }
  }
  return out;
}

function referenceIssues(net: SafetyNet, s: SafetyData, derived: DerivedNet): { pairing: Issue[]; safetyReq: Issue[] } {
  const sysmlReqs = new Set(derived.requirements.map((r) => r.id));
  const known = new Set(net.elements.map((e) => e.id));
  const reqIds = new Set(s.safetyRequirements.map((r) => r.id));
  const pairing: Issue[] = [];
  for (const x of [...s.intendedFunctions, ...s.mechanisms])
    if (!known.has(x.elementId)) pairing.push({ code: "UNKNOWN_ELEMENT", severity: "error", message: `構造要素が存在しません: ${x.elementId}`, ref: x.id });
  const failureIds = new Set(net.failures.map((f) => f.id));
  for (const m of s.mechanisms) {
    for (const fid of m.coversFailureIds ?? [])
      if (!failureIds.has(fid)) pairing.push({ code: "UNKNOWN_REF", severity: "error", message: `安全機構が対象とする故障ノードが存在しません: ${fid}`, ref: m.id });
    if (m.asil !== undefined && m.asil !== "QM" && (m.coversFailureIds ?? []).length === 0)
      pairing.push({ code: "MECH_NO_COVERAGE", severity: "warning", message: "安全機構が対象とする故障モード(coversFailureIds)が未登録です(FMEA-MSR で何を検出・対処するかを紐づけてください)", ref: m.id });
  }
  const safetyReq: Issue[] = [];
  for (const r of s.safetyRequirements) {
    if (r.allocatedTo !== undefined && !known.has(r.allocatedTo))
      safetyReq.push({ code: "UNKNOWN_ELEMENT", severity: "error", message: `配置先の構造要素が存在しません: ${r.allocatedTo}`, ref: r.id });
    if (r.refines !== undefined && !sysmlReqs.has(r.refines))
      safetyReq.push({ code: "UNKNOWN_REF", severity: "error", message: `詳細化元の SysML 要求が存在しません: ${r.refines}`, ref: r.id });
    if (r.parentId !== undefined && !reqIds.has(r.parentId))
      safetyReq.push({ code: "UNKNOWN_REF", severity: "error", message: `上位の要求が存在しません: ${r.parentId}`, ref: r.id });
    if (r.asil !== "QM" && r.allocatedTo === undefined)
      safetyReq.push({ code: "REQ_NOT_ALLOCATED", severity: "warning", message: `ASIL ${r.asil} の安全要求が構造要素に配置されていません`, ref: r.id });
  }
  return { pairing, safetyReq };
}

/** 分解先の独立性: 配置先が未設定、または一方が他方の祖先/子孫の要素なら独立とみなせない。 */
function decompositionAllocationIssues(net: SafetyNet, s: SafetyData): Issue[] {
  const idx = buildIndex(net);
  const ancestors = (id: string): Set<string> => {
    const out = new Set<string>();
    for (let cur = idx.element.get(id); cur && !out.has(cur.id); cur = cur.parentId ? idx.element.get(cur.parentId) : undefined) out.add(cur.id);
    return out;
  };
  const byId = new Map(s.safetyRequirements.map((r) => [r.id, r]));
  const out: Issue[] = [];
  for (const d of s.decompositions) {
    const [c1, c2] = d.childRequirementIds.map((id) => byId.get(id));
    if (!c1 || !c2) continue;
    if (c1.allocatedTo === undefined || c2.allocatedTo === undefined) {
      out.push({ code: "DECOMP_NOT_ALLOCATED", severity: "error", message: "分解先の要求が構造要素に配置されておらず、独立性を確認できません", ref: d.id });
      continue;
    }
    if (c1.allocatedTo === c2.allocatedTo) continue; // 同一要素は validateDecompositions が報告
    if (ancestors(c1.allocatedTo).has(c2.allocatedTo) || ancestors(c2.allocatedTo).has(c1.allocatedTo))
      out.push({ code: "DECOMP_NOT_INDEPENDENT", severity: "error", message: "分解先の一方が、もう一方の配置先の上位(または下位)の要素に含まれており、独立性が成立しません", ref: d.id });
  }
  return out;
}

function faultTreeIssues(net: SafetyNet, s: SafetyData): Issue[] {
  const failures = new Set(net.failures.map((f) => f.id));
  const out: Issue[] = [];
  for (const t of s.faultTrees) {
    const list = validateFaultTree(t);
    for (const n of t.nodes)
      if (n.failureId !== undefined && !failures.has(n.failureId))
        list.push({ code: "FT_UNKNOWN_FAILURE", severity: "error", message: `対応する故障ノードが存在しません: ${n.failureId}`, ref: n.id });
    // ノードの指摘は、ツリー全体の指摘として扱う
    out.push(...list.map((i) => (i.ref !== undefined && t.nodes.some((n) => n.id === i.ref) ? { ...i, ref: t.id } : i)));
  }
  return out;
}

function apStatusOf(s: SafetyData, available: boolean): ProjectAnalysis["apStatus"] {
  if (!available) return "none";
  const src = s.apTableSource?.trim();
  return !src ? "unknown" : src.includes("非公式") ? "unofficial" : "declared";
}

function compileAp(s: SafetyData): { ap?: ApLookup; issues: Issue[] } {
  if (!s.apTable || s.apTable.length === 0)
    return { issues: [{ code: "AP_TABLE_MISSING", severity: "warning", message: "AIAG-VDA の AP 表が未設定です(RPN のみ表示します)。ハンドブックの正式な表を設定してください" }] };
  const issues: Issue[] = [];
  if (!s.apTableSource?.trim())
    issues.push({ code: "AP_TABLE_SOURCE_UNKNOWN", severity: "warning", message: "AP 表の出典(apTableSource)が未記入です。正式な表であることを確認し、出典を記録してください" });
  else if (s.apTableSource.includes("非公式"))
    issues.push({ code: "AP_TABLE_NOT_OFFICIAL", severity: "warning", message: `AP 表は非公式のサンプルです(${s.apTableSource})。実際の分析では、ハンドブックの正式な表に置き換えてください` });
  try {
    return { ap: compileApTable(s.apTable), issues };
  } catch (e) {
    return { issues: [...issues, { code: "AP_TABLE_INVALID", severity: "error", message: `AP 表が不正です: ${(e as Error).message}` }] };
  }
}

function buildPuzzle(a: Pick<ProjectAnalysis, "net" | "levelOf" | "issues" | "derived">, s: SafetyData): Puzzle {
  const { net, levelOf, issues, derived } = a;
  const fnOwner = new Map(net.functions.map((f) => [f.id, f.ownerId]));
  const failureFn = new Map(net.failures.map((x) => [x.id, x.functionId]));
  const failureOwner = (fid: string) => fnOwner.get(failureFn.get(fid) ?? "");
  const rootEl = net.elements.find((e) => e.parentId === undefined)?.id;
  const byLevel = new Map<string, string[]>();
  for (const e of net.elements) {
    const k = levelOf[e.id];
    if (k !== undefined) byLevel.set(k, [...(byLevel.get(k) ?? []), e.id]);
  }
  const levelElements = (k: LevelKey) => byLevel.get(k) ?? [];
  const cells = Object.fromEntries(LEVELS.map((l) => [l.key, Object.fromEntries(VIEWPOINTS.map((v) => [v.key, newCell()]))])) as Record<LevelKey, Record<Viewpoint, PuzzleCell>>;
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
  const levelOfRef = (elementId: ElementId | undefined): LevelKey =>
    elementId !== undefined && levelOf[elementId] ? levelOf[elementId]! : rootEl !== undefined ? levelOf[rootEl] ?? "system" : "system";
  for (const i of issues) {
    const cell = cells[levelOfRef(i.elementId)][i.viewpoint];
    if (i.severity === "error") cell.errors++;
    else cell.warnings++;
  }
  for (const l of LEVELS)
    for (const v of VIEWPOINTS) {
      const c = cells[l.key][v.key];
      c.status = levelElements(l.key).length === 0 ? "none" : c.errors > 0 ? "inconsistent" : c.warnings > 0 ? "review" : c.count === 0 ? "undetermined" : "consistent";
    }
  return { levels: LEVELS.map((l) => ({ key: l.key, label: l.label, elementIds: levelElements(l.key) })), cells };
}

/**
 * モデル(SysML の要素グラフ)と安全分析データを突き合わせ、ネット・FMEA・整合性・パズルビュー・トレース・SCDL を一括で解析する。
 * 純粋関数。入力は変更しない。
 */
export function analyzeProject(graph: ElementGraph, s: SafetyData): ProjectAnalysis {
  const derived = deriveNet(graph);
  const net: SafetyNet = { ...derived.net, failures: s.failures, links: s.links };
  const levelOf = computeLevels(net, s.levelOverrides ?? {});
  const locate = makeLocator(net, derived, s);
  const issues: AnalysisIssue[] = [];
  const push = (source: string, list: Issue[]) => {
    for (const i of list) {
      const loc = locate(i.ref);
      issues.push({
        ...i,
        source,
        viewpoint: loc?.viewpoint ?? DEFAULT_VIEWPOINT[source] ?? "safety",
        ...(loc?.elementId !== undefined ? { elementId: loc.elementId } : {}),
      });
    }
  };

  push("derive", derived.deriveIssues);
  push("net", validateNet(net));
  push("consistency", crossLayerIssues(net, derived));
  push("hara", validateHara(s.hara));
  const refs = referenceIssues(net, s, derived);
  push("pairing", [...refs.pairing, ...validatePairing(s.intendedFunctions, s.mechanisms, s.pairs)]);
  push("safety-req", [...refs.safetyReq, ...duplicateIdIssues(s)]);
  push("pairing", coverageConsistencyIssues(net, s));
  push("decomposition", [
    ...validateDecompositions(s.safetyRequirements, s.decompositions),
    ...validateAsilInheritance(s.safetyRequirements, s.decompositions, s.hara.goals),
    ...decompositionAllocationIssues(net, s),
  ]);
  push("fta", faultTreeIssues(net, s));

  const { ap, issues: apIssues } = compileAp(s);
  push("fmea", apIssues);
  const fmea: Record<ElementId, FmeaView> = {};
  let maxRpn: number | undefined;
  const fnOwners = new Set(net.functions.map((f) => f.ownerId));
  const netIdx = buildIndex(net);
  for (const e of net.elements) {
    if (!fnOwners.has(e.id)) continue;
    const v = buildFmeaView(net, e.id, ap, netIdx);
    fmea[e.id] = v;
    for (const row of v.rows) for (const c of row.causes) if (c.rpn !== undefined && (maxRpn === undefined || c.rpn > maxRpn)) maxRpn = c.rpn;
  }

  const mapped = toScdl(net, s);
  push("scdl", [...mapped.issues, ...validateScdl(mapped.model)]);
  const trace = buildTrace(derived, s, levelOf);
  push("trace", trace.uncovered.map((id) => ({ code: "TRACE_UNCOVERED", severity: "warning" as const, message: "どの構造要素にも紐づいていない要求です", ref: id })));

  return {
    net, derived, levelOf, issues, fmea,
    apAvailable: ap !== undefined,
    apStatus: apStatusOf(s, ap !== undefined),
    puzzle: buildPuzzle({ net, levelOf, issues, derived }, s),
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
