/** シーケンス図のレイアウト（純粋関数）。ライフライン（部品）を横に、メッセージを上から下（時間順）に並べる。 */
export interface SeqLifeline {
  id: string;
  label: string;
}
export interface SeqMessage {
  id: string;
  label: string;
  from: string;
  to: string;
}
export interface SeqHead extends SeqLifeline {
  x: number;
  y: number;
  w: number;
  h: number;
  /** ライフラインの中心線の x */
  cx: number;
  bottom: number;
}
export interface SeqArrow extends SeqMessage {
  y: number;
  x1: number;
  x2: number;
  self: boolean;
  /** 1 から始まる時間順の番号 */
  no: number;
}
export const Q = { colW: 190, headW: 140, headH: 36, top: 20, firstY: 90, rowH: 56, pad: 20 };

export function layoutSequence(lifelines: SeqLifeline[], messages: SeqMessage[]): { heads: SeqHead[]; arrows: SeqArrow[]; width: number; height: number } {
  const heads: SeqHead[] = lifelines.map((l, i) => {
    const cx = Q.pad + i * Q.colW + Q.colW / 2;
    return { ...l, cx, x: cx - Q.headW / 2, y: Q.top, w: Q.headW, h: Q.headH, bottom: 0 };
  });
  const cx = new Map(heads.map((h) => [h.id, h.cx]));
  const arrows: SeqArrow[] = messages
    .filter((m) => cx.has(m.from) && cx.has(m.to))
    .map((m, i) => ({ ...m, no: i + 1, y: Q.firstY + i * Q.rowH, x1: cx.get(m.from)!, x2: cx.get(m.to)!, self: m.from === m.to }));
  const bottom = Q.firstY + Math.max(1, arrows.length) * Q.rowH;
  for (const h of heads) h.bottom = bottom;
  return { heads, arrows, width: Q.pad * 2 + Math.max(1, heads.length) * Q.colW, height: bottom + Q.pad };
}
