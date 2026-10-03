import { isValidDecomposition, asilRank, type Issue } from "@fusamod/safety-core";
import type { ScdlId, ScdlModel } from "./types.js";
import { parseWeight, type ParsedWeight } from "./weight.js";

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids) (seen.has(id) ? out : seen).add(id);
  return [...out];
}

/**
 * SCDL メタモデル(附属書 A)の制約と、モデルとして判定できる記法規則の検証。
 * 図の幾何(重なり・内接など)は描画層の責務で、ここでは扱わない。
 */
export function validateScdl(m: ScdlModel): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, message: string, ref?: string) =>
    issues.push({ code, severity: "error", message, ...(ref ? { ref } : {}) });
  const warn = (code: string, message: string, ref?: string) =>
    issues.push({ code, severity: "warning", message, ...(ref ? { ref } : {}) });

  const collections: [string, { id: string }[]][] = [
    ["エレメント", m.elements],
    ["要求", m.requirements],
    ["制約条件", m.constraints],
    ["インタラクション", m.interactions],
    ["要求グループ", m.groups],
    ["要求グループペアリング", m.groupPairings],
    ["要求ペアリング", m.requirementPairings],
    ["無干渉", m.coexistences],
    ["コネクティングライン", m.constraintPairings],
  ];
  for (const [label, items] of collections)
    for (const id of dupes(items.map((i) => i.id))) err("DUP_ID", `${label} の ID が重複: ${id}`, id);

  const element = new Map(m.elements.map((e) => [e.id, e]));
  const req = new Map(m.requirements.map((r) => [r.id, r]));
  const constraint = new Map(m.constraints.map((c) => [c.id, c]));
  const group = new Map(m.groups.map((g) => [g.id, g]));
  const groupPairing = new Map(m.groupPairings.map((p) => [p.id, p]));
  const reqPairing = new Map(m.requirementPairings.map((p) => [p.id, p]));
  const coexistence = new Map(m.coexistences.map((c) => [c.id, c]));

  // A.6.2 Element: 入れ子に自分自身を含まない
  for (const e of m.elements) {
    if (e.parent !== undefined && !element.has(e.parent)) {
      err("UNKNOWN_REF", `親エレメントが存在しません: ${e.parent}`, e.id);
      continue;
    }
    const seen = new Set<ScdlId>([e.id]);
    for (let cur = e.parent; cur !== undefined; cur = element.get(cur)?.parent) {
      if (seen.has(cur)) {
        err("ELEMENT_CYCLE", "エレメントの入れ子に循環があります", e.id);
        break;
      }
      seen.add(cur);
    }
  }

  // A.5.2 AbstractRequirement: isAllocated と allocation の一致
  for (const r of [...m.requirements, ...m.constraints]) {
    if (r.isAllocated && r.allocation === undefined)
      err("ALLOCATION_MISMATCH", "isAllocated=true ですが配置先がありません", r.id);
    else if (!r.isAllocated && r.allocation !== undefined)
      err("ALLOCATION_MISMATCH", "isAllocated=false ですが配置先が指定されています", r.id);
    else if (r.allocation !== undefined && !element.has(r.allocation))
      err("UNKNOWN_REF", `配置先エレメントが存在しません: ${r.allocation}`, r.id);
  }

  // 重み付けの表記
  const weightOf = new Map<ScdlId, ParsedWeight>();
  for (const x of [...m.elements, ...m.requirements, ...m.constraints]) {
    if (x.weight === undefined) continue;
    const p = parseWeight(x.weight);
    if (!p) err("WEIGHT_FORMAT", `重み付けの表記が不正です: ${x.weight}`, x.id);
    else weightOf.set(x.id, p);
  }

  // A.10 Interaction / A.7.2 Requirement.outgoing 0..1
  const outgoing = new Map<ScdlId, number>();
  for (const i of m.interactions) {
    if (!req.has(i.source)) err("UNKNOWN_REF", `出力元の要求が存在しません: ${i.source}`, i.id);
    if (i.targets.length === 0) err("INTERACTION_NO_TARGET", "宛先がありません", i.id);
    for (const t of i.targets) if (!req.has(t)) err("UNKNOWN_REF", `宛先の要求が存在しません: ${t}`, i.id);
    if (i.targets.includes(i.source))
      err("INTERACTION_SELF", "出力元と宛先が同じ要求です", i.id);
    outgoing.set(i.source, (outgoing.get(i.source) ?? 0) + 1);
  }
  for (const [id, n] of outgoing)
    if (n > 1)
      err("MULTIPLE_OUTGOING", "1 つの要求から 2 つ以上の出力インタラクションは禁止です(分岐は 1 つのインタラクションの複数宛先で表す)", id);

  // A.11 RequirementGroup
  for (const g of m.groups) {
    if (g.requirements.length === 0) err("GROUP_EMPTY", "要求グループに要求がありません", g.id);
    for (const d of dupes(g.requirements)) err("GROUP_DUP_MEMBER", `要求が重複: ${d}`, g.id);
    for (const r of g.requirements)
      if (!req.has(r)) err("UNKNOWN_REF", `要求が存在しません: ${r}`, g.id);
  }

  // A.16 / A.17 ペアリング
  for (const p of m.groupPairings) {
    if (p.set[0] === p.set[1]) err("PAIRING_SAME", "同じ要求グループ同士のペアリングはできません", p.id);
    for (const g of p.set) if (!group.has(g)) err("UNKNOWN_REF", `要求グループが存在しません: ${g}`, p.id);
  }
  for (const p of m.requirementPairings) {
    if (p.set[0] === p.set[1]) err("PAIRING_SAME", "同じ要求同士のペアリングはできません", p.id);
    for (const r of p.set) if (!req.has(r)) err("UNKNOWN_REF", `要求が存在しません: ${r}`, p.id);
  }

  // A.14 CoexistenceTarget
  for (const c of m.coexistences) {
    if (!element.has(c.source)) err("UNKNOWN_REF", `干渉元のエレメントが存在しません: ${c.source}`, c.id);
    const t = c.target;
    const exists =
      t.kind === "requirement" ? req.has(t.id) : t.kind === "group" ? group.has(t.id) : element.has(t.id);
    if (!exists) err("UNKNOWN_REF", `干渉先が存在しません: ${t.kind}:${t.id}`, c.id);
    if (t.kind === "element" && t.id === c.source)
      err("COEXISTENCE_SELF", "エレメント自身への無干渉は定義できません", c.id);
  }

  // A.8 / A.9 Constraint と ConstraintPairing
  const constraintUse = new Map<ScdlId, number>();
  for (const cp of m.constraintPairings) {
    if (!constraint.has(cp.constraint))
      err("UNKNOWN_REF", `制約条件が存在しません: ${cp.constraint}`, cp.id);
    else constraintUse.set(cp.constraint, (constraintUse.get(cp.constraint) ?? 0) + 1);
    const t = cp.target;
    const ok =
      t.kind === "group-pairing"
        ? groupPairing.has(t.id)
        : t.kind === "requirement-pairing"
          ? reqPairing.has(t.id)
          : coexistence.has(t.id);
    if (!ok) err("UNKNOWN_REF", `紐づけ先が存在しません: ${t.kind}:${t.id}`, cp.id);
  }
  for (const c of m.constraints)
    if (!constraintUse.has(c.id))
      err("CONSTRAINT_NO_PAIRING", "制約条件がどのペアリング/無干渉にも紐づいていません", c.id);

  // 警告: 独立性の制約条件が無いペアリング(仕様上は省略可だが、ISO 26262-9 の分解には独立性が必要)
  const constrainedPairings = new Set(
    m.constraintPairings.filter((c) => c.target.kind === "group-pairing").map((c) => c.target.id),
  );
  for (const p of m.groupPairings)
    if (!constrainedPairings.has(p.id))
      warn("PAIRING_NO_CONSTRAINT", "要求グループペアリングに独立性の制約条件がありません", p.id);

  // 役割(拡張)が両方指定されているペアは、意図機能と安全機構の組であること
  for (const p of m.groupPairings) {
    const [a, b] = p.set.map((g) => group.get(g)?.role);
    if (a && b && a === b)
      warn("PAIR_ROLES", `ペアの両端がどちらも ${a} です(意図機能と安全機構の組が想定されます)`, p.id);
  }

  // ペアリングの ASIL 分解の整合(ヒューリスティック: 元 ASIL を持つ要求の最大 ASIL を群の ASIL とみなす)
  const groupAsil = (gid: ScdlId) => {
    const g = group.get(gid);
    if (!g) return undefined;
    const ws = g.requirements
      .map((r) => weightOf.get(r))
      .filter((w): w is ParsedWeight & { origin: NonNullable<ParsedWeight["origin"]> } => !!w?.origin);
    if (ws.length === 0) return undefined;
    const origins = new Set(ws.map((w) => w.origin));
    const levels = new Set(ws.map((w) => w.asil));
    if (origins.size > 1)
      warn("GROUP_MIXED_ORIGIN", "要求グループ内で分解前の ASIL が混在しています", gid);
    if (levels.size > 1) warn("GROUP_MIXED_WEIGHT", "要求グループ内で分解後の ASIL が混在しています", gid);
    const top = ws.reduce((a, b) => (asilRank(b.asil) > asilRank(a.asil) ? b : a));
    return top;
  };
  for (const p of m.groupPairings) {
    if (p.set[0] === p.set[1]) continue;
    const a = groupAsil(p.set[0]);
    const b = groupAsil(p.set[1]);
    if (!a || !b) continue;
    if (a.origin !== b.origin)
      err("PAIR_ORIGIN_MISMATCH", `ペアの元 ASIL が一致しません: ${a.origin} / ${b.origin}`, p.id);
    else if (!isValidDecomposition(a.origin, a.asil, b.asil))
      err("PAIR_DECOMP_INVALID", `ASIL ${a.origin} は ${a.asil} + ${b.asil} に分解できません`, p.id);
  }

  // エレメントの重み付けは、配置された要求(下位エレメント経由を含む)の最大 ASIL 以上
  const ancestors = (id: ScdlId): ScdlId[] => {
    const out: ScdlId[] = [];
    for (let cur: ScdlId | undefined = id, n = 0; cur !== undefined && n < 1000; cur = element.get(cur)?.parent, n++)
      out.push(cur);
    return out;
  };
  const maxAllocated = new Map<ScdlId, number>();
  for (const r of [...m.requirements, ...m.constraints]) {
    const w = weightOf.get(r.id);
    if (!w || r.allocation === undefined || !element.has(r.allocation)) continue;
    for (const a of ancestors(r.allocation))
      maxAllocated.set(a, Math.max(maxAllocated.get(a) ?? -1, asilRank(w.asil)));
  }
  for (const e of m.elements) {
    const w = weightOf.get(e.id);
    const need = maxAllocated.get(e.id);
    if (w && need !== undefined && asilRank(w.asil) < need)
      warn("ELEMENT_WEIGHT_LOW", "エレメントの重み付けが、配置された要求の最大 ASIL を下回っています", e.id);
  }

  return issues;
}
