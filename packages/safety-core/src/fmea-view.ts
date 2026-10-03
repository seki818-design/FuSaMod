import { buildIndex, ownerOfFailure, type NetIndex } from "./net-index.js";
import type { ApLookup, ActionPriority } from "./rating.js";
import { rpn } from "./rating.js";
import type { ElementId, FailureId, SafetyNet } from "./net-types.js";

/** 重大度の継承: 自身と、到達できる全ての上位影響の最大値。循環は無視して打ち切る。 */
export function effectiveSeverity(idx: NetIndex, failureId: FailureId): number | undefined {
  const seen = new Set<FailureId>();
  let max: number | undefined;
  const walk = (id: FailureId) => {
    if (seen.has(id)) return;
    seen.add(id);
    const s = idx.failure.get(id)?.severity;
    if (s !== undefined && (max === undefined || s > max)) max = s;
    for (const l of idx.effectsOf.get(id) ?? []) walk(l.effectId);
  };
  walk(failureId);
  return max;
}

export interface FmeaEffect {
  failureId: FailureId;
  description: string;
  elementId: ElementId;
}

export interface FmeaCause {
  linkId: string;
  failureId: FailureId;
  description: string;
  elementId: ElementId;
  occurrence?: number;
  detection?: number;
  rpn?: number;
  ap?: ActionPriority;
  preventionControl?: string;
  detectionControl?: string;
}

export interface FmeaRow {
  failureModeId: FailureId;
  functionId: string;
  functionName: string;
  failureMode: string;
  /** 上位要素から見た故障影響(上位 FMEA の故障モードと同一ノード) */
  effects: FmeaEffect[];
  severity?: number;
  /** 下位要素/根本原因から見た故障原因(下位 FMEA の故障モードと同一ノード) */
  causes: FmeaCause[];
}

export interface FmeaView {
  focusElementId: ElementId;
  rows: FmeaRow[];
}

/**
 * ネットから、ある構造要素を注目要素とした FMEA を導出する。
 * 手入力の表ではなくグラフの射影なので、上位/下位 FMEA とは常にノードを共有する。
 */
export function buildFmeaView(net: SafetyNet, focusElementId: ElementId, ap?: ApLookup): FmeaView {
  const idx = buildIndex(net);
  const rows: FmeaRow[] = [];
  for (const f of net.failures) {
    if (f.isBasicCause) continue;
    if (ownerOfFailure(idx, f.id) !== focusElementId) continue;
    const fn = idx.fn.get(f.functionId)!;
    const severity = effectiveSeverity(idx, f.id);
    rows.push({
      failureModeId: f.id,
      functionId: fn.id,
      functionName: fn.name,
      failureMode: f.description,
      effects: (idx.effectsOf.get(f.id) ?? []).map((l) => ({
        failureId: l.effectId,
        description: idx.failure.get(l.effectId)?.description ?? "",
        elementId: ownerOfFailure(idx, l.effectId) ?? "",
      })),
      ...(severity !== undefined ? { severity } : {}),
      causes: (idx.causesOf.get(f.id) ?? []).map((l) => {
        const cause: FmeaCause = {
          linkId: l.id,
          failureId: l.causeId,
          description: idx.failure.get(l.causeId)?.description ?? "",
          elementId: ownerOfFailure(idx, l.causeId) ?? "",
        };
        if (l.occurrence !== undefined) cause.occurrence = l.occurrence;
        if (l.detection !== undefined) cause.detection = l.detection;
        if (l.preventionControl) cause.preventionControl = l.preventionControl;
        if (l.detectionControl) cause.detectionControl = l.detectionControl;
        if (severity !== undefined && l.occurrence !== undefined && l.detection !== undefined) {
          cause.rpn = rpn(severity, l.occurrence, l.detection);
          if (ap) cause.ap = ap(severity, l.occurrence, l.detection);
        }
        return cause;
      }),
    });
  }
  return { focusElementId, rows };
}

export interface ImpactResult {
  /** 変更した故障が波及する上位側(故障影響)の故障ID と、その担当要素 */
  upstream: { failureId: FailureId; elementId: ElementId }[];
  /** 変更した故障の原因となる下位側 */
  downstream: { failureId: FailureId; elementId: ElementId }[];
  /** 再確認が必要な FMEA(注目要素)の集合 */
  affectedElements: ElementId[];
}

/** 故障ノードを変更したときに「要再確認」とすべき上下の FMEA を求める。 */
export function impactOfFailureChange(net: SafetyNet, failureId: FailureId): ImpactResult {
  const idx = buildIndex(net);
  const collect = (dir: "effectsOf" | "causesOf", pick: "effectId" | "causeId") => {
    const out: { failureId: FailureId; elementId: ElementId }[] = [];
    const seen = new Set<FailureId>([failureId]);
    const stack = [failureId];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const l of idx[dir].get(cur) ?? []) {
        const next = l[pick];
        if (seen.has(next)) continue;
        seen.add(next);
        out.push({ failureId: next, elementId: ownerOfFailure(idx, next) ?? "" });
        stack.push(next);
      }
    }
    return out;
  };
  const upstream = collect("effectsOf", "effectId");
  const downstream = collect("causesOf", "causeId");
  const own = ownerOfFailure(idx, failureId);
  const affected = new Set<ElementId>(
    [...upstream, ...downstream].map((x) => x.elementId).filter(Boolean),
  );
  if (own) affected.add(own);
  return { upstream, downstream, affectedElements: [...affected] };
}
