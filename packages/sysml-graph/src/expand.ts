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

const DEFINITIONS = new Set(["PartDefinition", "ActionDefinition"]);
const USAGES = new Set(["PartUsage", "ActionUsage"]);
const UNSUPPORTED: Record<string, string> = {
  PortUsage: "port",
  ConnectionUsage: "connection",
  InterfaceUsage: "interface",
  FlowConnectionUsage: "flow",
  AllocationUsage: "allocation",
  StateUsage: "state",
};
const MAX_DEPTH = 64;

const lastName = (e: GraphElement) => e.name ?? e.qualifiedName.split("::").pop()!;
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

  constructor(private readonly g: ElementGraph) {
    this.byQn = new Map(g.elements.map((e) => [e.qualifiedName, e]));
    for (const e of g.elements) if (e.owner) append(this.children, e.owner, e);
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

  /** 型と上位の型のうち、定義であるもの(重複なし、宣言順)。 */
  private definitionsOf(types: string[]): string[] {
    const seen = new Set<string>();
    const order: string[] = [];
    const visit = (t: string) => {
      const d = this.byQn.get(t);
      if (!d || seen.has(t)) return;
      seen.add(t);
      if (DEFINITIONS.has(d.kind)) order.push(t);
      d.supertypes?.forEach(visit);
    };
    types.forEach(visit);
    return order;
  }

  run(): ExpandResult {
    this.warnUnsupported();
    const kept = this.g.elements.filter((e) => !this.insideDefinition(e) && !UNSUPPORTED[e.kind]);
    const typed = kept.some((e) => USAGES.has(e.kind) && e.types?.some((t) => this.isDefinition(t)));
    if (!typed && !this.g.elements.some((e) => DEFINITIONS.has(e.kind))) return { graph: { ...this.g, elements: kept }, issues: this.issues };

    for (const e of kept) {
      this.out.push(e.kind === "ActionUsage" && !e.parameters?.length ? { ...e, parameters: this.parametersOf(e) } : e);
      if (USAGES.has(e.kind)) this.expandInto(e, 0, []);
    }
    this.warnUnusedDefinitions();
    return { graph: { ...this.g, elements: this.out, satisfies: this.remapSatisfies(), performs: this.remapPerforms() }, issues: this.issues };
  }

  private warnUnsupported() {
    const found = new Map<string, string[]>();
    for (const e of this.g.elements) {
      const label = UNSUPPORTED[e.kind];
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
      name: m.name ?? lastName(m),
      owner,
      ...(m.doc ? { doc: m.doc } : {}),
      ...(m.types ? { types: m.types } : {}),
      ...(m.supertypes ? { supertypes: m.supertypes } : {}),
      ...(m.kind === "ActionUsage" ? { parameters: this.parametersOf(m) } : {}),
    };
  }

  /** 定義側の使用 m を inst の子として複製し、m の中の入れ子も複製する。 */
  private instantiateMember(inst: GraphElement, m: GraphElement, depth: number, defStack: string[]) {
    const id = `${inst.qualifiedName}::${lastName(m)}`;
    const c = this.copy(m, id, inst.qualifiedName);
    this.out.push(c);
    append(this.copiesOf, m.qualifiedName, id);
    for (const gc of this.descendants(m)) {
      const rel = gc.qualifiedName.slice(m.qualifiedName.length);
      const gcId = id + rel;
      this.out.push(this.copy(gc, gcId, id + gc.owner!.slice(m.qualifiedName.length)));
      append(this.copiesOf, gc.qualifiedName, gcId);
    }
    this.expandInto(c, depth + 1, defStack);
  }

  private descendants(e: GraphElement): GraphElement[] {
    const out: GraphElement[] = [];
    const stack = [...(this.children.get(e.qualifiedName) ?? [])];
    while (stack.length) {
      const c = stack.shift()!;
      if (!USAGES.has(c.kind)) continue;
      out.push(c);
      stack.push(...(this.children.get(c.qualifiedName) ?? []));
    }
    return out;
  }

  private expandInto(inst: GraphElement, depth: number, defStack: string[]) {
    const defs = this.definitionsOf(inst.types ?? []);
    this.typeChain.set(inst.qualifiedName, new Set([...defs, ...(inst.supertypes ?? [])]));
    if (defs.length === 0) return;
    if (depth >= MAX_DEPTH) return this.warn("RECURSIVE_DEFINITION", "定義の入れ子が深すぎるため、展開を打ち切りました", inst.qualifiedName);
    const names = new Set((this.children.get(inst.qualifiedName) ?? []).map(lastName));
    for (const d of defs) {
      if (defStack.includes(d)) {
        this.warn("RECURSIVE_DEFINITION", `定義が自分自身を含んでいます(展開を止めます): ${d}`, inst.qualifiedName);
        continue;
      }
      this.instantiated.add(d);
      for (const m of this.children.get(d) ?? []) {
        if (!USAGES.has(m.kind) || names.has(lastName(m))) continue; // 使用側に同名があれば、そちらを優先
        if (m.redefines) {
          this.warn("REDEFINITION_IGNORED", "再定義(:>>)は解析の対象外です(元の使用をそのまま使います)", m.qualifiedName);
          continue;
        }
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

  private remapSatisfies(): GraphSatisfy[] {
    const out: GraphSatisfy[] = [];
    for (const s of this.g.satisfies) {
      const by = s.by ? this.byQn.get(s.by) : undefined;
      if (!s.by || !by || !this.insideDefinition(by)) {
        out.push(s);
        continue;
      }
      const copies = this.copiesOf.get(s.by) ?? [];
      if (copies.length === 0) this.warn("SATISFY_NO_INSTANCE", "satisfy の対象が、使われていない定義の中の要素です", s.requirement ?? undefined);
      for (const c of copies) out.push({ requirement: s.requirement, by: c });
    }
    return out;
  }
}

export function expandGraph(g: ElementGraph): ExpandResult {
  return new Expander(g).run();
}
