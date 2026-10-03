import type { ProjectAnalysis } from "@fusamod/analysis";
import { levelLabel } from "@fusamod/analysis";
import type { NestedNode } from "./layout.js";

/** 構造ネットを、図の入れ子の木にする(各要素に、担当する機能名と重み付けを表示する)。 */
export function structureTree(a: ProjectAnalysis): NestedNode[] {
  const kids = new Map<string | undefined, string[]>();
  for (const e of a.net.elements) kids.set(e.parentId, [...(kids.get(e.parentId) ?? []), e.id]);
  const weightOf = (id: string) => a.scdl.elements.find((e) => e.id === a.scdlElementIds[id])?.weight;
  const build = (id: string): NestedNode => {
    const e = a.net.elements.find((x) => x.id === id)!;
    const fns = a.net.functions.filter((f) => f.ownerId === id).map((f) => f.name);
    const w = weightOf(id);
    return {
      id,
      label: `${e.name}  〔${levelLabel(a.levelOf[id] ?? "system")}${w ? ` / ASIL ${w}` : ""}〕`,
      lines: fns.map((f) => `ƒ ${f}`),
      children: (kids.get(id) ?? []).map(build),
    };
  };
  return (kids.get(undefined) ?? []).map(build);
}
