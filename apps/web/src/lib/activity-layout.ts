/** アクティビティ図のレイアウト（純粋関数）。開始 → アクション → 終了を、左から右へ並べる。 */
export interface ActNode {
  id: string;
  label: string;
  kind: "start" | "done" | "action";
}
export interface ActEdge {
  from: string;
  to: string;
}
export interface ActBox extends ActNode {
  x: number;
  y: number;
  w: number;
  h: number;
  rank: number;
}
export interface ActLine {
  from: string;
  to: string;
  points: [number, number][];
  /** 戻る矢印（ループ）。下を回して描く */
  back: boolean;
}
export const A = { colW: 190, rowH: 70, actW: 150, actH: 40, dot: 28, padX: 24, padY: 24 };

/** 深さ優先で、循環を作る辺（戻る辺）を見つける。 */
function backEdges(nodes: ActNode[], edges: ActEdge[]): Set<string> {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const state = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const t of out.get(id) ?? []) {
      if (state.get(t) === 1) back.add(`${id}>${t}`);
      else if (!state.has(t)) visit(t);
    }
    state.set(id, 2);
  };
  for (const n of [...nodes].sort((a, b) => (a.kind === "start" ? -1 : b.kind === "start" ? 1 : 0))) if (!state.has(n.id)) visit(n.id);
  return back;
}

export function layoutActivity(nodes: ActNode[], edges: ActEdge[]): { boxes: ActBox[]; lines: ActLine[]; width: number; height: number } {
  const ids = new Set(nodes.map((n) => n.id));
  const es = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const back = backEdges(nodes, es);
  const fwd = es.filter((e) => !back.has(`${e.from}>${e.to}`));
  // 最長経路で段（rank）を決める。開始は 0、入ってくる矢印の無いアクションは 1
  const rank = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const e of fwd) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
  const rankOf = (id: string, seen = new Set<string>()): number => {
    const hit = rank.get(id);
    if (hit !== undefined) return hit;
    if (seen.has(id)) return 0;
    seen.add(id);
    const n = nodes.find((x) => x.id === id)!;
    const ins = incoming.get(id) ?? [];
    const r = n.kind === "start" ? 0 : ins.length === 0 ? 1 : Math.max(...ins.map((p) => rankOf(p, seen))) + 1;
    rank.set(id, r);
    return r;
  };
  for (const n of nodes) rankOf(n.id);
  const maxAction = Math.max(0, ...nodes.filter((n) => n.kind === "action").map((n) => rank.get(n.id) ?? 1));
  for (const n of nodes) if (n.kind === "done") rank.set(n.id, Math.max(maxAction + 1, ...(incoming.get(n.id) ?? []).map((p) => (rank.get(p) ?? 0) + 1)));
  const rows = new Map<number, number>();
  const boxes: ActBox[] = nodes.map((n) => {
    const r = rank.get(n.id) ?? 1;
    const row = rows.get(r) ?? 0;
    rows.set(r, row + 1);
    const dot = n.kind !== "action";
    const w = dot ? A.dot : A.actW;
    const h = dot ? A.dot : A.actH;
    return { ...n, rank: r, w, h, x: A.padX + r * A.colW + (A.actW - w) / 2, y: A.padY + row * A.rowH + (A.actH - h) / 2 };
  });
  const by = new Map(boxes.map((b) => [b.id, b]));
  const lines: ActLine[] = es.map((e) => {
    const f = by.get(e.from)!;
    const t = by.get(e.to)!;
    const isBack = back.has(`${e.from}>${e.to}`);
    if (isBack || t.rank <= f.rank) {
      const yy = Math.max(f.y + f.h, t.y + t.h) + 22;
      return { from: e.from, to: e.to, back: true, points: [[f.x + f.w / 2, f.y + f.h], [f.x + f.w / 2, yy], [t.x + t.w / 2, yy], [t.x + t.w / 2, t.y + t.h]] };
    }
    const sx = f.x + f.w;
    const sy = f.y + f.h / 2;
    const tx = t.x;
    const ty = t.y + t.h / 2;
    const mx = (sx + tx) / 2;
    return { from: e.from, to: e.to, back: false, points: sy === ty ? [[sx, sy], [tx, ty]] : [[sx, sy], [mx, sy], [mx, ty], [tx, ty]] };
  });
  const width = Math.max(0, ...boxes.map((b) => b.x + b.w)) + A.padX;
  const height = Math.max(0, ...boxes.map((b) => b.y + b.h), ...lines.flatMap((l) => l.points.map((p) => p[1]))) + A.padY;
  return { boxes, lines, width, height };
}
