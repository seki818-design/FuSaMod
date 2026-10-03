import type { Requirement, ScdlModel } from "@fusamod/scdl";
import { layoutNested, overlaps, type Box, type NestedNode } from "./layout.js";

export type Pt = [number, number];

export interface ScdlDrawing {
  width: number;
  height: number;
  elements: Box[];
  requirements: (Box & { weight?: string; allocated: boolean })[];
  /** インタラクション(要求→要求)と、システム境界を出入りする矢印 */
  arrows: { id: string; kind: "interaction" | "boundary-in" | "boundary-out"; points: Pt[]; label?: string; branch?: Pt }[];
  groups: { id: string; cx: number; cy: number; rx: number; ry: number; label: string; role?: string; links: Pt[][] }[];
  pairings: { id: string; from: Pt; to: Pt; label: string }[];
  constraints: (Box & { weight?: string })[];
  constraintLinks: { id: string; points: Pt[] }[];
}

const REQ = { w: 168, h: 52 };
const MARGIN = 150; // システム境界の外側の矢印用の余白

const center = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2];

/** 線分 a→b が箱 box の境界と交わる点(a は箱の内側にある想定)。 */
export function clipToBox(box: Box, from: Pt): Pt {
  const [cx, cy] = center(box);
  const dx = from[0] - cx;
  const dy = from[1] - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

/**
 * SCDL モデルを図(座標つきの図形)にする。ASAM SCDL の記法に沿い、エレメントは入れ子の破線の箱、
 * 要求はエレメントの内側の実線の箱、配置されていない要求は下の「未配置」欄(二重線で表す)に置く。
 * 要求グループ・ペアリング・制約条件は、図の下の帯に置く(要求の箱と重ならないようにするため)。
 */
export function layoutScdl(m: ScdlModel): ScdlDrawing {
  const boxReq = (r: Requirement): NestedNode => ({ id: `req:${r.id}`, label: r.id + (r.name ? ` ${r.name}` : ""), fixed: REQ, children: [] });
  const elementNode = (id: string): NestedNode => {
    const e = m.elements.find((x) => x.id === id)!;
    return {
      id: `el:${id}`,
      label: `${e.id}${e.name ? ` ${e.name}` : ""}`,
      children: [
        ...m.requirements.filter((r) => !r.isExternal && r.allocation === id).map(boxReq),
        ...m.elements.filter((x) => x.parent === id).map((x) => elementNode(x.id)),
      ],
    };
  };
  const roots: NestedNode[] = m.elements.filter((e) => e.parent === undefined).map((e) => elementNode(e.id));
  const unallocated = m.requirements.filter((r) => !r.isExternal && !r.isAllocated);
  if (unallocated.length) roots.push({ id: "area:unallocated", label: "未配置の要求", children: unallocated.map(boxReq) });

  const { boxes, width: bw, height: bh } = layoutNested(roots, { maxCols: 3 });
  const shift = MARGIN;
  boxes.forEach((b) => (b.x += shift));
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const reqBox = (id: string) => byId.get(`req:${id}`);
  const weightOf = new Map<string, string | undefined>([...m.requirements, ...m.constraints].map((r) => [r.id, r.weight]));
  const elements = boxes.filter((b) => b.id.startsWith("el:") || b.id.startsWith("area:")).map((b) => ({ ...b, id: b.id.replace(/^(el|area):/, "") }));
  const requirements = boxes
    .filter((b) => b.id.startsWith("req:"))
    .map((b) => {
      const id = b.id.slice(4);
      const r = m.requirements.find((x) => x.id === id)!;
      return { ...b, id, ...(weightOf.get(id) ? { weight: weightOf.get(id)! } : {}), allocated: r.isAllocated };
    });

  // 矢印
  const arrows: ScdlDrawing["arrows"] = [];
  const isExt = new Set(m.requirements.filter((r) => r.isExternal).map((r) => r.id));
  const extLabel = new Map(m.requirements.filter((r) => r.isExternal).map((r) => [r.id, r.name ?? r.id]));
  for (const i of m.interactions) {
    const src = reqBox(i.source);
    if (isExt.has(i.source)) {
      for (const t of i.targets) {
        const tb = reqBox(t);
        if (!tb) continue;
        const c = center(tb);
        const start: Pt = [shift - MARGIN + 8, c[1]];
        arrows.push({ id: `${i.id}>${t}`, kind: "boundary-in", points: [start, clipToBox(tb, start)], label: i.name ?? extLabel.get(i.source) ?? i.source });
      }
      continue;
    }
    if (!src) continue;
    const sc = center(src);
    const internal = i.targets.filter((t) => reqBox(t));
    const branch: Pt | undefined = internal.length + i.targets.filter((t) => isExt.has(t)).length > 1 ? clipToBox(src, [sc[0] + 1, sc[1]]) : undefined;
    for (const t of i.targets) {
      const tb = reqBox(t);
      if (tb) {
        const tc = center(tb);
        arrows.push({ id: `${i.id}>${t}`, kind: "interaction", points: [clipToBox(src, tc), clipToBox(tb, sc)], ...(i.name ? { label: i.name } : {}), ...(branch ? { branch: clipToBox(src, tc) } : {}) });
      } else if (isExt.has(t)) {
        const end: Pt = [shift + bw + MARGIN - 8 - 2 * 12, sc[1]];
        arrows.push({ id: `${i.id}>${t}`, kind: "boundary-out", points: [clipToBox(src, end), end], label: i.name ?? extLabel.get(t) ?? t });
      }
    }
  }

  // 要求グループ・ペアリング・制約条件: 図の下の帯
  const stripY = bh + 40;
  const gw = 150;
  const groupIds = m.groups.map((g) => g.id);
  const spacing = Math.max(gw + 40, (bw + 2 * MARGIN - 2 * 20) / Math.max(1, groupIds.length));
  const pos = new Map<string, Pt>();
  groupIds.forEach((id, i) => pos.set(id, [20 + spacing * i + spacing / 2, stripY + 30]));
  const groups: ScdlDrawing["groups"] = m.groups.map((g) => {
    const [cx, cy] = pos.get(g.id)!;
    const links = g.requirements.map((r) => reqBox(r)).filter((b): b is Box => !!b).map((b): Pt[] => [[cx, cy - 26], clipToBox(b, [cx, cy - 26])]);
    return { id: g.id, cx, cy, rx: gw / 2, ry: 26, label: `${g.id}${g.name ? ` ${g.name}` : ""}`, ...(g.role ? { role: g.role } : {}), links };
  });
  const pairings = m.groupPairings.map((p) => {
    const a = pos.get(p.set[0]);
    const b = pos.get(p.set[1]);
    return { id: p.id, from: (a ? [a[0] + gw / 2, a[1]] : [0, 0]) as Pt, to: (b ? [b[0] - gw / 2, b[1]] : [0, 0]) as Pt, label: p.id, a, b };
  });
  const pairingMid = new Map(pairings.map((p) => [p.id, [(p.from[0] + p.to[0]) / 2, (p.from[1] + p.to[1]) / 2 + 0] as Pt]));
  const constraints: ScdlDrawing["constraints"] = [];
  const constraintLinks: ScdlDrawing["constraintLinks"] = [];
  const cy0 = stripY + 110;
  m.constraints.forEach((c, i) => {
    const cp = m.constraintPairings.find((x) => x.constraint === c.id && x.target.kind === "group-pairing");
    const mid = cp ? pairingMid.get(cp.target.id) : undefined;
    const x = mid ? mid[0] - REQ.w / 2 : 20 + i * (REQ.w + 20);
    const box: Box = { id: c.id, label: `${c.id}${c.name ? ` ${c.name}` : ""}`, lines: c.text ? [c.text.slice(0, 22) + (c.text.length > 22 ? "…" : "")] : [], x, y: cy0, w: REQ.w, h: REQ.h, depth: 0, leaf: true };
    constraints.push({ ...box, ...(c.weight ? { weight: c.weight } : {}) });
    if (mid) constraintLinks.push({ id: `${c.id}~${cp!.target.id}`, points: [[box.x + box.w / 2, box.y], mid] });
  });
  // 重ならない: 同じ帯の制約条件が重なったら右へずらす
  constraints.sort((a, b) => a.x - b.x);
  for (let i = 1; i < constraints.length; i++) {
    const prev = constraints[i - 1]!;
    if (overlaps(prev, constraints[i]!)) constraints[i]!.x = prev.x + prev.w + 16;
  }
  const width = Math.max(shift + bw + MARGIN, 20 + spacing * Math.max(1, groupIds.length) + 20, ...constraints.map((c) => c.x + c.w + 20));
  const height = Math.max(bh, constraints.length ? cy0 + REQ.h + 20 : stripY + 70);
  return { width, height, elements, requirements, arrows, groups, pairings: pairings.map(({ id, from, to, label }) => ({ id, from, to, label })), constraints, constraintLinks };
}
