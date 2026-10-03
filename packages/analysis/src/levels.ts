import { buildIndex, depthOf, type ElementId, type SafetyNet } from "@fusamod/safety-core";

export type LevelKey = "system" | "subsystem" | "component" | "detail";

export const LEVELS: readonly { key: LevelKey; label: string; en: string }[] = [
  { key: "system", label: "システム", en: "System" },
  { key: "subsystem", label: "サブシステム", en: "Sub-system" },
  { key: "component", label: "コンポーネント", en: "Component" },
  { key: "detail", label: "詳細", en: "Detail" },
];

/**
 * 階層レベルの命名規則: 構造ネットの入れ子の深さで決める(0=システム、1=サブシステム、2=コンポーネント、3 以上=詳細)。
 * 規則では不自然な要素だけ、levelOverrides で上書きできる。複数の最上位要素はそれぞれシステム。
 */
export function levelKeyForDepth(depth: number): LevelKey {
  return depth <= 0 ? "system" : depth === 1 ? "subsystem" : depth === 2 ? "component" : "detail";
}

export function computeLevels(
  net: SafetyNet,
  overrides: Record<ElementId, LevelKey> = {},
): Record<ElementId, LevelKey> {
  const idx = buildIndex(net);
  const out: Record<ElementId, LevelKey> = {};
  for (const e of net.elements) {
    const o = overrides[e.id];
    if (o) {
      out[e.id] = o;
      continue;
    }
    const d = depthOf(idx, e.id);
    out[e.id] = levelKeyForDepth(d ?? 0);
  }
  return out;
}

export function levelLabel(key: LevelKey): string {
  return LEVELS.find((l) => l.key === key)!.label;
}
