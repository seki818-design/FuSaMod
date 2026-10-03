import { asilRank, type Asil, type ElementId, type Issue, type SafetyNet } from "@fusamod/safety-core";
import { emptyModel, type Constraint, type Element, type Requirement, type ScdlModel } from "@fusamod/scdl";
import type { SafetyData } from "./project.js";

export interface ScdlMapResult {
  model: ScdlModel;
  /** 変換できなかった項目の指摘 */
  issues: Issue[];
  /** 構造要素 ID → SCDL のエレメント ID(ITEM、E-1、E-1-1 …) */
  elementIds: Record<ElementId, string>;
}

const weightString = (asil: Asil | undefined, origin?: Asil | undefined): string | undefined =>
  asil === undefined ? undefined : origin !== undefined && origin !== asil ? `${asil}(${origin})` : asil;

const shorten = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 要求のプール(意図機能・安全機構・安全要求)の 1 件。 */
interface Item {
  id: string;
  name: string;
  text?: string;
  asil?: Asil;
  origin?: Asil;
  element?: ElementId;
}

interface Ctx {
  net: SafetyNet;
  s: SafetyData;
  m: ScdlModel;
  err(code: string, message: string, ref?: string): void;
  elementIds: Record<ElementId, string>;
  ancestors(id: ElementId): ElementId[];
  pool: Map<string, Item>;
}

/** エレメントの番号付け: 単一の根は ITEM、子は E-1、その子は E-1-1 …(SCDL の事例の記法)。 */
function numberElements({ net, elementIds }: Pick<Ctx, "net" | "elementIds">) {
  const children = new Map<string | undefined, string[]>();
  for (const e of net.elements) children.set(e.parentId, [...(children.get(e.parentId) ?? []), e.id]);
  const assign = (id: string, scdlId: string) => {
    elementIds[id] = scdlId;
    const prefix = scdlId === "ITEM" ? "E" : scdlId;
    (children.get(id) ?? []).forEach((c, i) => assign(c, `${prefix}-${i + 1}`));
  };
  const roots = children.get(undefined) ?? [];
  roots.forEach((r, i) => assign(r, roots.length === 1 ? "ITEM" : `E-${i + 1}`));
}

function buildPool({ s, pool, err }: Ctx) {
  const add = (it: Item, kind: string) => {
    if (pool.has(it.id)) return err("DUP_ID", `${kind} の ID が他の要求と重複しています: ${it.id}`, it.id);
    pool.set(it.id, it);
  };
  for (const f of s.intendedFunctions)
    add({ id: f.id, name: f.name, text: f.name, asil: f.asil, ...(f.originAsil ? { origin: f.originAsil } : {}), element: f.elementId }, "意図機能");
  for (const x of s.mechanisms)
    add({ id: x.id, name: x.name, text: x.name, ...(x.asil ? { asil: x.asil } : {}), ...(x.originAsil ? { origin: x.originAsil } : {}), element: x.elementId }, "安全機構");
  for (const r of s.safetyRequirements)
    add({ id: r.id, name: shorten(r.text), text: r.text, asil: r.asil, ...(r.originAsil ? { origin: r.originAsil } : {}), ...(r.allocatedTo ? { element: r.allocatedTo } : {}) }, "安全要求");
}

function mapRequirements({ m, pool, elementIds, err }: Ctx) {
  for (const it of pool.values()) {
    const known = it.element !== undefined && elementIds[it.element] !== undefined;
    if (it.element !== undefined && !known) err("UNKNOWN_ELEMENT", `配置先の構造要素が存在しません: ${it.element}`, it.id);
    const w = weightString(it.asil, it.origin);
    const r: Requirement = {
      id: it.id,
      name: it.name,
      ...(it.text ? { text: it.text } : {}),
      ...(w ? { weight: w } : {}),
      isAllocated: known,
      ...(known ? { allocation: elementIds[it.element!]! } : {}),
    };
    m.requirements.push(r);
  }
}

/** 要求グループ: 意図機能ごと・安全機構ごと。メンバーは、その要求自身と、追加の安全要求。 */
function mapGroups({ s, m, pool, err }: Ctx) {
  const members = (id: string, extra: string[] | undefined) =>
    [id, ...(extra ?? [])].filter((x, i, a) => {
      if (a.indexOf(x) !== i) return false;
      if (pool.has(x)) return true;
      err("UNKNOWN_REF", `グループのメンバーが存在しません: ${x}`, id);
      return false;
    });
  for (const f of s.intendedFunctions)
    if (pool.has(f.id)) m.groups.push({ id: `RG-${f.id}`, name: f.name, role: "intendedFunction", requirements: members(f.id, f.requirementIds) });
  for (const x of s.mechanisms)
    if (pool.has(x.id)) m.groups.push({ id: `SRG-${x.id}`, name: x.name, role: "safetyMechanism", requirements: members(x.id, x.requirementIds) });
}

/** ペア → 要求グループペアリング。独立性の要求があれば、共通の上位エレメントに配置する制約条件にする。 */
function mapPairs({ s, m, elementIds, ancestors, err }: Ctx) {
  const fnById = new Map(s.intendedFunctions.map((f) => [f.id, f]));
  const mechById = new Map(s.mechanisms.map((x) => [x.id, x]));
  for (const p of s.pairs) {
    const f = fnById.get(p.intendedFunctionId);
    const x = mechById.get(p.mechanismId);
    if (!f || !x) {
      err("UNKNOWN_REF", "ペアが存在しない意図機能/安全機構を参照しています", p.id);
      continue;
    }
    m.groupPairings.push({ id: p.id, set: [`RG-${f.id}`, `SRG-${x.id}`] });
    if (!p.independence) continue;
    const common = ancestors(f.elementId).find((a) => ancestors(x.elementId).includes(a));
    const top = [f, x]
      .map((i) => ({ a: i.asil, o: i.originAsil }))
      .filter((i): i is { a: Asil; o: Asil | undefined } => i.a !== undefined)
      .reduce<{ a: Asil; o: Asil | undefined } | undefined>((acc, i) => (!acc || asilRank(i.a) > asilRank(acc.a) ? i : acc), undefined);
    const allocated = common !== undefined && elementIds[common] !== undefined;
    const c: Constraint = {
      id: `NFSR-${p.id}`,
      name: "独立要求",
      text: p.independence,
      ...(top ? { weight: weightString(top.a, top.o)! } : {}),
      isAllocated: allocated,
      ...(allocated ? { allocation: elementIds[common!]! } : {}),
    };
    m.constraints.push(c);
    m.constraintPairings.push({ id: `CP-${p.id}`, constraint: c.id, target: { kind: "group-pairing", id: p.id } });
  }
}

/** 信号フロー → インタラクション。ext:<名前> はシステム境界の外側の相手(外部要求)にする。 */
function mapFlows({ s, m, pool, err }: Ctx) {
  const externals = new Set<string>();
  const endpoint = (ref: string, flowId: string): string | undefined => {
    if (ref.startsWith("ext:")) {
      const name = ref.slice(4);
      const id = `EXT-${name}`;
      if (!externals.has(id)) {
        externals.add(id);
        m.requirements.push({ id, name, isAllocated: false, isExternal: true });
      }
      return id;
    }
    if (pool.has(ref)) return ref;
    err("SIGNALFLOW_UNKNOWN", `信号フローの端が存在しません: ${ref}`, flowId);
    return undefined;
  };
  for (const f of s.signalFlows) {
    const source = endpoint(f.from, f.id);
    const targets = f.to.map((t) => endpoint(t, f.id)).filter((t): t is string => t !== undefined);
    if (source && targets.length > 0) m.interactions.push({ id: f.id, ...(f.name ? { name: f.name } : {}), source, targets });
  }
}

/** エレメントの重み付け: 配置された要求(下位を含む)の最大の ASIL。最大が全て同じ元 ASIL から分解されたものなら A(B) 表記。 */
function mapElements({ net, m, pool, elementIds, ancestors }: Ctx) {
  const held = new Map<ElementId, { a: Asil; o: Asil | undefined }[]>();
  const hold = (el: ElementId, a: Asil, o: Asil | undefined) => {
    for (const x of ancestors(el)) held.set(x, [...(held.get(x) ?? []), { a, o }]);
  };
  for (const it of pool.values()) if (it.asil && it.element && elementIds[it.element] !== undefined) hold(it.element, it.asil, it.origin);
  for (const c of m.constraints) {
    const alloc = Object.entries(elementIds).find(([, v]) => v === c.allocation)?.[0];
    const w = c.weight ? /^(QM|A|B|C|D)(?:\((QM|A|B|C|D)\))?$/.exec(c.weight) : null;
    if (alloc && w) hold(alloc, w[1] as Asil, w[2] as Asil | undefined);
  }
  for (const e of net.elements) {
    const items = held.get(e.id);
    let weight: string | undefined;
    if (items?.length) {
      const max = Math.max(...items.map((i) => asilRank(i.a)));
      const top = items.filter((i) => asilRank(i.a) === max);
      const origins = new Set(top.map((i) => i.o ?? "-"));
      const o = origins.size === 1 ? [...origins][0] : undefined;
      weight = weightString(top[0]!.a, o && o !== "-" ? (o as Asil) : undefined);
    }
    const el: Element = {
      id: elementIds[e.id]!,
      name: e.name,
      ...(e.parentId !== undefined && elementIds[e.parentId] ? { parent: elementIds[e.parentId]! } : {}),
      ...(weight ? { weight } : {}),
    };
    m.elements.push(el);
  }
}

/**
 * 安全分析のデータ(構造ネットと意図機能・安全機構・ペア・分解・信号フロー)から SCDL モデルを生成する(ADR-0006 の対応表)。
 * 変換できない参照は黙って捨てず、issues に返す。生成した SCDL モデルは validateScdl で検証する。
 */
export function toScdl(net: SafetyNet, s: SafetyData): ScdlMapResult {
  const issues: Issue[] = [];
  const parentOf = new Map(net.elements.map((e) => [e.id, e.parentId]));
  const ctx: Ctx = {
    net,
    s,
    m: emptyModel(),
    err: (code, message, ref) => void issues.push({ code, severity: "error", message, ...(ref ? { ref } : {}) }),
    elementIds: {},
    ancestors: (id) => {
      const out: ElementId[] = [];
      for (let cur: ElementId | undefined = id, n = 0; cur !== undefined && n < 1000; cur = parentOf.get(cur), n++) out.push(cur);
      return out;
    },
    pool: new Map(),
  };
  numberElements(ctx);
  buildPool(ctx);
  mapRequirements(ctx);
  mapGroups(ctx);
  mapPairs(ctx);
  mapFlows(ctx);
  mapElements(ctx);
  return { model: ctx.m, issues, elementIds: ctx.elementIds };
}
