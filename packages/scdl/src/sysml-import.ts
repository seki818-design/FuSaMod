import type { Issue } from "@fusamod/safety-core";
import { ScdlSysmlError } from "./sysml-export.js";
import type {
  Constraint,
  ConstraintTargetRef,
  Element,
  GroupRole,
  InterferenceTargetRef,
  Requirement,
  ScdlId,
  ScdlModel,
} from "./types.js";
import { emptyModel } from "./types.js";

/**
 * SCDL ステレオタイプを使った SysML v2 テキストの「部分」読み取り。
 * 対象は SCDL.sysml のステレオタイプを適用した宣言(package / part / requirement / dependency /
 * metadata ... about / satisfy)のみ。完全な SysML v2 パーサーは SysML アダプタ(ADR-0002)の責務。
 * 未対応の構文は黙って捨てずにエラーにする。
 */

type Tok =
  | { t: "name"; v: string; line: number } // '...' 無制限名
  | { t: "id"; v: string; line: number } // 識別子/キーワード
  | { t: "str"; v: string; line: number }
  | { t: "p"; v: string; line: number }; // 記号

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const quoted = (q: string): string => {
    let out = "";
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\" && i + 1 < src.length) {
        const n = src[i + 1]!;
        out += n === "n" ? "\n" : n;
        i += 2;
        continue;
      }
      if (src[i] === "\n") line++;
      out += src[i++];
    }
    if (i >= src.length) throw new ScdlSysmlError("引用符が閉じていません", line);
    i++;
    return out;
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) throw new ScdlSysmlError("コメントが閉じていません", line);
      line += (src.slice(i, end).match(/\n/g) ?? []).length;
      i = end + 2;
      continue;
    }
    if (c === "'") { const l = line; toks.push({ t: "name", v: quoted("'"), line: l }); continue; }
    if (c === '"') { const l = line; toks.push({ t: "str", v: quoted('"'), line: l }); continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      toks.push({ t: "id", v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (c === ":" && src[i + 1] === ":") { toks.push({ t: "p", v: "::", line }); i += 2; continue; }
    if ("{};,:@=<>[].*()".includes(c)) { toks.push({ t: "p", v: c, line }); i++; continue; }
    throw new ScdlSysmlError(`解釈できない文字: ${c}`, line);
  }
  return toks;
}

interface Ann {
  type: string;
  attrs: Map<string, string | boolean>;
}
type Kind =
  | "element" | "requirement" | "constraint" | "group" | "interaction"
  | "groupPairing" | "requirementPairing" | "coexistence" | "constraintPairing";
interface Decl {
  kind: "part" | "requirement" | "metadata" | "dependency";
  name: string;
  path: string[];
  ann?: Ann;
  parent?: Decl;
  about?: string[][];
  from?: string[][];
  to?: string[][];
  line: number;
  scdl?: Kind;
}

const SCDL_KIND: Record<string, Kind> = {
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
const EXPECTED_DECL: Record<Kind, Decl["kind"]> = {
  element: "part", requirement: "requirement", constraint: "requirement", group: "metadata",
  interaction: "dependency", groupPairing: "dependency", requirementPairing: "dependency",
  coexistence: "dependency", constraintPairing: "dependency",
};
const MODIFIERS = new Set(["private", "public", "protected"]);
const DECL_KEYWORDS = ["part", "requirement", "package", "metadata", "dependency", "satisfy", "import"];

export interface ImportResult {
  model: ScdlModel;
  /** 読み取り時に判明した、モデル意味上の指摘(配置の重複など) */
  issues: Issue[];
}

interface Satisfy {
  req: string[];
  by: string[];
  line: number;
}

/** SCDL ステレオタイプの宣言だけを読む再帰下降パーサー。未対応の構文は ScdlSysmlError。 */
class Parser {
  pos = 0;
  readonly decls: Decl[] = [];
  readonly satisfies: Satisfy[] = [];
  constructor(private readonly toks: Tok[]) {}

  private peek(o = 0) {
    return this.toks[this.pos + o];
  }
  private fail(msg: string): never {
    throw new ScdlSysmlError(msg, this.peek()?.line);
  }
  private isP(v: string, o = 0) {
    const t = this.peek(o);
    return t?.t === "p" && t.v === v;
  }
  private isId(v: string, o = 0) {
    const t = this.peek(o);
    return t?.t === "id" && t.v === v;
  }
  private expectP(v: string) {
    if (!this.isP(v)) this.fail(`'${v}' が必要です`);
    this.pos++;
  }
  private expectId(v: string) {
    if (!this.isId(v)) this.fail(`'${v}' が必要です`);
    this.pos++;
  }
  private name(): string {
    const t = this.peek();
    if (t && (t.t === "name" || t.t === "id")) {
      this.pos++;
      return t.v;
    }
    return this.fail("名前が必要です");
  }
  /** `::`(名前空間)と `.`(特徴連鎖)のどちらでもたどれる。 */
  private qname(): string[] {
    const segs = [this.name()];
    while (this.isP("::") || this.isP(".")) {
      this.pos++;
      segs.push(this.name());
    }
    return segs;
  }
  private qnames(): string[][] {
    const out = [this.qname()];
    while (this.isP(",")) {
      this.pos++;
      out.push(this.qname());
    }
    return out;
  }
  private skipTo(end: string) {
    while (this.peek() && !this.isP(end)) this.pos++;
    this.expectP(end);
  }
  /** `{ 名前 = 値; ... }` または `;`。値は文字列・真偽値・列挙値(修飾名の末尾)。 */
  private assignments(): Map<string, string | boolean> {
    const attrs = new Map<string, string | boolean>();
    if (this.isP(";")) {
      this.pos++;
      return attrs;
    }
    this.expectP("{");
    while (!this.isP("}")) {
      const key = this.name();
      this.expectP("=");
      const v = this.peek();
      if (v?.t === "str") {
        attrs.set(key, v.v);
        this.pos++;
      } else if (v?.t === "id" && (v.v === "true" || v.v === "false") && !this.isP("::", 1)) {
        attrs.set(key, v.v === "true");
        this.pos++;
      } else attrs.set(key, this.qname().at(-1)!);
      this.expectP(";");
    }
    this.expectP("}");
    return attrs;
  }
  private annotation(): Ann {
    this.expectP("@");
    const type = this.qname().at(-1)!;
    return { type, attrs: this.assignments() };
  }
  private body(owner: Decl | undefined, path: string[], partOwner: Decl | undefined) {
    this.expectP("{");
    this.members(owner, path, partOwner);
    this.expectP("}");
  }
  private bodyOrSemicolon(d: Decl, partOwner: Decl | undefined) {
    if (this.isP(";")) this.pos++;
    else this.body(d, d.path, partOwner);
  }

  members(owner: Decl | undefined, path: string[], partOwner: Decl | undefined) {
    while (this.peek() && !this.isP("}")) {
      while (this.peek()?.t === "id" && MODIFIERS.has(this.peek()!.v)) this.pos++;
      if (this.isP("@")) {
        if (!owner) this.fail("注釈の適用先がありません");
        owner!.ann = this.annotation();
        continue;
      }
      const t = this.peek()!;
      if (t.t !== "id") this.fail("宣言が必要です");
      this.declaration(t.v, t.line, owner, path, partOwner);
    }
  }

  private declaration(kw: string, line: number, _owner: Decl | undefined, path: string[], partOwner: Decl | undefined) {
    switch (kw) {
      case "import": return this.skipTo(";");
      case "doc": return this.skipDoc();
      case "library":
      case "standard": return void this.pos++;
      case "package": {
        this.pos++;
        const name = this.name();
        return this.body(undefined, [...path, name], undefined);
      }
      case "part": return this.part(line, path, partOwner);
      case "requirement": return this.simple("requirement", line, path);
      case "metadata": return this.metadata(line, path);
      case "dependency": return this.dependency(line, path);
      case "satisfy": return this.satisfy(line);
      default: return this.fail(`未対応の構文です: ${kw}`);
    }
  }

  private skipDoc() {
    this.pos++;
    const n = this.peek();
    if (n && (n.t === "name" || (n.t === "id" && !DECL_KEYWORDS.includes(n.v)))) this.pos++;
  }
  private part(line: number, path: string[], partOwner: Decl | undefined) {
    this.pos++;
    const name = this.name();
    const d: Decl = { kind: "part", name, path: [...path, name], line, ...(partOwner ? { parent: partOwner } : {}) };
    this.decls.push(d);
    this.bodyOrSemicolon(d, d);
  }
  private simple(kind: "requirement", line: number, path: string[]) {
    this.pos++;
    const name = this.name();
    const d: Decl = { kind, name, path: [...path, name], line };
    this.decls.push(d);
    this.bodyOrSemicolon(d, undefined);
  }
  private metadata(line: number, path: string[]) {
    this.pos++;
    const name = this.name();
    this.expectP(":");
    const type = this.qname().at(-1)!;
    this.expectId("about");
    const about = this.qnames();
    this.decls.push({ kind: "metadata", name, path: [...path, name], line, about, ann: { type, attrs: this.assignments() } });
  }
  private dependency(line: number, path: string[]) {
    this.pos++;
    const name = this.name();
    this.expectId("from");
    const from = this.qnames();
    this.expectId("to");
    const to = this.qnames();
    const d: Decl = { kind: "dependency", name, path: [...path, name], line, from, to };
    this.decls.push(d);
    this.bodyOrSemicolon(d, undefined);
  }
  private satisfy(line: number) {
    this.pos++;
    const req = this.qname();
    this.expectId("by");
    const by = this.qname();
    this.expectP(";");
    this.satisfies.push({ req, by, line });
  }
  atEnd() {
    return this.pos >= this.toks.length;
  }
  failHere(msg: string): never {
    return this.fail(msg);
  }
}

/** パーサーが集めた宣言から、SCDL ステレオタイプの付いたものだけを選ぶ。 */
function selectScdl(decls: Decl[]): Decl[] {
  const out: Decl[] = [];
  for (const d of decls) {
    const k = d.ann ? SCDL_KIND[d.ann.type] : undefined;
    if (!k) continue;
    if (EXPECTED_DECL[k] !== d.kind) throw new ScdlSysmlError(`${d.ann!.type} は ${EXPECTED_DECL[k]} に適用してください: ${d.name}`, d.line);
    d.scdl = k;
    out.push(d);
  }
  return out;
}

class Builder {
  readonly m: ScdlModel = emptyModel();
  readonly issues: Issue[] = [];
  private readonly allocation = new Map<string, string>();
  constructor(private readonly scdl: Decl[]) {}

  /** 末尾一致で修飾名を解決する(一意に決まらなければエラー)。 */
  private hits(segs: string[], kinds: Kind[]): Decl[] {
    return this.scdl.filter((d) => kinds.includes(d.scdl!) && d.path.length >= segs.length && segs.every((s, i) => d.path[d.path.length - segs.length + i] === s));
  }
  private resolve(segs: string[], kinds: Kind[], line: number): string {
    const h = this.hits(segs, kinds);
    if (h.length === 0) throw new ScdlSysmlError(`参照を解決できません: ${segs.join("::")}`, line);
    if (h.length > 1) throw new ScdlSysmlError(`参照が曖昧です: ${segs.join("::")}`, line);
    return h[0]!.name;
  }
  private resolveKind(segs: string[], kinds: Kind[], line: number): { id: string; kind: Kind } {
    const h = this.hits(segs, kinds);
    if (h.length !== 1) throw new ScdlSysmlError(`参照を解決できません/曖昧です: ${segs.join("::")}`, line);
    return { id: h[0]!.name, kind: h[0]!.scdl! };
  }
  private str(d: Decl, k: string) {
    const v = d.ann!.attrs.get(k);
    return typeof v === "string" ? v : undefined;
  }
  private common(d: Decl) {
    return { id: d.name, ...(this.str(d, "title") !== undefined ? { name: this.str(d, "title")! } : {}), ...(this.str(d, "note") !== undefined ? { text: this.str(d, "note")! } : {}), ...(this.str(d, "modelRef") !== undefined ? { modelRef: this.str(d, "modelRef")! } : {}) };
  }
  private weight(d: Decl): string | undefined {
    const w = this.str(d, "weight");
    const o = this.str(d, "decomposedFrom");
    if (w === undefined) {
      if (o !== undefined) throw new ScdlSysmlError(`weight が無い decomposedFrom: ${d.name}`, d.line);
      return undefined;
    }
    return o !== undefined ? `${w}(${o})` : w;
  }

  indexAllocation(satisfies: Satisfy[]) {
    for (const s of satisfies) {
      const req = this.resolveKind(s.req, ["requirement", "constraint"], s.line);
      const by = this.resolve(s.by, ["element"], s.line);
      if (this.allocation.has(req.id) && this.allocation.get(req.id) !== by)
        this.issues.push({ code: "ALLOCATION_MULTIPLE", severity: "error", message: "要求が複数のエレメントに配置されています(allocation は 0..1)", ref: req.id });
      else this.allocation.set(req.id, by);
    }
  }

  build() {
    for (const d of this.scdl) {
      switch (d.scdl) {
        case "element": this.element(d); break;
        case "requirement":
        case "constraint": this.requirement(d); break;
        case "group": this.group(d); break;
        default: this.dependency(d);
      }
    }
  }

  private element(d: Decl) {
    let p = d.parent; // 親 = 入れ子の最も近い SCDL エレメント
    while (p && p.scdl !== "element") p = p.parent;
    const w = this.weight(d);
    const e: Element = { ...this.common(d), ...(p ? { parent: p.name } : {}), ...(w ? { weight: w } : {}) };
    this.m.elements.push(e);
  }
  private requirement(d: Decl) {
    const w = this.weight(d);
    const alloc = this.allocation.get(d.name);
    const base = { ...this.common(d), ...(w ? { weight: w } : {}), isAllocated: alloc !== undefined, ...(alloc !== undefined ? { allocation: alloc } : {}) };
    if (d.scdl === "requirement") {
      const r: Requirement = { ...base, ...(d.ann!.attrs.get("isExternal") === true ? { isExternal: true } : {}) };
      this.m.requirements.push(r);
    } else {
      const c: Constraint = base;
      this.m.constraints.push(c);
    }
  }
  private group(d: Decl) {
    const role = this.str(d, "role") as GroupRole | undefined;
    this.m.groups.push({ ...this.common(d), requirements: d.about!.map((a) => this.resolve(a, ["requirement"], d.line)), ...(role ? { role } : {}) });
  }
  private single(d: Decl, list: string[][], what: string): string[] {
    if (list.length !== 1) throw new ScdlSysmlError(`${what}は 1 つずつです: ${d.name}`, d.line);
    return list[0]!;
  }
  private dependency(d: Decl) {
    const c = this.common(d);
    switch (d.scdl) {
      case "interaction":
        if (d.from!.length !== 1) throw new ScdlSysmlError(`インタラクションの出力元は 1 つです: ${d.name}`, d.line);
        this.m.interactions.push({ ...c, source: this.resolve(d.from![0]!, ["requirement"], d.line), targets: d.to!.map((t) => this.resolve(t, ["requirement"], d.line)) });
        return;
      case "groupPairing":
      case "requirementPairing": {
        const k: Kind = d.scdl === "groupPairing" ? "group" : "requirement";
        const set: [ScdlId, ScdlId] = [this.resolve(this.single(d, d.from!, "ペアリングの端"), [k], d.line), this.resolve(this.single(d, d.to!, "ペアリングの端"), [k], d.line)];
        (d.scdl === "groupPairing" ? this.m.groupPairings : this.m.requirementPairings).push({ ...c, set });
        return;
      }
      case "coexistence": {
        const t = this.resolveKind(this.single(d, d.to!, "無干渉の端"), ["requirement", "group", "element"], d.line);
        const target: InterferenceTargetRef = { kind: t.kind as "requirement" | "group" | "element", id: t.id };
        this.m.coexistences.push({ ...c, source: this.resolve(this.single(d, d.from!, "無干渉の端"), ["element"], d.line), target });
        return;
      }
      default: {
        const t = this.resolveKind(this.single(d, d.to!, "コネクティングラインの端"), ["groupPairing", "requirementPairing", "coexistence"], d.line);
        const target: ConstraintTargetRef =
          t.kind === "groupPairing" ? { kind: "group-pairing", id: t.id } : t.kind === "requirementPairing" ? { kind: "requirement-pairing", id: t.id } : { kind: "coexistence", id: t.id };
        this.m.constraintPairings.push({ ...c, constraint: this.resolve(this.single(d, d.from!, "コネクティングラインの端"), ["constraint"], d.line), target });
      }
    }
  }
}

export function importSysml(src: string): ImportResult {
  const parser = new Parser(tokenize(src));
  parser.members(undefined, [], undefined);
  if (!parser.atEnd()) parser.failHere("対応する '{' がありません");
  const b = new Builder(selectScdl(parser.decls));
  b.indexAllocation(parser.satisfies);
  b.build();
  return { model: b.m, issues: b.issues };
}
