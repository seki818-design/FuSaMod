import type {
  ElementId,
  FailureId,
  FailureLink,
  FailureNode,
  FunctionId,
  FunctionNode,
  SafetyNet,
  StructureElement,
} from "./net-types.js";

/** ネットへの高速な参照用インデックス。 */
export interface NetIndex {
  net: SafetyNet;
  element: Map<ElementId, StructureElement>;
  fn: Map<FunctionId, FunctionNode>;
  failure: Map<FailureId, FailureNode>;
  childrenOf: Map<ElementId, ElementId[]>;
  functionsOf: Map<ElementId, FunctionNode[]>;
  /** functionId → その機能の故障ノード(ネットでの出現順) */
  failuresOf: Map<FunctionId, FailureNode[]>;
  /** failureId → ネットでの出現順 */
  failureOrder: Map<FailureId, number>;
  /** failureId → 原因側リンク(この故障を引き起こすもの) */
  causesOf: Map<FailureId, FailureLink[]>;
  /** failureId → 影響側リンク(この故障が引き起こすもの) */
  effectsOf: Map<FailureId, FailureLink[]>;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export function buildIndex(net: SafetyNet): NetIndex {
  const element = new Map(net.elements.map((e) => [e.id, e]));
  const fn = new Map(net.functions.map((f) => [f.id, f]));
  const failure = new Map(net.failures.map((f) => [f.id, f]));
  const childrenOf = new Map<ElementId, ElementId[]>();
  for (const e of net.elements) if (e.parentId) push(childrenOf, e.parentId, e.id);
  const functionsOf = new Map<ElementId, FunctionNode[]>();
  for (const f of net.functions) push(functionsOf, f.ownerId, f);
  const failuresOf = new Map<FunctionId, FailureNode[]>();
  for (const f of net.failures) push(failuresOf, f.functionId, f);
  const failureOrder = new Map(net.failures.map((f, i) => [f.id, i]));
  const causesOf = new Map<FailureId, FailureLink[]>();
  const effectsOf = new Map<FailureId, FailureLink[]>();
  for (const l of net.links) {
    push(causesOf, l.effectId, l);
    push(effectsOf, l.causeId, l);
  }
  return { net, element, fn, failure, childrenOf, functionsOf, failuresOf, failureOrder, causesOf, effectsOf };
}

/** 故障ノードが属する構造要素(機能の担当要素)。 */
export function ownerOfFailure(idx: NetIndex, failureId: FailureId): ElementId | undefined {
  const f = idx.failure.get(failureId);
  return f ? idx.fn.get(f.functionId)?.ownerId : undefined;
}

/** ルートからの深さ(システム=0)。循環・未知の親では undefined。 */
export function depthOf(idx: NetIndex, elementId: ElementId): number | undefined {
  let depth = 0;
  const seen = new Set<ElementId>();
  let cur = idx.element.get(elementId);
  while (cur) {
    if (seen.has(cur.id)) return undefined;
    seen.add(cur.id);
    if (!cur.parentId) return depth;
    cur = idx.element.get(cur.parentId);
    depth++;
  }
  return undefined;
}
