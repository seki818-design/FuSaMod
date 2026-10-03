import type { Issue } from "@fusamod/safety-core";
import type { ElementGraph, GraphDependency, GraphMetadata } from "@fusamod/sysml-graph";
import { ScdlSysmlError } from "./sysml-export.js";
import type { ImportResult } from "./sysml-import.js";
import type {
  Constraint,
  ConstraintTargetRef,
  Element,
  GroupRole,
  InterferenceTargetRef,
  Requirement,
  ScdlModel,
} from "./types.js";
import { emptyModel } from "./types.js";

type Kind =
  | "element" | "requirement" | "constraint" | "group" | "interaction"
  | "groupPairing" | "requirementPairing" | "coexistence" | "constraintPairing";

const STEREOTYPE: Record<string, Kind> = {
  ScdlElement: "element",
  ScdlRequirement: "requirement",
  ScdlConstraint: "constraint",
  ScdlRequirementGroup: "group",
  ScdlInteraction: "interaction",
  ScdlRequirementGroupPairing: "groupPairing",
  ScdlRequirementPairing: "requirementPairing",
  ScdlCoexistence: "coexistence",
  ScdlConstraintPairing: "constraintPairing",
};

interface Ctx {
  g: ElementGraph;
  m: ScdlModel;
  issues: Issue[];
  byQn: Map<string, { kind: Kind; id: string; md: GraphMetadata }>;
  depByQn: Map<string, GraphDependency>;
  allocation: Map<string, string>;
}
type Entry = { qn: string; kind: Kind; id: string; md: GraphMetadata };

const fail = (msg: string): never => {
  throw new ScdlSysmlError(msg);
};

const str = (md: GraphMetadata, k: string) => (typeof md.attributes[k] === "string" ? (md.attributes[k] as string) : undefined);
const common = (id: string, md: GraphMetadata) => ({
  id,
  ...(str(md, "title") !== undefined ? { name: str(md, "title")! } : {}),
  ...(str(md, "note") !== undefined ? { text: str(md, "note")! } : {}),
});
function weightOf(id: string, md: GraphMetadata): string | undefined {
  const w = str(md, "weight");
  const o = str(md, "decomposedFrom");
  if (w === undefined) {
    if (o !== undefined) fail(`weight が無い decomposedFrom: ${id}`);
    return undefined;
  }
  return o !== undefined ? `${w}(${o})` : w;
}

/** ステレオタイプが適用された要素を、完全修飾名で引けるようにする。 */
function indexStereotypes(g: ElementGraph): Ctx["byQn"] {
  const byQn: Ctx["byQn"] = new Map();
  for (const md of g.metadata) {
    const kind = md.type ? STEREOTYPE[md.type] : undefined;
    if (!kind) continue;
    // グループは注釈自体が要素(名前つきメタデータ使用)。それ以外は注釈の対象が要素
    for (const t of kind === "group" ? [md.qualifiedName] : md.annotated) {
      if (byQn.has(t)) fail(`同じ要素に複数の SCDL ステレオタイプが適用されています: ${t}`);
      const name = kind === "group" ? md.name : lookupName(g, t);
      if (!name) fail(`名前の無い要素に SCDL ステレオタイプが適用されています: ${t}`);
      byQn.set(t, { kind, id: name!, md });
    }
  }
  return byQn;
}

function expectKind(c: Ctx, qn: string, kinds: Kind[], what: string): string {
  const hit = c.byQn.get(qn);
  if (!hit) return fail(`${what}が SCDL 要素ではありません/解決できません: ${qn}`);
  if (!kinds.includes(hit.kind)) return fail(`${what}の種類が不正です(${hit.kind}): ${qn}`);
  return hit.id;
}

/** satisfy → 配置(allocation)。1 つの要求が複数のエレメントに配置されていれば指摘する。 */
function indexAllocation(c: Ctx) {
  for (const s of c.g.satisfies) {
    if (!s.requirement || !s.by) continue;
    const req = c.byQn.get(s.requirement);
    if (!req || (req.kind !== "requirement" && req.kind !== "constraint")) continue; // SCDL 以外の satisfy
    const by = expectKind(c, s.by, ["element"], "配置先");
    if (c.allocation.has(req.id) && c.allocation.get(req.id) !== by)
      c.issues.push({ code: "ALLOCATION_MULTIPLE", severity: "error", message: "要求が複数のエレメントに配置されています(allocation は 0..1)", ref: req.id });
    else c.allocation.set(req.id, by);
  }
}

/** 宣言順(グラフの走査順)に、SCDL の要素を並べる。 */
function declarationOrder(c: Ctx): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  const take = (qn: string) => {
    const hit = c.byQn.get(qn);
    if (hit && !seen.has(qn)) {
      seen.add(qn);
      out.push({ qn, ...hit });
    }
  };
  for (const e of [...c.g.elements, ...c.g.dependencies]) take(e.qualifiedName);
  for (const md of c.g.metadata) if (c.byQn.get(md.qualifiedName)?.kind === "group") take(md.qualifiedName);
  return out;
}

function buildElement(c: Ctx, { qn, id, md }: Entry) {
  const owner = c.g.elements.find((e) => e.qualifiedName === qn)?.owner;
  const parent = owner && c.byQn.get(owner)?.kind === "element" ? c.byQn.get(owner)!.id : undefined;
  const w = weightOf(id, md);
  const e: Element = { ...common(id, md), ...(parent ? { parent } : {}), ...(w ? { weight: w } : {}) };
  c.m.elements.push(e);
}

function buildRequirement(c: Ctx, { kind, id, md }: Entry) {
  const w = weightOf(id, md);
  const alloc = c.allocation.get(id);
  const base = { ...common(id, md), ...(w ? { weight: w } : {}), isAllocated: alloc !== undefined, ...(alloc !== undefined ? { allocation: alloc } : {}) };
  if (kind === "requirement") {
    const r: Requirement = { ...base, ...(md.attributes["isExternal"] === true ? { isExternal: true } : {}) };
    c.m.requirements.push(r);
  } else {
    const k: Constraint = base;
    c.m.constraints.push(k);
  }
}

function buildGroup(c: Ctx, { id, md }: Entry) {
  const role = str(md, "role") as GroupRole | undefined;
  c.m.groups.push({
    ...common(id, md),
    requirements: md.annotated.map((a) => expectKind(c, a, ["requirement"], "グループのメンバー")),
    ...(role ? { role } : {}),
  });
}

/** dependency で表される種類(インタラクション・ペアリング・無干渉・コネクティングライン)。 */
function buildDependency(c: Ctx, { qn, kind, id, md }: Entry) {
  const d = c.depByQn.get(qn);
  if (!d) return fail(`dependency が見つかりません: ${qn}`);
  const one = (list: string[], what: string) => {
    if (list.length !== 1) fail(`${what}は 1 つである必要があります: ${id}`);
    return list[0]!;
  };
  const ex = (q: string, kinds: Kind[], what: string) => expectKind(c, q, kinds, what);
  switch (kind) {
    case "interaction":
      c.m.interactions.push({ ...common(id, md), source: ex(one(d.client, "インタラクションの出力元"), ["requirement"], "出力元"), targets: d.supplier.map((s) => ex(s, ["requirement"], "宛先")) });
      return;
    case "groupPairing":
    case "requirementPairing": {
      const k: Kind = kind === "groupPairing" ? "group" : "requirement";
      const set: [string, string] = [ex(one(d.client, "ペアリングの端"), [k], "ペアの端"), ex(one(d.supplier, "ペアリングの端"), [k], "ペアの端")];
      (kind === "groupPairing" ? c.m.groupPairings : c.m.requirementPairings).push({ ...common(id, md), set });
      return;
    }
    case "coexistence": {
      const tq = one(d.supplier, "無干渉の干渉先");
      const t = c.byQn.get(tq);
      if (!t || !["requirement", "group", "element"].includes(t.kind)) fail(`無干渉の干渉先が不正です: ${tq}`);
      const target: InterferenceTargetRef = { kind: t!.kind as "requirement" | "group" | "element", id: t!.id };
      c.m.coexistences.push({ ...common(id, md), source: ex(one(d.client, "無干渉の干渉元"), ["element"], "干渉元"), target });
      return;
    }
    default: {
      const tq = one(d.supplier, "コネクティングラインの適用先");
      const t = c.byQn.get(tq);
      if (!t || !["groupPairing", "requirementPairing", "coexistence"].includes(t.kind)) fail(`適用先が不正です: ${tq}`);
      const target: ConstraintTargetRef =
        t!.kind === "groupPairing" ? { kind: "group-pairing", id: t!.id } : t!.kind === "requirementPairing" ? { kind: "requirement-pairing", id: t!.id } : { kind: "coexistence", id: t!.id };
      c.m.constraintPairings.push({ ...common(id, md), constraint: ex(one(d.client, "制約条件"), ["constraint"], "制約条件"), target });
    }
  }
}

/** 要素グラフ → SCDL モデル。ステレオタイプが付いていない要素は無視する。 */
export function scdlFromGraph(g: ElementGraph): ImportResult {
  const c: Ctx = { g, m: emptyModel(), issues: [], byQn: indexStereotypes(g), depByQn: new Map(g.dependencies.map((d) => [d.qualifiedName, d])), allocation: new Map() };
  indexAllocation(c);
  for (const e of declarationOrder(c)) {
    if (e.kind === "element") buildElement(c, e);
    else if (e.kind === "requirement" || e.kind === "constraint") buildRequirement(c, e);
    else if (e.kind === "group") buildGroup(c, e);
    else buildDependency(c, e);
  }
  return { model: c.m, issues: c.issues };
}

function lookupName(g: ElementGraph, qn: string): string | null | undefined {
  return (
    g.elements.find((e) => e.qualifiedName === qn)?.name ??
    g.dependencies.find((e) => e.qualifiedName === qn)?.name
  );
}
