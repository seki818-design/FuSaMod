import { useMemo } from "react";
import { levelLabel } from "@fusamod/analysis";
import { layoutNet } from "../lib/net-layout.js";
import { openTab, select, useStore } from "../store.js";
import { fit } from "../ui.js";

/** エラーネット(下位の故障原因 → 注目要素の故障モード → 上位の故障影響)。ノードを選ぶと、その要素に注目を移す。 */
export function NetView() {
  const a = useStore((s) => s.analysis);
  const sel = useStore((s) => s.selectedElementId);
  const withFns = a ? a.net.elements.filter((e) => a.fmea[e.id]) : [];
  const focus = sel && a?.fmea[sel] ? sel : withFns[0]?.id;
  const drawing = useMemo(() => (a && focus && a.fmea[focus] ? layoutNet(a.fmea[focus].rows, focus) : undefined), [a, focus]);
  if (!a || !focus || !drawing) return <div className="empty">エラーネットを表示できません</div>;
  const nameOf = (id: string) => a.net.elements.find((e) => e.id === id)?.name ?? id;
  const byId = new Map(drawing.nodes.map((n) => [n.id, n]));
  const cols = { cause: "故障原因(FC:下位)", mode: `故障モード(FM:${nameOf(focus)})`, effect: "故障影響(FE:上位)" } as const;
  return (
    <div className="stack" style={{ minHeight: 0 }}>
      <div className="row">
        <label className="row"><span className="muted">注目要素</span>
          <select aria-label="エラーネットの注目要素" value={focus} onChange={(e) => select(e.target.value)}>
            {withFns.map((e) => <option key={e.id} value={e.id}>{e.name}({levelLabel(a.levelOf[e.id] ?? "system")})</option>)}
          </select>
        </label>
        <span className="muted">上位の FM は下位 FMEA の FE と同じノードです。ノードを選ぶと、その要素に移ります。</span>
        <button className="btn small" onClick={() => openTab("fmea")}>FMEA シートで編集</button>
      </div>
      <div className="diagram" role="region" style={{ minHeight: 160 }} tabIndex={0} aria-label="エラーネット">
        <svg width={drawing.width} height={drawing.height + 24} role="group" aria-label="エラーネット">
          <defs><marker id="arrow-net" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor" /></marker></defs>
          {(["cause", "mode", "effect"] as const).map((c) => <text key={c} className="svg-muted" x={c === "cause" ? 8 : c === "mode" ? 308 : 608} y={14} fontSize={12}>{cols[c]}</text>)}
          <g transform="translate(0,22)" style={{ color: "var(--muted)" }}>
            {drawing.edges.map((e, i) => {
              const f = byId.get(e.from)!, t = byId.get(e.to)!;
              return <path key={i} d={`M${f.x + f.w},${f.y + f.h / 2} C${f.x + f.w + 35},${f.y + f.h / 2} ${t.x - 35},${t.y + t.h / 2} ${t.x},${t.y + t.h / 2}`} fill="none" stroke="currentColor" strokeWidth={1.5} markerEnd="url(#arrow-net)" />;
            })}
            {drawing.nodes.map((n) => (
              <g key={n.id} role="button" tabIndex={0} aria-label={`${cols[n.column]}: ${n.label}(${nameOf(n.elementId)})`} onClick={() => select(n.elementId)} onKeyDown={(e) => { if (e.key === "Enter") select(n.elementId); }}>
                <rect className="box-el" x={n.x} y={n.y} width={n.w} height={n.h} rx={8} style={n.column === "mode" ? { stroke: "var(--accent)", strokeWidth: 2 } : undefined} />
                <text x={n.x + 8} y={n.y + 20} fontSize={12} style={{ fill: "var(--text)" }}><title>{n.label}</title>{fit(n.label, 32)}</text>
                <text className="svg-muted" x={n.x + 8} y={n.y + 38} fontSize={11}>{nameOf(n.elementId)} · {n.id}</text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}
