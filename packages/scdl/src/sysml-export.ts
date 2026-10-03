import type { Asil } from "@fusamod/safety-core";
import type { ScdlId, ScdlModel } from "./types.js";
import { parseWeight } from "./weight.js";

export class ScdlSysmlError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line ? `${message} (行 ${line})` : message);
  }
}

/** SysML v2 の無制限名('...')。ID をそのまま宣言名にするため、常に引用符で囲む。 */
export function quoteName(id: string): string {
  return `'${id.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function str(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export const PACKAGES = {
  architecture: "Architecture",
  requirements: "Requirements",
  constraints: "Constraints",
  groups: "Groups",
  interactions: "Interactions",
  groupPairings: "GroupPairings",
  requirementPairings: "RequirementPairings",
  coexistences: "Coexistences",
  constraintPairings: "ConstraintPairings",
  allocations: "Allocations",
} as const;

export interface ExportOptions {
  /** 出力するトップレベルパッケージ名(識別子の形式) */
  packageName: string;
}

/**
 * SCDL モデルを、SCDL ステレオタイプ・ライブラリ(libs/sysml/scdl/SCDL.sysml)を使った
 * SysML v2 テキストにする。事前に validateScdl で検証しておくこと。
 */
export function exportSysml(m: ScdlModel, opts: ExportOptions): string {
  const root = opts.packageName;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(root))
    throw new ScdlSysmlError(`パッケージ名が不正です: ${root}`);

  const elementById = new Map(m.elements.map((e) => [e.id, e]));
  const elementPath = (id: ScdlId): string => {
    const chain: string[] = [];
    const seen = new Set<ScdlId>();
    for (let cur: ScdlId | undefined = id; cur !== undefined; cur = elementById.get(cur)?.parent) {
      if (seen.has(cur)) throw new ScdlSysmlError(`エレメントの入れ子に循環があります: ${id}`);
      seen.add(cur);
      if (!elementById.has(cur)) throw new ScdlSysmlError(`エレメントが存在しません: ${cur}`);
      chain.unshift(quoteName(cur));
    }
    return [root, PACKAGES.architecture, ...chain].join("::");
  };
  const ref = (pkg: string, id: ScdlId) => `${root}::${pkg}::${quoteName(id)}`;
  const known = {
    requirement: new Set(m.requirements.map((r) => r.id)),
    constraint: new Set(m.constraints.map((r) => r.id)),
    group: new Set(m.groups.map((g) => g.id)),
  };
  const need = (set: Set<ScdlId>, id: ScdlId, what: string) => {
    if (!set.has(id)) throw new ScdlSysmlError(`${what}が存在しません: ${id}`);
    return id;
  };

  const out: string[] = [];
  const line = (depth: number, text: string) => out.push(text ? `${"    ".repeat(depth)}${text}` : "");

  const attrs = (x: { name?: string | undefined; text?: string | undefined; weight?: string | undefined }, extra: string[] = []) => {
    const a: string[] = [];
    if (x.name !== undefined) a.push(`title = ${str(x.name)};`);
    if (x.text !== undefined) a.push(`note = ${str(x.text)};`);
    if (x.weight !== undefined) {
      const w = parseWeight(x.weight);
      if (!w) throw new ScdlSysmlError(`重み付けの表記が不正です: ${x.weight}`);
      a.push(`weight = Asil::${w.asil};`);
      if (w.origin) a.push(`decomposedFrom = Asil::${w.origin as Asil};`);
    }
    return [...a, ...extra];
  };
  const annotation = (depth: number, type: string, a: string[]) => {
    if (a.length === 0) line(depth, `@${type};`);
    else line(depth, `@${type} { ${a.join(" ")} }`);
  };

  line(0, `package ${root} {`);
  line(1, "private import SCDL::*;");

  // エレメント: part の入れ子
  line(1, "");
  line(1, `package ${PACKAGES.architecture} {`);
  const childrenOf = new Map<ScdlId | undefined, typeof m.elements>();
  for (const e of m.elements) {
    const list = childrenOf.get(e.parent) ?? [];
    list.push(e);
    childrenOf.set(e.parent, list);
  }
  const emitElement = (e: (typeof m.elements)[number], depth: number) => {
    line(depth, `part ${quoteName(e.id)} {`);
    annotation(depth + 1, "ScdlElement", attrs(e));
    for (const c of childrenOf.get(e.id) ?? []) emitElement(c, depth + 1);
    line(depth, "}");
  };
  for (const e of m.elements) elementPath(e.id); // 参照整合・循環の検査
  for (const e of childrenOf.get(undefined) ?? []) emitElement(e, 2);
  line(1, "}");

  const emitRequirements = (pkg: string, items: ScdlModel["requirements"], type: string) => {
    line(1, "");
    line(1, `package ${pkg} {`);
    for (const r of items) {
      line(2, `requirement ${quoteName(r.id)} {`);
      annotation(
        3,
        type,
        attrs(r, type === "ScdlRequirement" && (r as { isExternal?: boolean }).isExternal ? ["isExternal = true;"] : []),
      );
      line(2, "}");
    }
    line(1, "}");
  };
  emitRequirements(PACKAGES.requirements, m.requirements, "ScdlRequirement");
  emitRequirements(PACKAGES.constraints, m.constraints, "ScdlConstraint");

  // 要求グループ: 要求への注釈(about)
  line(1, "");
  line(1, `package ${PACKAGES.groups} {`);
  for (const g of m.groups) {
    if (g.requirements.length === 0) throw new ScdlSysmlError(`要求グループが空です: ${g.id}`);
    const about = g.requirements
      .map((r) => ref(PACKAGES.requirements, need(known.requirement, r, "要求")))
      .join(", ");
    const a = attrs(g, g.role ? [`role = ScdlGroupRole::${g.role};`] : []);
    line(
      2,
      `metadata ${quoteName(g.id)} : ScdlRequirementGroup about ${about}${a.length ? ` { ${a.join(" ")} }` : ";"}`,
    );
  }
  line(1, "}");

  const emitDependencies = <T extends { id: ScdlId; name?: string | undefined; text?: string | undefined }>(
    pkg: string,
    type: string,
    items: T[],
    ends: (x: T) => { from: string[]; to: string[] },
  ) => {
    line(1, "");
    line(1, `package ${pkg} {`);
    for (const x of items) {
      const { from, to } = ends(x);
      if (from.length === 0 || to.length === 0) throw new ScdlSysmlError(`関係の端がありません: ${x.id}`);
      line(2, `dependency ${quoteName(x.id)} from ${from.join(", ")} to ${to.join(", ")} {`);
      annotation(3, type, attrs(x));
      line(2, "}");
    }
    line(1, "}");
  };

  emitDependencies(PACKAGES.interactions, "ScdlInteraction", m.interactions, (i) => ({
    from: [ref(PACKAGES.requirements, need(known.requirement, i.source, "出力元の要求"))],
    to: i.targets.map((t) => ref(PACKAGES.requirements, need(known.requirement, t, "宛先の要求"))),
  }));
  emitDependencies(PACKAGES.groupPairings, "ScdlRequirementGroupPairing", m.groupPairings, (p) => ({
    from: [ref(PACKAGES.groups, need(known.group, p.set[0], "要求グループ"))],
    to: [ref(PACKAGES.groups, need(known.group, p.set[1], "要求グループ"))],
  }));
  emitDependencies(PACKAGES.requirementPairings, "ScdlRequirementPairing", m.requirementPairings, (p) => ({
    from: [ref(PACKAGES.requirements, need(known.requirement, p.set[0], "要求"))],
    to: [ref(PACKAGES.requirements, need(known.requirement, p.set[1], "要求"))],
  }));
  emitDependencies(PACKAGES.coexistences, "ScdlCoexistence", m.coexistences, (c) => {
    if (!elementById.has(c.source)) throw new ScdlSysmlError(`干渉元のエレメントが存在しません: ${c.source}`);
    const t = c.target;
    const to =
      t.kind === "element"
        ? elementPath(t.id)
        : t.kind === "group"
          ? ref(PACKAGES.groups, need(known.group, t.id, "要求グループ"))
          : ref(PACKAGES.requirements, need(known.requirement, t.id, "要求"));
    return { from: [elementPath(c.source)], to: [to] };
  });
  const targetRef = (t: ScdlModel["constraintPairings"][number]["target"]) =>
    t.kind === "group-pairing"
      ? ref(PACKAGES.groupPairings, t.id)
      : t.kind === "requirement-pairing"
        ? ref(PACKAGES.requirementPairings, t.id)
        : ref(PACKAGES.coexistences, t.id);
  emitDependencies(PACKAGES.constraintPairings, "ScdlConstraintPairing", m.constraintPairings, (c) => ({
    from: [ref(PACKAGES.constraints, need(known.constraint, c.constraint, "制約条件"))],
    to: [targetRef(c.target)],
  }));

  // 配置: 標準の satisfy
  line(1, "");
  line(1, `package ${PACKAGES.allocations} {`);
  for (const [pkg, items] of [
    [PACKAGES.requirements, m.requirements],
    [PACKAGES.constraints, m.constraints],
  ] as const)
    for (const r of items) {
      if (r.allocation === undefined) continue;
      line(2, `satisfy ${ref(pkg, r.id)} by ${elementPath(r.allocation)};`);
    }
  line(1, "}");
  line(0, "}");
  return out.join("\n") + "\n";
}
