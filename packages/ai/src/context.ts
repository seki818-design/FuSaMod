import {
  VIEWPOINTS,
  LEVELS,
  levelLabel,
  statusLabel,
  type ProjectAnalysis,
  type SafetyData,
} from "@fusamod/analysis";

/** 構造の階層・要素数・パズルビューの状態を、人が読む文章にする。 */
export function analysisSummaryText(a: ProjectAnalysis, name: string): string {
  const kids = new Map<string | undefined, string[]>();
  for (const e of a.net.elements) kids.set(e.parentId, [...(kids.get(e.parentId) ?? []), e.id]);
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const e = a.net.elements.find((x) => x.id === id)!;
    const fns = a.net.functions.filter((f) => f.ownerId === id);
    lines.push(`${"  ".repeat(depth)}- ${e.name}(${levelLabel(a.levelOf[id] ?? "system")}): ${fns.map((f) => f.name).join("、") || "機能なし"}`);
    (kids.get(id) ?? []).forEach((c) => walk(c, depth + 1));
  };
  (kids.get(undefined) ?? []).forEach((r) => walk(r, 0));
  const puzzle = LEVELS.filter((l) => a.puzzle.levels.find((x) => x.key === l.key)!.elementIds.length > 0).map(
    (l) => `${l.label}: ${VIEWPOINTS.map((v) => `${v.label}=${statusLabel(a.puzzle.cells[l.key][v.key].status)}`).join(" / ")}`,
  );
  return [
    `「${name}」の要約`,
    "",
    `構造要素 ${a.summary.elements}、機能 ${a.summary.functions}、故障ノード ${a.summary.failures}、要求 ${a.summary.requirements}。エラー ${a.summary.errors} 件、警告 ${a.summary.warnings} 件。`,
    "",
    "■ 構造と機能",
    ...lines,
    "",
    "■ 整合の状態(パズルビュー)",
    ...puzzle.map((p) => `- ${p}`),
  ].join("\n");
}

/** LLM に渡すためのプロジェクトの要約(JSON)。サイズを抑えるため、必要な項目だけを入れて上限で打ち切る。 */
export function contextForLlm(a: ProjectAnalysis, s: SafetyData, maxChars: number): { text: string; truncated: boolean } {
  const obj = {
    elements: a.net.elements.map((e) => ({ id: e.id, name: e.name, parent: e.parentId, level: a.levelOf[e.id] })),
    functions: a.net.functions.map((f) => ({ id: f.id, name: f.name, owner: f.ownerId, parent: f.parentFunctionId, outputs: (a.derived.parameters[f.id] ?? []).filter((p) => p.direction !== "in").map((p) => p.name) })),
    failures: s.failures.map((f) => ({ id: f.id, description: f.description, functionId: f.functionId, severity: f.severity, basic: f.isBasicCause })),
    links: s.links.map((l) => ({ id: l.id, cause: l.causeId, effect: l.effectId, o: l.occurrence, d: l.detection })),
    hara: s.hara,
    intendedFunctions: s.intendedFunctions,
    mechanisms: s.mechanisms.map((m) => ({ id: m.id, name: m.name, elementId: m.elementId, ftti: m.ftti })),
    pairs: s.pairs,
    issues: a.issues.slice(0, 30).map((i) => ({ severity: i.severity, code: i.code, message: i.message, ref: i.ref })),
  };
  const text = JSON.stringify(obj);
  return text.length <= maxChars ? { text, truncated: false } : { text: text.slice(0, maxChars), truncated: true };
}
