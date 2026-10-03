import type { Issue } from "@fusamod/safety-core";
import type { ElementGraph, GraphMetadata } from "@fusamod/sysml-graph";
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

/** 要素グラフ → SCDL モデル。ステレオタイプが付いていない要素は無視する。 */
export function scdlFromGraph(g: ElementGraph): ImportResult {
  const issues: Issue[] = [];
  const fail = (msg: string): never => {
    throw new ScdlSysmlError(msg);
  };

  // 完全修飾名 → (SCDL の種類, ID, 注釈)
  const byQn = new Map<string, { kind: Kind; id: string; md: GraphMetadata }>();
  const applied = new Map<string, GraphMetadata[]>();
  for (const md of g.metadata) {
    const kind = md.type ? STEREOTYPE[md.type] : undefined;
    if (!kind) continue;
    // グループは注釈自体が要素(名前つきメタデータ使用)。それ以外は注釈の対象が要素
    const targets = kind === "group" ? [md.qualifiedName] : md.annotated;
    for (const t of targets) {
      if (byQn.has(t)) fail(`同じ要素に複数の SCDL ステレオタイプが適用されています: ${t}`);
      const name = kind === "group" ? md.name : lookupName(g, t);
      if (!name) fail(`名前の無い要素に SCDL ステレオタイプが適用されています: ${t}`);
      byQn.set(t, { kind, id: name!, md });
      applied.set(t, [...(applied.get(t) ?? []), md]);
    }
  }

  const expectKind = (qn: string, kinds: Kind[], what: string): string => {
    const hit = byQn.get(qn);
    if (!hit) return fail(`${what}が SCDL 要素ではありません/解決できません: ${qn}`);
    if (!kinds.includes(hit.kind)) return fail(`${what}の種類が不正です(${hit.kind}): ${qn}`);
    return hit.id;
  };
  const str = (md: GraphMetadata, k: string) => (typeof md.attributes[k] === "string" ? (md.attributes[k] as string) : undefined);
  const common = (id: string, md: GraphMetadata) => ({
    id,
    ...(str(md, "title") !== undefined ? { name: str(md, "title")! } : {}),
    ...(str(md, "note") !== undefined ? { text: str(md, "note")! } : {}),
  });
  const weightOf = (id: string, md: GraphMetadata): string | undefined => {
    const w = str(md, "weight");
    const o = str(md, "decomposedFrom");
    if (w === undefined) {
      if (o !== undefined) fail(`weight が無い decomposedFrom: ${id}`);
      return undefined;
    }
    return o !== undefined ? `${w}(${o})` : w;
  };

  const allocation = new Map<string, string>();
  for (const s of g.satisfies) {
    if (!s.requirement || !s.by) continue;
    const req = byQn.get(s.requirement);
    if (!req || (req.kind !== "requirement" && req.kind !== "constraint")) continue; // SCDL 以外の satisfy
    const by = expectKind(s.by, ["element"], "配置先");
    if (allocation.has(req.id) && allocation.get(req.id) !== by)
      issues.push({ code: "ALLOCATION_MULTIPLE", severity: "error", message: "要求が複数のエレメントに配置されています(allocation は 0..1)", ref: req.id });
    else allocation.set(req.id, by);
  }

  const m = emptyModel();
  const depByQn = new Map(g.dependencies.map((d) => [d.qualifiedName, d]));

  // 宣言順(グラフの走査順)で出力する
  const ordered: { qn: string; kind: Kind; id: string; md: GraphMetadata }[] = [];
  const seen = new Set<string>();
  for (const e of [...g.elements, ...g.dependencies]) {
    const hit = byQn.get(e.qualifiedName);
    if (hit && !seen.has(e.qualifiedName)) { seen.add(e.qualifiedName); ordered.push({ qn: e.qualifiedName, ...hit }); }
  }
  for (const md of g.metadata) {
    const hit = byQn.get(md.qualifiedName);
    if (hit && hit.kind === "group" && !seen.has(md.qualifiedName)) { seen.add(md.qualifiedName); ordered.push({ qn: md.qualifiedName, ...hit }); }
  }

  for (const o of ordered) {
    const { qn, kind, id, md } = o;
    switch (kind) {
      case "element": {
        const owner = g.elements.find((e) => e.qualifiedName === qn)?.owner;
        const parent = owner && byQn.get(owner)?.kind === "element" ? byQn.get(owner)!.id : undefined;
        const w = weightOf(id, md);
        const e: Element = { ...common(id, md), ...(parent ? { parent } : {}), ...(w ? { weight: w } : {}) };
        m.elements.push(e);
        break;
      }
      case "requirement":
      case "constraint": {
        const w = weightOf(id, md);
        const alloc = allocation.get(id);
        const base = { ...common(id, md), ...(w ? { weight: w } : {}), isAllocated: alloc !== undefined, ...(alloc !== undefined ? { allocation: alloc } : {}) };
        if (kind === "requirement") {
          const r: Requirement = { ...base, ...(md.attributes["isExternal"] === true ? { isExternal: true } : {}) };
          m.requirements.push(r);
        } else {
          const c: Constraint = base;
          m.constraints.push(c);
        }
        break;
      }
      case "group": {
        const role = str(md, "role") as GroupRole | undefined;
        m.groups.push({
          ...common(id, md),
          requirements: md.annotated.map((a) => expectKind(a, ["requirement"], "グループのメンバー")),
          ...(role ? { role } : {}),
        });
        break;
      }
      default: {
        const d = depByQn.get(qn);
        if (!d) { fail(`dependency が見つかりません: ${qn}`); break; }
        const one = (list: string[], what: string) => {
          if (list.length !== 1) fail(`${what}は 1 つである必要があります: ${id}`);
          return list[0]!;
        };
        if (kind === "interaction") {
          m.interactions.push({
            ...common(id, md),
            source: expectKind(one(d.client, "インタラクションの出力元"), ["requirement"], "出力元"),
            targets: d.supplier.map((s) => expectKind(s, ["requirement"], "宛先")),
          });
        } else if (kind === "groupPairing" || kind === "requirementPairing") {
          const k: Kind = kind === "groupPairing" ? "group" : "requirement";
          const set: [string, string] = [
            expectKind(one(d.client, "ペアリングの端"), [k], "ペアの端"),
            expectKind(one(d.supplier, "ペアリングの端"), [k], "ペアの端"),
          ];
          (kind === "groupPairing" ? m.groupPairings : m.requirementPairings).push({ ...common(id, md), set });
        } else if (kind === "coexistence") {
          const tq = one(d.supplier, "無干渉の干渉先");
          const t = byQn.get(tq);
          if (!t || !["requirement", "group", "element"].includes(t.kind)) fail(`無干渉の干渉先が不正です: ${tq}`);
          const target: InterferenceTargetRef = { kind: t!.kind as "requirement" | "group" | "element", id: t!.id };
          m.coexistences.push({ ...common(id, md), source: expectKind(one(d.client, "無干渉の干渉元"), ["element"], "干渉元"), target });
        } else if (kind === "constraintPairing") {
          const tq = one(d.supplier, "コネクティングラインの適用先");
          const t = byQn.get(tq);
          if (!t || !["groupPairing", "requirementPairing", "coexistence"].includes(t.kind)) fail(`適用先が不正です: ${tq}`);
          const target: ConstraintTargetRef =
            t!.kind === "groupPairing" ? { kind: "group-pairing", id: t!.id }
            : t!.kind === "requirementPairing" ? { kind: "requirement-pairing", id: t!.id }
            : { kind: "coexistence", id: t!.id };
          m.constraintPairings.push({ ...common(id, md), constraint: expectKind(one(d.client, "制約条件"), ["constraint"], "制約条件"), target });
        }
      }
    }
  }
  return { model: m, issues };
}

function lookupName(g: ElementGraph, qn: string): string | null | undefined {
  return (
    g.elements.find((e) => e.qualifiedName === qn)?.name ??
    g.dependencies.find((e) => e.qualifiedName === qn)?.name
  );
}
