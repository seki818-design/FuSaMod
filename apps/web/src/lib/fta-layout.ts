import type { FaultTree, FaultTreeNode } from "@fusamod/safety-core";

export interface FtaBox {
  id: string;
  node: FaultTreeNode;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface FtaDrawing {
  boxes: FtaBox[];
  edges: { from: string; to: string }[];
  width: number;
  height: number;
}

const W = 150;
const H = 54;
const GX = 24;
const GY = 56;

/** フォールトツリーの層状レイアウト(上が頂上事象)。共有されたノード(複数の親)は一度だけ描き、辺は全て引く。 */
export function layoutFaultTree(t: FaultTree): FtaDrawing {
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const setDepth = (id: string, d: number) => {
    if (visiting.has(id)) return; // 循環は無視する(検証でエラーになる)
    if ((depth.get(id) ?? -1) >= d) return;
    depth.set(id, d);
    visiting.add(id);
    for (const c of byId.get(id)?.inputs ?? []) if (byId.has(c)) setDepth(c, d + 1);
    visiting.delete(id);
  };
  if (byId.has(t.top)) setDepth(t.top, 0);
  const xs = new Map<string, number>();
  let leaf = 0;
  const seen = new Set<string>();
  const assign = (id: string): number => {
    if (xs.has(id)) return xs.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const kids = (byId.get(id)?.inputs ?? []).filter((c) => byId.has(c));
    if (kids.length === 0) {
      const x = leaf++ * (W + GX);
      xs.set(id, x);
      return x;
    }
    const cx = kids.map(assign);
    const x = (Math.min(...cx) + Math.max(...cx)) / 2;
    xs.set(id, x);
    return x;
  };
  if (byId.has(t.top)) assign(t.top);
  const boxes: FtaBox[] = [];
  for (const [id, d] of depth) {
    const node = byId.get(id)!;
    boxes.push({ id, node, x: (xs.get(id) ?? 0) + 12, y: d * (H + GY) + 12, w: W, h: H });
  }
  // 同じ深さで重なったものは右へずらす
  const rows = new Map<number, FtaBox[]>();
  for (const b of boxes) rows.set(b.y, [...(rows.get(b.y) ?? []), b]);
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) if (row[i]!.x < row[i - 1]!.x + W + GX) row[i]!.x = row[i - 1]!.x + W + GX;
  }
  const edges = t.nodes.flatMap((n) => (n.inputs ?? []).filter((c) => depth.has(n.id) && depth.has(c)).map((c) => ({ from: n.id, to: c })));
  return { boxes, edges, width: Math.max(0, ...boxes.map((b) => b.x + b.w)) + 12, height: Math.max(0, ...boxes.map((b) => b.y + b.h)) + 12 };
}
