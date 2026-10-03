import type { Issue } from "@fusamod/safety-core";
import type { ElementGraph, GraphElement, GraphParameter, GraphPerform, GraphSatisfy } from "./types.js";

/**
 * 型付きの使用(`part m : Motor`)と定義(`part def Motor { ... }`)を展開して、
 * 型を持たない入れ子だけのグラフ(deriveNet が読める形)にする。
 *
 * - 定義(PartDefinition / ActionDefinition)と、その中身の使用は、そのままでは構造に入れない(出力から外す)。
 * - 型付きの使用ごとに、型(と上位の型)の中身を、`<使用の ID>::<名前>` というインスタンスとして複製する。
 *   同じ定義の使用が複数あれば、複製も複数になる(m と m2 は別の構造要素)。
 * - perform / satisfy は、定義側を指していれば、複製されたインスタンスへ付け替える。
 * - 対応していない構成(port / connection / state / allocation、再定義、循環する定義)は、黙らずに警告する。
 *
 * 型を使わないモデルでは、入力と同じ内容を返す(順序も変えない)。
 */
export interface ExpandResult {
  graph: ElementGraph;
  issues: Issue[];
}

const DEFINITIONS = new Set(["PartDefinition", "ActionDefinition", "RequirementDefinition"]);
const USAGES = new Set(["PartUsage", "ActionUsage", "RequirementUsage"]);
const UNSUPPORTED: Record<string, string> = {
  PortUsage: "port",
  ConnectionUsage: "connection",
  InterfaceUsage: "interface",
  FlowConnectionUsage: "flow",
  AllocationUsage: "allocation",
  StateUsage: "state",
};
const MAX_DEPTH = 64;

const tail = (qn: string) => qn.split("::").pop()!;
/** 名前。名前のない再定義(`part :>> ax`)は、再定義している特徴の名前になる。 */
const lastName = (e: GraphElement) => e.name ?? (e.redefinedFeatures?.[0] ? tail(e.redefinedFeatures[0]) : tail(e.qualifiedName));
const append = <K, V>(m: Map<K, V[]>, k: K, v: V) => m.set(k, [...(m.get(k) ?? []), v]);

class Expander {
  readonly issues: Issue[] = [];
  private readonly byQn: Map<string, GraphElement>;
  private readonly children = new Map<string, GraphElement[]>();
  /** 定義側の使用の完全修飾名 → 複製の ID 一覧 */
  private readonly copiesOf = new Map<string, string[]>();
  /** インスタンス ID → その型の連鎖(定義と上位の型の完全修飾名) */
  private readonly typeChain = new Map<string, Set<string>>();
  private readonly instantiated = new Set<string>();
  private readonly out: GraphElement[] = [];
  private readonly g: ElementGraph;
  constructor(g0: ElementGraph) {
    // 完全修飾名の無い要素(不正なモデルで出力されることがある)は、黙って捨てず警告して除く
    const bad = g0.elements.filter((e) => typeof e.qualifiedName !== "string" || e.qualifiedName === "");
    const g: ElementGraph = bad.length ? { ...g0, elements: g0.elements.filter((e) => !bad.includes(e)) } : g0;
    this.g = g;
    if (bad.length) this.warn("INVALID_ELEMENT", `完全修飾名の無い要素が ${bad.length} 件あります(同じ名前の重複など、モデルの誤りの可能性)。無視しました`);
    this.byQn = new Map(g.elements.map((e) => [e.qualifiedName, e]));
    for (const e of g.elements) if (e.owner) append(this.children, e.owner, e);
  }

  private readonly warnedMult = new Set<string>();

  /** 多重度の警告(1 つの使用につき 1 回。インスタンスの経路ではなく、モデル上の使用を示す)。 */
  private warnMultiplicity(m: GraphElement) {
    const up = m.multiplicityUpper;
    const lo = m.multiplicityLower;
    if (this.warnedMult.has(m.qualifiedName)) return;
    let why: string | undefined;
    if (up === -2) why = "多重度の上限が式のため解析できません(1 つのインスタンスとして扱います)";
    else if (up === 0) why = "多重度が 0 です(インスタンスは作られませんが、1 つとして扱います)";
    else if (up !== undefined && (up > 1 || up === -1)) why = `多重度(上限 ${up === -1 ? "なし(*)" : up})は解析の対象外です。1 つのインスタンスとして扱います`;
    else if (lo === 0) why = "下限が 0 の多重度(任意)です。常に存在するものとして扱います";
    if (!why) return;
    this.warnedMult.add(m.qualifiedName);
    this.warn("MULTIPLICITY_IGNORED", `${why}: ${m.qualifiedName}`, m.qualifiedName);
  }

  private warn(code: string, message: string, ref?: string) {
    this.issues.push({ code, severity: "warning", message, ...(ref ? { ref } : {}) });
  }

  /** 定義の中にある要素(定義そのものと、その子孫)か。 */
  private insideDefinition(e: GraphElement): boolean {
    const seen = new Set<string>();
    for (let cur: GraphElement | undefined = e; cur && !seen.has(cur.qualifiedName); cur = cur.owner ? this.byQn.get(cur.owner) : undefined) {
      if (DEFINITIONS.has(cur.kind)) return true;
      seen.add(cur.qualifiedName);
    }
    return false;
  }

  private isDefinition(qn: string): boolean {
    const d = this.byQn.get(qn);
    return d !== undefined && DEFINITIONS.has(d.kind);
  }

  /**
   * 中身を引き継ぐ元(重複なし、宣言順)。型(定義)と、その上位の型に加えて、
   * 使用どうしの特殊化(`part ax2 :> ax`)と再定義(`part :>> ax`)の相手(使用)も含む。
   */
  private sourcesOf(el: GraphElement, seen = new Set<string>()): string[] {
    const order: string[] = [];
    const visit = (t: string) => {
      const d = this.byQn.get(t);
      if (!d || seen.has(t)) return;
      seen.add(t);
      order.push(t);
      for (const s of [...(d.supertypes ?? []), ...(d.redefinedFeatures ?? []), ...(USAGES.has(d.kind) ? (d.types ?? []) : [])]) visit(s);
    };
    for (const t of [...(el.types ?? []), ...(el.supertypes ?? []), ...(el.redefinedFeatures ?? [])]) visit(t);
    return order.filter((t) => this.byQn.has(t));
  }

  run(): ExpandResult {
    this.warnUnsupported();
    const kept = this.g.elements.filter((e) => !this.insideDefinition(e) && !UNSUPPORTED[e.kind] && !e.isRef);
    const typed = kept.some((e) => USAGES.has(e.kind) && (e.types?.some((t) => this.isDefinition(t)) || e.supertypes?.length || e.redefinedFeatures?.length));
    if (!typed && !this.g.elements.some((e) => DEFINITIONS.has(e.kind))) {
      for (const e of kept) if (USAGES.has(e.kind)) this.warnMultiplicity(e);
      return { graph: { ...this.g, elements: kept }, issues: this.issues };
    }

    for (const e of kept) {
      if (USAGES.has(e.kind)) this.warnMultiplicity(e);
      let el = e;
      if (e.kind === "ActionUsage" && !e.parameters?.length) el = { ...e, parameters: this.parametersOf(e) };
      // requirement def の本文は、型付きの requirement が自身の本文を持たなければ引き継ぐ
      if (e.kind === "RequirementUsage" && !e.doc) {
        const doc = this.sourcesOf(e).map((t) => this.byQn.get(t)?.doc).find((d) => d);
        if (doc) el = { ...e, doc };
      }
      this.out.push(el);
      if (USAGES.has(e.kind)) this.expandInto(e, 0, []);
    }
    this.warnUnusedDefinitions();
    return { graph: { ...this.g, elements: this.out, satisfies: this.remapSatisfies(), performs: this.remapPerforms() }, issues: this.issues };
  }

  private warnUnsupported() {
    const found = new Map<string, string[]>();
    for (const e of this.g.elements) {
      const label = UNSUPPORTED[e.kind] ?? (e.isRef ? "ref part(参照)" : undefined);
      if (label) append(found, label, e.qualifiedName);
    }
    for (const [label, qns] of found)
      this.warn("UNSUPPORTED_CONSTRUCT", `${label} は解析の対象外です(${qns.length} 件を無視しました。例: ${qns.slice(0, 2).join("、")})。インターフェースや状態からの故障モードは導出されません`, qns[0]);
  }

  private warnUnusedDefinitions() {
    for (const d of this.g.elements) {
      if (d.kind !== "PartDefinition" || this.instantiated.has(d.qualifiedName)) continue;
      if ((this.children.get(d.qualifiedName) ?? []).some((m) => USAGES.has(m.kind)))
        this.warn("DEFINITION_NOT_INSTANTIATED", "どの part からも使われていない定義です(構造ネットには入りません)", d.qualifiedName);
    }
  }

  /** action の入出力: 自身に宣言があればそれ、無ければ型(ActionDefinition)のもの。 */
  private parametersOf(a: GraphElement): GraphParameter[] {
    if (a.parameters?.length) return a.parameters;
    for (const t of a.types ?? []) {
      const d = this.byQn.get(t);
      if (d?.kind === "ActionDefinition" && d.parameters?.length) return d.parameters;
    }
    return [];
  }

  private copy(m: GraphElement, id: string, owner: string): GraphElement {
    return {
      kind: m.kind,
      qualifiedName: id,
      name: lastName(m),
      owner,
      ...(m.doc ? { doc: m.doc } : {}),
      ...(m.types ? { types: m.types } : {}),
      ...(m.supertypes ? { supertypes: m.supertypes } : {}),
      ...(m.redefinedFeatures ? { redefinedFeatures: m.redefinedFeatures } : {}),
      ...(m.kind === "ActionUsage" ? { parameters: this.parametersOf(m) } : {}),
    };
  }

  /** 定義側の使用 m を inst の子として複製し、m の中の入れ子も複製する。 */
  private instantiateMember(inst: GraphElement, m: GraphElement, depth: number, defStack: string[]) {
    const id = `${inst.qualifiedName}::${lastName(m)}`;
    const c = this.copy(m, id, inst.qualifiedName);
    this.out.push(c);
    append(this.copiesOf, m.qualifiedName, id);
    const nested: GraphElement[] = [];
    for (const gc of this.descendants(m)) {
      const rel = gc.qualifiedName.slice(m.qualifiedName.length);
      const gcId = id + rel;
      const copy = this.copy(gc, gcId, id + gc.owner!.slice(m.qualifiedName.length));
      this.out.push(copy);
      nested.push(copy);
      append(this.copiesOf, gc.qualifiedName, gcId);
    }
    this.expandInto(c, depth + 1, defStack);
    // 定義の中の入れ子の part が型付きなら、その型の中身も展開する
    for (const n of nested) this.expandInto(n, depth + 1, defStack);
  }

  private descendants(e: GraphElement): GraphElement[] {
    const out: GraphElement[] = [];
    const stack = [...(this.children.get(e.qualifiedName) ?? [])];
    while (stack.length) {
      const c = stack.shift()!;
      if (!USAGES.has(c.kind) || c.isRef) continue;
      out.push(c);
      stack.push(...(this.children.get(c.qualifiedName) ?? []));
    }
    return out;
  }

  private expandInto(inst: GraphElement, depth: number, defStack: string[]) {
    const defs = this.sourcesOf(inst);
    this.typeChain.set(inst.qualifiedName, new Set(defs));
    if (defs.length === 0) return;
    if (depth >= MAX_DEPTH) return this.warn("RECURSIVE_DEFINITION", "定義の入れ子が深すぎるため、展開を打ち切りました", inst.qualifiedName);
    const names = new Set((this.children.get(inst.qualifiedName) ?? []).map(lastName));
    for (const d of defs) {
      if (defStack.includes(d)) {
        this.warn("RECURSIVE_DEFINITION", `定義が自分自身を含んでいます(展開を止めます): ${d}`, inst.qualifiedName);
        continue;
      }
      if (this.isDefinition(d)) this.instantiated.add(d);
      for (const m of this.children.get(d) ?? []) {
        if (!USAGES.has(m.kind) || names.has(lastName(m))) continue; // 使用側に同名があれば、そちらを優先
        if (m.isRef) {
          this.warn("UNSUPPORTED_CONSTRUCT", `定義の中の ref part(参照)は構造に入れません: ${m.qualifiedName}`, m.qualifiedName);
          continue;
        }
        this.warnMultiplicity(m);
        names.add(lastName(m));
        this.instantiateMember(inst, m, depth, [...defStack, d]);
      }
    }
  }

  /** perform の実施者として書かれた定義(または定義の中の使用)を、複製されたインスタンスに展開する。 */
  private performerInstances(qn: string): string[] {
    const el = this.byQn.get(qn);
    if (el && DEFINITIONS.has(el.kind)) return [...this.typeChain].filter(([, chain]) => chain.has(qn)).map(([inst]) => inst);
    if (el && this.insideDefinition(el)) return this.copiesOf.get(qn) ?? [];
    return [qn];
  }

  private remapPerforms(): GraphPerform[] {
    const out: GraphPerform[] = [];
    for (const p of this.g.performs ?? []) {
      if (!p.performer || !p.performed) continue;
      const direct = this.byQn.get(p.performed);
      for (const inst of this.performerInstances(p.performer)) {
        if (direct && !this.insideDefinition(direct)) out.push({ performer: inst, performed: p.performed });
        else for (const c of (this.copiesOf.get(p.performed) ?? []).filter((x) => x.startsWith(`${inst}::`))) out.push({ performer: inst, performed: c });
      }
    }
    return out;
  }

  /** satisfy の連鎖(`car.front.rotor`)を、複製されたインスタンスの ID にたどる。たどれなければ undefined。 */
  private resolveChain(chain: string[], ids: Set<string>): string | undefined {
    const first = this.byQn.get(chain[0]!);
    if (!first || this.insideDefinition(first)) return undefined;
    let cur = chain[0]!;
    for (const next of chain.slice(1)) {
      const el = this.byQn.get(next);
      const cand = el ? `${cur}::${lastName(el)}` : undefined;
      if (!cand || !ids.has(cand)) return undefined;
      cur = cand;
    }
    return cur;
  }

  private remapSatisfies(): GraphSatisfy[] {
    const out: GraphSatisfy[] = [];
    const ids = new Set(this.out.map((e) => e.qualifiedName));
    for (const s of this.g.satisfies) {
      const by = s.by ? this.byQn.get(s.by) : undefined;
      // 満たされる要求の側が経路(r1.subB.deep)なら、その要求インスタンス 1 つに付け替える
      let requirement = s.requirement;
      if (s.requirementChain && s.requirementChain.length > 1) {
        const rid = this.resolveChain(s.requirementChain, ids);
        if (rid) requirement = rid;
        else {
          this.warn("SATISFY_UNRESOLVED", `satisfy の要求(${s.requirementChain.map((c) => c.split("::").pop()).join(".")})のインスタンスを特定できませんでした(紐づけません)`, s.requirement ?? undefined);
          continue;
        }
      }
      if (s.byChain && s.byChain.length > 1) {
        // インスタンスの経路が分かっている: その 1 つだけに紐づける
        const target = this.resolveChain(s.byChain, ids);
        if (target) out.push({ requirement, by: target });
        else this.warn("SATISFY_UNRESOLVED", `satisfy の対象(${s.byChain.map((c) => c.split("::").pop()).join(".")})のインスタンスを特定できませんでした(紐づけません)`, s.requirement ?? undefined);
        continue;
      }
      if (!s.by || !by || !this.insideDefinition(by)) {
        out.push(s.byChain || requirement !== s.requirement ? { requirement, by: s.by } : s);
        continue;
      }
      // 定義側の特徴を直接指している: 定義のすべてのインスタンスが満たすことになる
      const copies = this.copiesOf.get(s.by) ?? [];
      if (copies.length === 0) this.warn("SATISFY_NO_INSTANCE", "satisfy の対象が、使われていない定義の中の要素です", s.requirement ?? undefined);
      if (copies.length > 1) this.warn("SATISFY_AMBIGUOUS", `satisfy が定義側の要素を直接指しているため、${copies.length} 個のインスタンスすべてに紐づけました(特定するには car.front のような経路で書いてください)`, s.requirement ?? undefined);
      for (const c of copies) out.push({ requirement, by: c });
    }
    return out;
  }
}

export function expandGraph(g: ElementGraph): ExpandResult {
  return new Expander(g).run();
}
