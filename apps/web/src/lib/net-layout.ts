import type { FmeaRow } from "@fusamod/safety-core";

export interface NetNode {
  id: string;
  label: string;
  column: "effect" | "mode" | "cause";
  elementId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface NetDrawing {
  nodes: NetNode[];
  /** 原因 → 故障モード → 影響(エラーネットの向き) */
  edges: { from: string; to: string }[];
  width: number;
  height: number;
}

const W = 230;
const H = 50;
const GAP = 14;
const COLX = { cause: 8, mode: 8 + W + 70, effect: 8 + 2 * (W + 70) } as const;

/** 注目要素の FMEA 行から、エラーネット(下位の原因 → 注目要素の故障モード → 上位の影響)の図を作る。 */
export function layoutNet(rows: FmeaRow[], elementId: string): NetDrawing {
  const nodes = new Map<string, NetNode>();
  const edges: NetDrawing["edges"] = [];
  const cursor = { cause: 8, mode: 8, effect: 8 };
  const add = (id: string, label: string, column: NetNode["column"], el: string) => {
    if (nodes.has(id)) return nodes.get(id)!;
    const n: NetNode = { id, label, column, elementId: el, x: COLX[column], y: cursor[column], w: W, h: H };
    cursor[column] += H + GAP;
    nodes.set(id, n);
    return n;
  };
  for (const r of rows) {
    const fm = add(r.failureModeId, r.failureMode, "mode", elementId);
    for (const e of r.effects) {
      const en = add(e.failureId, e.description, "effect", e.elementId);
      edges.push({ from: fm.id, to: en.id });
    }
    for (const c of r.causes) {
      const cn = add(c.failureId, c.description, "cause", c.elementId);
      edges.push({ from: cn.id, to: fm.id });
    }
  }
  // 故障モードの行を、つながる原因・影響の中央に揃える(重ならない範囲で)
  const all = [...nodes.values()];
  return { nodes: all, edges, width: COLX.effect + W + 8, height: Math.max(cursor.cause, cursor.mode, cursor.effect) + 8 };
}
