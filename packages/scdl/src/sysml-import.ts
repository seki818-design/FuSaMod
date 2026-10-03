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
const MODIFIERS = new Set(["private", "public", "protected"]);

export interface ImportResult {
  model: ScdlModel;
  /** 読み取り時に判明した、モデル意味上の指摘(配置の重複など) */
  issues: Issue[];
}

export function importSysml(src: string): ImportResult {
  const toks = tokenize(src);
  let pos = 0;
  const peek = (o = 0) => toks[pos + o];
  const fail = (msg: string, tok = peek()): never => {
    throw new ScdlSysmlError(msg, tok?.line);
  };
  const isP = (v: string, o = 0) => peek(o)?.t === "p" && peek(o)!.v === v;
  const isId = (v: string, o = 0) => peek(o)?.t === "id" && peek(o)!.v === v;
  const expectP = (v: string) => {
    if (!isP(v)) fail(`'${v}' が必要です`);
    pos++;
  };
  const expectId = (v: string) => {
    if (!isId(v)) fail(`'${v}' が必要です`);
    pos++;
  };
  const nameTok = (): string => {
    const t = peek();
    if (t && (t.t === "name" || t.t === "id")) {
      pos++;
      return t.v;
    }
    return fail("名前が必要です");
  };
  const qname = (): string[] => {
    const segs = [nameTok()];
    // `::`(名前空間)と `.`(特徴連鎖)のどちらでもたどれる
    while (isP("::") || isP(".")) {
      pos++;
      segs.push(nameTok());
    }
    return segs;
  };

  const decls: Decl[] = [];
  const satisfies: { req: string[]; by: string[]; line: number }[] = [];

  const skipTo = (end: string) => {
    while (peek() && !isP(end)) pos++;
    expectP(end);
  };

  /** @Type ( ';' | '{' name '=' value ';' ... '}' ) */
  const annotation = (): Ann => {
    expectP("@");
    const type = qname().at(-1)!;
    const attrs = new Map<string, string | boolean>();
    if (isP(";")) {
      pos++;
    } else {
      expectP("{");
      while (!isP("}")) {
        const key = nameTok();
        expectP("=");
        const v = peek();
        if (v?.t === "str") { attrs.set(key, v.v); pos++; }
        else if (v?.t === "id" && (v.v === "true" || v.v === "false") && !isP("::", 1)) { attrs.set(key, v.v === "true"); pos++; }
        else attrs.set(key, qname().at(-1)!);
        expectP(";");
      }
      expectP("}");
    }
    return { type, attrs };
  };

  const body = (owner: Decl | undefined, path: string[], partOwner: Decl | undefined) => {
    expectP("{");
    members(owner, path, partOwner);
    expectP("}");
  };

  const members = (owner: Decl | undefined, path: string[], partOwner: Decl | undefined) => {
    while (peek() && !isP("}")) {
      while (peek()?.t === "id" && MODIFIERS.has(peek()!.v)) pos++;
      const t = peek()!;
      if (isP("@")) {
        if (!owner) fail("注釈の適用先がありません");
        owner!.ann = annotation();
        continue;
      }
      if (t.t !== "id") fail("宣言が必要です");
      switch (t.v) {
        case "import":
          skipTo(";");
          break;
        case "doc":
          pos++;
          if (peek() && (peek()!.t === "name" || (peek()!.t === "id" && !["part", "requirement", "package", "metadata", "dependency", "satisfy", "import"].includes(peek()!.v)))) pos++;
          break;
        case "library":
        case "standard":
          pos++;
          break;
        case "package": {
          pos++;
          const name = nameTok();
          body(undefined, [...path, name], undefined);
          break;
        }
        case "part": {
          pos++;
          const name = nameTok();
          const d: Decl = { kind: "part", name, path: [...path, name], line: t.line, ...(partOwner ? { parent: partOwner } : {}) };
          decls.push(d);
          if (isP(";")) pos++;
          else body(d, d.path, d);
          break;
        }
        case "requirement": {
          pos++;
          const name = nameTok();
          const d: Decl = { kind: "requirement", name, path: [...path, name], line: t.line };
          decls.push(d);
          if (isP(";")) pos++;
          else body(d, d.path, undefined);
          break;
        }
        case "metadata": {
          pos++;
          const name = nameTok();
          expectP(":");
          const type = qname().at(-1)!;
          expectId("about");
          const about = [qname()];
          while (isP(",")) { pos++; about.push(qname()); }
          const d: Decl = { kind: "metadata", name, path: [...path, name], line: t.line, about, ann: { type, attrs: new Map() } };
          decls.push(d);
          if (isP(";")) pos++;
          else {
            expectP("{");
            while (!isP("}")) {
              const key = nameTok();
              expectP("=");
              const v = peek();
              if (v?.t === "str") { d.ann!.attrs.set(key, v.v); pos++; }
              else d.ann!.attrs.set(key, qname().at(-1)!);
              expectP(";");
            }
            expectP("}");
          }
          break;
        }
        case "dependency": {
          pos++;
          const name = nameTok();
          expectId("from");
          const from = [qname()];
          while (isP(",")) { pos++; from.push(qname()); }
          expectId("to");
          const to = [qname()];
          while (isP(",")) { pos++; to.push(qname()); }
          const d: Decl = { kind: "dependency", name, path: [...path, name], line: t.line, from, to };
          decls.push(d);
          if (isP(";")) pos++;
          else body(d, d.path, undefined);
          break;
        }
        case "satisfy": {
          pos++;
          const req = qname();
          expectId("by");
          const by = qname();
          expectP(";");
          satisfies.push({ req, by, line: t.line });
          break;
        }
        default:
          fail(`未対応の構文です: ${t.v}`);
      }
    }
  };

  members(undefined, [], undefined);
  if (pos < toks.length) fail("対応する '{' がありません");

  // SCDL ステレオタイプが付いた宣言だけを対象にする
  const scdl: Decl[] = [];
  for (const d of decls) {
    const k = d.ann ? SCDL_KIND[d.ann.type] : undefined;
    if (!k) continue;
    const expected: Record<Kind, Decl["kind"]> = {
      element: "part", requirement: "requirement", constraint: "requirement", group: "metadata",
      interaction: "dependency", groupPairing: "dependency", requirementPairing: "dependency",
      coexistence: "dependency", constraintPairing: "dependency",
    };
    if (expected[k] !== d.kind)
      throw new ScdlSysmlError(`${d.ann!.type} は ${expected[k]} に適用してください: ${d.name}`, d.line);
    d.scdl = k;
    scdl.push(d);
  }

  const resolve = (segs: string[], kinds: Kind[], line: number): string => {
    const hits = scdl.filter(
      (d) => kinds.includes(d.scdl!) && d.path.length >= segs.length && segs.every((s, i) => d.path[d.path.length - segs.length + i] === s),
    );
    if (hits.length === 0) throw new ScdlSysmlError(`参照を解決できません: ${segs.join("::")}`, line);
    if (hits.length > 1) throw new ScdlSysmlError(`参照が曖昧です: ${segs.join("::")}`, line);
    return hits[0]!.name;
  };
  const kindOfPath = (segs: string[], kinds: Kind[], line: number): { id: string; kind: Kind } => {
    const hits = scdl.filter(
      (d) => kinds.includes(d.scdl!) && d.path.length >= segs.length && segs.every((s, i) => d.path[d.path.length - segs.length + i] === s),
    );
    if (hits.length !== 1) throw new ScdlSysmlError(`参照を解決できません/曖昧です: ${segs.join("::")}`, line);
    return { id: hits[0]!.name, kind: hits[0]!.scdl! };
  };

  const issues: Issue[] = [];
  const m = emptyModel();
  const str = (d: Decl, k: string) => (typeof d.ann!.attrs.get(k) === "string" ? (d.ann!.attrs.get(k) as string) : undefined);
  const common = (d: Decl) => ({
    id: d.name,
    ...(str(d, "title") !== undefined ? { name: str(d, "title")! } : {}),
    ...(str(d, "note") !== undefined ? { text: str(d, "note")! } : {}),
  });
  const weightOf = (d: Decl): string | undefined => {
    const w = str(d, "weight");
    const o = str(d, "decomposedFrom");
    if (w === undefined) {
      if (o !== undefined) throw new ScdlSysmlError(`weight が無い decomposedFrom: ${d.name}`, d.line);
      return undefined;
    }
    return o !== undefined ? `${w}(${o})` : w;
  };

  const allocation = new Map<string, string>();
  for (const s of satisfies) {
    const req = kindOfPath(s.req, ["requirement", "constraint"], s.line);
    const by = resolve(s.by, ["element"], s.line);
    if (allocation.has(req.id) && allocation.get(req.id) !== by)
      issues.push({ code: "ALLOCATION_MULTIPLE", severity: "error", message: "要求が複数のエレメントに配置されています(allocation は 0..1)", ref: req.id });
    else allocation.set(req.id, by);
  }

  for (const d of scdl) {
    switch (d.scdl) {
      case "element": {
        // 親 = 入れ子の最も近い SCDL エレメント
        let p = d.parent;
        while (p && p.scdl !== "element") p = p.parent;
        const w = weightOf(d);
        const e: Element = { ...common(d), ...(p ? { parent: p.name } : {}), ...(w ? { weight: w } : {}) };
        m.elements.push(e);
        break;
      }
      case "requirement":
      case "constraint": {
        const w = weightOf(d);
        const alloc = allocation.get(d.name);
        const base = { ...common(d), ...(w ? { weight: w } : {}), isAllocated: alloc !== undefined, ...(alloc !== undefined ? { allocation: alloc } : {}) };
        if (d.scdl === "requirement") {
          const r: Requirement = { ...base, ...(d.ann!.attrs.get("isExternal") === true ? { isExternal: true } : {}) };
          m.requirements.push(r);
        } else {
          const c: Constraint = base;
          m.constraints.push(c);
        }
        break;
      }
      case "group": {
        const role = str(d, "role") as GroupRole | undefined;
        m.groups.push({
          ...common(d),
          requirements: d.about!.map((a) => resolve(a, ["requirement"], d.line)),
          ...(role ? { role } : {}),
        });
        break;
      }
      case "interaction": {
        if (d.from!.length !== 1) throw new ScdlSysmlError(`インタラクションの出力元は 1 つです: ${d.name}`, d.line);
        m.interactions.push({
          ...common(d),
          source: resolve(d.from![0]!, ["requirement"], d.line),
          targets: d.to!.map((t) => resolve(t, ["requirement"], d.line)),
        });
        break;
      }
      case "groupPairing":
      case "requirementPairing": {
        if (d.from!.length !== 1 || d.to!.length !== 1)
          throw new ScdlSysmlError(`ペアリングは 2 者の間の関係です: ${d.name}`, d.line);
        const k: Kind = d.scdl === "groupPairing" ? "group" : "requirement";
        const set: [ScdlId, ScdlId] = [resolve(d.from![0]!, [k], d.line), resolve(d.to![0]!, [k], d.line)];
        (d.scdl === "groupPairing" ? m.groupPairings : m.requirementPairings).push({ ...common(d), set });
        break;
      }
      case "coexistence": {
        if (d.from!.length !== 1 || d.to!.length !== 1)
          throw new ScdlSysmlError(`無干渉の端は 1 つずつです: ${d.name}`, d.line);
        const t = kindOfPath(d.to![0]!, ["requirement", "group", "element"], d.line);
        const target: InterferenceTargetRef = { kind: t.kind as "requirement" | "group" | "element", id: t.id };
        m.coexistences.push({ ...common(d), source: resolve(d.from![0]!, ["element"], d.line), target });
        break;
      }
      case "constraintPairing": {
        if (d.from!.length !== 1 || d.to!.length !== 1)
          throw new ScdlSysmlError(`コネクティングラインの端は 1 つずつです: ${d.name}`, d.line);
        const t = kindOfPath(d.to![0]!, ["groupPairing", "requirementPairing", "coexistence"], d.line);
        const target: ConstraintTargetRef =
          t.kind === "groupPairing" ? { kind: "group-pairing", id: t.id }
          : t.kind === "requirementPairing" ? { kind: "requirement-pairing", id: t.id }
          : { kind: "coexistence", id: t.id };
        m.constraintPairings.push({ ...common(d), constraint: resolve(d.from![0]!, ["constraint"], d.line), target });
        break;
      }
    }
  }
  return { model: m, issues };
}
