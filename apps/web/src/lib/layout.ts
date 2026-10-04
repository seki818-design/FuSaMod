/** 入れ子の箱のレイアウト(構造図・SCDL 図で共通)。純粋関数。 */
export interface NestedNode {
  id: string;
  label: string;
  /** 箱の中に表示する行(機能名など) */
  lines?: string[];
  /** lines の各行に対応する ID(機能の ID など。無い行は undefined) */
  lineIds?: (string | undefined)[];
  /** true なら、ラベルだけの葉として固定サイズで描く(要求など) */
  fixed?: { w: number; h: number };
  children: NestedNode[];
}

export interface Box {
  id: string;
  parentId?: string;
  label: string;
  lines: string[];
  lineIds?: (string | undefined)[];
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  leaf: boolean;
}

export const L = { leafW: 176, header: 26, line: 16, pad: 12, gap: 12, minLeafH: 52 };

interface Sized {
  node: NestedNode;
  w: number;
  h: number;
  kids: Sized[];
  cols: number;
  rows: Sized[][];
}

function size(n: NestedNode, maxCols: number): Sized {
  if (n.children.length === 0) {
    const w = n.fixed?.w ?? L.leafW;
    const h = n.fixed?.h ?? Math.max(L.minLeafH, L.header + (n.lines?.length ?? 0) * L.line + L.pad);
    return { node: n, w, h, kids: [], cols: 0, rows: [] };
  }
  const kids = n.children.map((c) => size(c, maxCols));
  const cols = Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(kids.length))));
  const rows: Sized[][] = [];
  for (let i = 0; i < kids.length; i += cols) rows.push(kids.slice(i, i + cols));
  const rowW = rows.map((r) => r.reduce((a, k) => a + k.w, 0) + (r.length - 1) * L.gap);
  const rowH = rows.map((r) => Math.max(...r.map((k) => k.h)));
  const own = (n.lines?.length ?? 0) * L.line;
  const w = Math.max(...rowW, L.leafW) + 2 * L.pad;
  const h = L.header + own + L.pad + rowH.reduce((a, b) => a + b, 0) + (rows.length - 1) * L.gap + L.pad;
  return { node: n, w, h, kids, cols, rows };
}

function place(s: Sized, x: number, y: number, depth: number, parentId: string | undefined, out: Box[]) {
  out.push({
    id: s.node.id,
    ...(parentId !== undefined ? { parentId } : {}),
    label: s.node.label,
    lines: s.node.lines ?? [],
    lineIds: s.node.lineIds ?? [],
    x, y, w: s.w, h: s.h, depth,
    leaf: s.kids.length === 0,
  });
  let cy = y + L.header + (s.node.lines?.length ?? 0) * L.line + L.pad;
  for (const row of s.rows) {
    const rowH = Math.max(...row.map((k) => k.h));
    const rowW = row.reduce((a, k) => a + k.w, 0) + (row.length - 1) * L.gap;
    let cx = x + (s.w - rowW) / 2;
    for (const k of row) {
      place(k, cx, cy, depth + 1, s.node.id, out);
      cx += k.w + L.gap;
    }
    cy += rowH + L.gap;
  }
}

/** 入れ子の木を、箱の座標に展開する。複数の根は縦に並べる。子は親の内側に収まり、兄弟どうしは重ならない。 */
export function layoutNested(roots: NestedNode[], opts: { maxCols?: number } = {}): { boxes: Box[]; width: number; height: number } {
  const maxCols = opts.maxCols ?? 3;
  const sized = roots.map((r) => size(r, maxCols));
  const boxes: Box[] = [];
  let y = L.pad;
  for (const s of sized) {
    place(s, L.pad, y, 0, undefined, boxes);
    y += s.h + L.gap;
  }
  return { boxes, width: Math.max(0, ...sized.map((s) => s.w)) + 2 * L.pad, height: y + L.pad - L.gap };
}

export const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
