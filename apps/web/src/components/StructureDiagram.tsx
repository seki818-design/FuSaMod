import { useEffect, useMemo, useRef, useState } from "react";
import { select, useStore } from "../store.js";
import { fit } from "../ui.js";
import { layoutNested } from "../lib/layout.js";
import { structureTree } from "../lib/structure.js";

/** 構造ネットを、入れ子の箱で表す図。箱の枠の色は、そこに属する指摘の最も重いもの。 */
export function StructureDiagram() {
  const a = useStore((s) => s.analysis);
  const sel = useStore((s) => s.selectedElementId);
  const [manual, setManual] = useState<number | undefined>(undefined); // undefined = 幅に合わせる
  const [width, setWidth] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => (a ? layoutNested(structureTree(a)) : undefined), [a]);
  const ready = layout !== undefined;
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [ready]);
  const fitZoom = layout && width > 0 ? Math.max(0.45, Math.min(1, (width - 12) / layout.width)) : 1;
  const zoom = manual ?? fitZoom;
  if (!a || !layout) return <div className="empty">図を表示できません(モデルにエラーがあるか、プロジェクトが選ばれていません)</div>;
  const worst = (id: string) => {
    const ix = a.issues.filter((i) => i.elementId === id);
    return ix.some((i) => i.severity === "error") ? "err" : ix.length ? "warn" : "";
  };
  return (
    <div className="stack" style={{ minHeight: 0, flex: 1 }}>
      <div className="row">
        <button className="btn small" onClick={() => setManual(Math.max(0.4, zoom - 0.1))} aria-label="縮小">－</button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button className="btn small" onClick={() => setManual(undefined)} aria-pressed={manual === undefined} title="図の幅をパネルに合わせます">幅に合わせる</button>
        <button className="btn small" onClick={() => setManual(Math.min(2, zoom + 0.1))} aria-label="拡大">＋</button>
        <div className="legend" aria-label="凡例">
          <span>枠: 灰=指摘なし</span><span style={{ color: "var(--warn)" }}>橙=警告あり</span><span style={{ color: "var(--err)" }}>赤=エラーあり</span><span>ƒ=担当する機能</span>
        </div>
      </div>
      <div className="diagram" ref={box} role="region" tabIndex={0} aria-label="構造図(入れ子の箱)">
        <svg width={layout.width * zoom} height={layout.height * zoom} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label="構造図">
          {[...layout.boxes].sort((p, q) => p.depth - q.depth).map((b) => (
            <g key={b.id} role="button" tabIndex={0} aria-label={`${b.label}${worst(b.id) === "err" ? "、エラーあり" : worst(b.id) === "warn" ? "、警告あり" : ""}`} aria-pressed={sel === b.id}
               onClick={(e) => { e.stopPropagation(); select(b.id); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(b.id); } }}>
              <rect className={`box-el ${worst(b.id)} ${sel === b.id ? "sel" : ""}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={8} />
              <title>{b.label}</title>
              <text x={b.x + 10} y={b.y + 18} fontSize={13} fontWeight={700}>{fit(b.label, Math.floor((b.w - 20) / 7))}</text>
              {b.lines.map((l, i) => <text key={i} className="svg-muted" x={b.x + 12} y={b.y + 36 + i * 16} fontSize={12}>{fit(l, Math.floor((b.w - 24) / 6.5))}</text>)}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
