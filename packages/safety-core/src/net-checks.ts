import type { Issue } from "./issues.js";
import { buildIndex, depthOf, ownerOfFailure, type NetIndex } from "./net-index.js";
import { isRating } from "./rating.js";
import type { FailureId, SafetyNet } from "./net-types.js";

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids) (seen.has(id) ? out : seen).add(id);
  return [...out];
}

/** 故障リンクの循環を検出する(循環があると重大度の継承が定義できない)。 */
function findFailureCycle(idx: NetIndex): FailureId | undefined {
  const state = new Map<FailureId, 1 | 2>();
  const visit = (id: FailureId): FailureId | undefined => {
    if (state.get(id) === 2) return undefined;
    if (state.get(id) === 1) return id;
    state.set(id, 1);
    for (const l of idx.effectsOf.get(id) ?? []) {
      const hit = visit(l.effectId);
      if (hit) return hit;
    }
    state.set(id, 2);
    return undefined;
  };
  for (const f of idx.net.failures) {
    const hit = visit(f.id);
    if (hit) return hit;
  }
  return undefined;
}

/** 3 ネットの構造的な整合性チェック。 */
export function validateNet(net: SafetyNet): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, message: string, ref?: string) =>
    issues.push({ code, severity: "error", message, ...(ref ? { ref } : {}) });
  const warn = (code: string, message: string, ref?: string) =>
    issues.push({ code, severity: "warning", message, ...(ref ? { ref } : {}) });

  for (const [label, ids] of [
    ["構造要素", net.elements.map((e) => e.id)],
    ["機能", net.functions.map((f) => f.id)],
    ["故障", net.failures.map((f) => f.id)],
    ["リンク", net.links.map((l) => l.id)],
  ] as const)
    for (const id of dupes([...ids])) err("DUP_ID", `${label} ID が重複しています: ${id}`, id);

  const idx = buildIndex(net);

  for (const e of net.elements) {
    if (e.parentId && !idx.element.has(e.parentId))
      err("UNKNOWN_REF", `親要素が存在しません: ${e.parentId}`, e.id);
    else if (depthOf(idx, e.id) === undefined) err("STRUCTURE_CYCLE", "構造に循環があります", e.id);
  }
  for (const f of net.functions) {
    if (!idx.element.has(f.ownerId)) err("UNKNOWN_REF", `担当要素が存在しません: ${f.ownerId}`, f.id);
    if (f.parentFunctionId) {
      const p = idx.fn.get(f.parentFunctionId);
      if (!p) err("UNKNOWN_REF", `上位機能が存在しません: ${f.parentFunctionId}`, f.id);
      else if (idx.element.get(f.ownerId)?.parentId !== p.ownerId)
        warn("FUNCTION_HIERARCHY", "上位機能の担当要素が、この機能の担当要素の親ではありません", f.id);
    }
  }
  for (const f of net.failures) {
    if (!idx.fn.has(f.functionId))
      err("UNKNOWN_REF", `機能が存在しません: ${f.functionId}`, f.id);
    if (f.severity !== undefined && !isRating(f.severity))
      err("RATING_RANGE", "重大度は 1〜10 の整数", f.id);
  }

  for (const l of net.links) {
    const c = idx.failure.get(l.causeId);
    const e = idx.failure.get(l.effectId);
    if (!c || !e) {
      err("UNKNOWN_REF", "リンクが存在しない故障を参照しています", l.id);
      continue;
    }
    const co = ownerOfFailure(idx, c.id);
    const eo = ownerOfFailure(idx, e.id);
    if (co && eo) {
      const sameElement = co === eo;
      const adjacent = idx.element.get(co)?.parentId === eo;
      if (!(adjacent || (sameElement && c.isBasicCause)))
        err(
          "LINK_LEVEL",
          "故障リンクは「直下の下位要素→上位要素」または「同一要素の根本原因→故障モード」のみ許可されます",
          l.id,
        );
    }
    for (const [k, v] of [
      ["発生度", l.occurrence],
      ["検出度", l.detection],
    ] as const)
      if (v !== undefined && !isRating(v)) err("RATING_RANGE", `${k}は 1〜10 の整数`, l.id);
    if (l.occurrence === undefined || l.detection === undefined)
      warn("MISSING_RATING", "発生度/検出度が未評価です", l.id);
  }

  const cyc = findFailureCycle(idx);
  if (cyc) err("FAILURE_CYCLE", "故障リンクに循環があります", cyc);

  for (const f of net.failures) {
    const owner = ownerOfFailure(idx, f.id);
    const isRoot = owner !== undefined && !idx.element.get(owner)?.parentId;
    const causes = idx.causesOf.get(f.id) ?? [];
    const effects = idx.effectsOf.get(f.id) ?? [];
    if (!f.isBasicCause && causes.length === 0)
      warn("NO_CAUSE", "故障原因が紐づいていません", f.id);
    if (!isRoot && effects.length === 0)
      warn("NO_EFFECT", "上位要素の故障(影響)に繋がっていません", f.id);
    if (isRoot && f.severity === undefined)
      warn("MISSING_SEVERITY", "最上位の故障影響に重大度が未評価です", f.id);
  }
  for (const f of net.functions)
    if (!net.failures.some((x) => x.functionId === f.id))
      warn("FUNCTION_WITHOUT_FAILURE", "この機能に故障モードが定義されていません", f.id);

  return issues;
}
