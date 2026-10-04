import type { ProjectAnalysis } from "@fusamod/analysis";
import { levelLabel } from "@fusamod/analysis";
import type { NestedNode } from "./layout.js";

export type DiagramLevel = "all" | "system" | "subsystem" | "component" | "detail";
export const GROUP_PREFIX = "group:";

export interface TreeOptions {
  /** all 以外なら、その階層の要素だけを並べる(親ごとの枠で囲む) */
  level?: DiagramLevel;
  /** 指定すると、この要素を根として、その内部だけを描く */
  focusId?: string;
}

/**
 * 構造ネットを、図の入れ子の木にする(各要素に、担当する機能名と重み付けを表示する)。
 *  - 既定: 入れ子の全体。
 *  - focusId: その要素を根とする(内部ブロック図のように、1 つのブロックの内部を見る)。
 *  - level: その階層の要素だけを並べ、親ごとの枠(点線の文脈枠)で囲む。各要素には内部の要素数を示す。
 */
export function structureTree(a: ProjectAnalysis, opts: TreeOptions = {}): NestedNode[] {
  const kids = new Map<string | undefined, string[]>();
  for (const e of a.net.elements) kids.set(e.parentId, [...(kids.get(e.parentId) ?? []), e.id]);
  const byId = new Map(a.net.elements.map((e) => [e.id, e]));
  const weightOf = (id: string) => a.scdl.elements.find((e) => e.id === a.scdlElementIds[id])?.weight;
  const label = (id: string) => {
    const e = byId.get(id)!;
    const w = weightOf(id);
    return `${e.name}  〔${levelLabel(a.levelOf[id] ?? "system")}${w ? ` / ASIL ${w}` : ""}〕`;
  };
  const fns = (id: string) => a.net.functions.filter((f) => f.ownerId === id);
  const fnLines = (id: string) => fns(id).map((f) => `ƒ ${f.name}`);
  const fnIds = (id: string) => fns(id).map((f) => f.id);
  const build = (id: string): NestedNode => ({ id, label: label(id), lines: fnLines(id), lineIds: fnIds(id), children: (kids.get(id) ?? []).map(build) });

  const focus = opts.focusId && byId.has(opts.focusId) ? opts.focusId : undefined;
  const level = opts.level ?? "all";
  if (level === "all") return focus ? [build(focus)] : (kids.get(undefined) ?? []).map(build);

  // 階層指定: その階層の要素を、親ごとにまとめて並べる
  const inScope = (id: string) => {
    if (!focus) return true;
    for (let cur: string | undefined = id; cur; cur = byId.get(cur)?.parentId) if (cur === focus) return true;
    return false;
  };
  const count = (id: string): number => (kids.get(id) ?? []).reduce((n, k) => n + 1 + count(k), 0);
  const leaf = (id: string): NestedNode => {
    const inner = count(id);
    return { id, label: label(id), lines: [...fnLines(id), ...(inner > 0 ? [`内部 ${inner} 要素`] : [])], lineIds: fnIds(id), children: [] };
  };
  const at = a.net.elements.filter((e) => (a.levelOf[e.id] ?? "system") === level && inScope(e.id));
  const groups = new Map<string | undefined, string[]>();
  for (const e of at) groups.set(e.parentId, [...(groups.get(e.parentId) ?? []), e.id]);
  const out: NestedNode[] = [];
  for (const [parent, ids] of groups) {
    if (parent === undefined) out.push(...ids.map(leaf));
    else out.push({ id: `${GROUP_PREFIX}${parent}`, label: `${byId.get(parent)!.name}(上位)`, lines: [], children: ids.map(leaf) });
  }
  return out;
}

/** 図の階層指定の選択肢 */
export const LEVEL_CHOICES: { key: DiagramLevel; label: string }[] = [
  { key: "all", label: "全体(入れ子)" },
  { key: "system", label: "システム" },
  { key: "subsystem", label: "サブシステム" },
  { key: "component", label: "コンポーネント" },
  { key: "detail", label: "詳細" },
];
