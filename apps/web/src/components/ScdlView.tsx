import { useMemo } from "react";
import { layoutScdl } from "../lib/scdl-layout.js";
import { exportFile, useStore } from "../store.js";
import { fit } from "../ui.js";

/** ASAM SCDL ビュー。エレメント(破線の入れ子)に要求(実線)を配置し、インタラクション・要求グループ・ペアリング・制約条件を示す。 */
export function ScdlView() {
  const a = useStore((s) => s.analysis);
  const d = useMemo(() => (a ? layoutScdl(a.scdl) : undefined), [a]);
  if (!a || !d) return <div className="empty">SCDL ビューを表示できません</div>;
  if (a.scdl.requirements.length === 0) return <div className="empty">要求(意図機能・安全機構・安全要求)が無いため、SCDL ビューを描けません。「安全コンセプト」で追加してください。</div>;
  const issues = a.issues.filter((i) => i.source === "scdl");
  return (
    <div className="stack" style={{ minHeight: 0 }}>
      <div className="row">
        <button className="btn small" onClick={() => void exportFile("scdl.sysml")}>SysML v2 として出力</button>
        <div className="legend" aria-label="凡例">
          <span>┈ 破線の箱 = エレメント(右上の ASIL=重み付け)</span><span>▭ 実線の箱 = 要求</span><span>◯ = 要求グループ</span><span>⇠⇢ 破線の矢印 = ペアリング</span><span>◆— 制約条件</span><span>→ インタラクション</span>
        </div>
      </div>
      <div className="diagram" role="region" style={{ minHeight: 200 }} tabIndex={0} aria-label="SCDL ビュー">
        <svg viewBox={`0 0 ${d.width} ${d.height}`} style={{ width: Math.min(d.width, 920), height: "auto", display: "block" }} role="group" aria-label="SCDL ビュー">
          <defs>
            <marker id="sc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text)" /></marker>
            <marker id="sc-pair" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--accent)" /></marker>
            <marker id="sc-dia" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8"><path d="M5 0L10 5L5 10L0 5z" fill="var(--text)" /></marker>
          </defs>
          {d.elements.filter((e) => e.id !== "unallocated").map((e) => {
            const w = a.scdl.elements.find((x) => x.id === e.id)?.weight;
            return (
              <g key={e.id} role="group" aria-label={`エレメント ${e.label}${w ? ` ASIL ${w}` : ""}`}>
                <rect className="scdl-el" x={e.x} y={e.y} width={e.w} height={e.h} rx={4} />
                <text x={e.x + 8} y={e.y + 17} fontSize={12} fontWeight={700}>{fit(e.label, Math.floor((e.w - 70) / 6.6))}</text>
                {w && <><rect className="scdl-weight" x={e.x + e.w - 58} y={e.y} width={58} height={18} /><text x={e.x + e.w - 54} y={e.y + 13} fontSize={11}>{w}</text></>}
              </g>
            );
          })}
          {d.elements.filter((e) => e.id === "unallocated").map((e) => <g key="u"><rect className="scdl-el" x={e.x} y={e.y} width={e.w} height={e.h} /><text x={e.x + 8} y={e.y + 17} fontSize={12}>{e.label}</text></g>)}
          {d.requirements.map((r) => (
            <g key={r.id} role="img" aria-label={`要求 ${r.label}${r.weight ? ` ASIL ${r.weight}` : ""}${r.allocated ? "" : "(未配置)"}`}>
              <rect className="scdl-req" x={r.x} y={r.y} width={r.w} height={r.h} />
              {!r.allocated && <line x1={r.x} x2={r.x + r.w} y1={r.y + r.h + 3} y2={r.y + r.h + 3} stroke="var(--text)" strokeWidth={2} />}
              <title>{r.label}</title>
              <text x={r.x + 8} y={r.y + 20} fontSize={12} fontWeight={700}>{r.label.split(" ")[0]}</text>
              {r.label.includes(" ") && <text className="svg-muted" x={r.x + 8} y={r.y + 38} fontSize={11}>{fit(r.label.slice(r.label.indexOf(" ") + 1), Math.floor((r.w - 16) / 6.2))}</text>}
              {r.weight && <><rect className="scdl-weight" x={r.x + r.w - 52} y={r.y} width={52} height={17} /><text x={r.x + r.w - 48} y={r.y + 12.5} fontSize={11}>{r.weight}</text></>}
            </g>
          ))}
          {d.arrows.map((ar) => (
            <g key={ar.id}>
              <polyline className="scdl-line" points={ar.points.map((p) => p.join(",")).join(" ")} markerEnd="url(#sc-arrow)" strokeWidth={ar.kind === "interaction" ? 1.6 : 6} />
              {ar.branch && <circle cx={ar.branch[0]} cy={ar.branch[1]} r={4} fill="var(--text)" />}
              {ar.label && <text className="svg-muted" x={(ar.points[0]![0] + ar.points[1]![0]) / 2} y={(ar.points[0]![1] + ar.points[1]![1]) / 2 - 6} fontSize={11} textAnchor="middle">{ar.label}</text>}
            </g>
          ))}
          {d.groups.map((g) => (
            <g key={g.id} role="img" aria-label={`要求グループ ${g.label}`}>
              {g.links.map((l, i) => <polyline key={i} points={l.map((p) => p.join(",")).join(" ")} stroke="var(--muted)" strokeWidth={1} fill="none" />)}
              <ellipse cx={g.cx} cy={g.cy} rx={g.rx} ry={g.ry} fill="var(--panel)" stroke="var(--text)" strokeWidth={1.5} strokeDasharray="5 3" />
              <title>{g.label}</title><text x={g.cx} y={g.cy - 2} fontSize={11} textAnchor="middle">{fit(g.label, Math.floor((g.rx * 2 - 16) / 6.2))}</text>
              {g.role && <text className="svg-muted" x={g.cx} y={g.cy + 13} fontSize={10} textAnchor="middle">{g.role === "intendedFunction" ? "意図機能" : "安全機構"}</text>}
            </g>
          ))}
          {d.pairings.map((p) => <g key={p.id}><line className="scdl-dash" x1={p.from[0]} y1={p.from[1]} x2={p.to[0]} y2={p.to[1]} markerStart="url(#sc-pair)" markerEnd="url(#sc-pair)" /><text className="svg-muted" x={(p.from[0] + p.to[0]) / 2} y={p.from[1] - 8} fontSize={11} textAnchor="middle">{p.label}</text></g>)}
          {d.constraintLinks.map((l) => <polyline key={l.id} points={l.points.map((p) => p.join(",")).join(" ")} stroke="var(--text)" strokeWidth={1.5} fill="none" markerStart="url(#sc-dia)" markerEnd="url(#sc-dia)" />)}
          {d.constraints.map((c) => (
            <g key={c.id} role="img" aria-label={`制約条件 ${c.label}`}>
              <rect className="scdl-req" x={c.x} y={c.y} width={c.w} height={c.h} />
              <title>{c.label}</title><text x={c.x + 8} y={c.y + 20} fontSize={12} fontWeight={700}>{fit(c.label, Math.floor((c.w - 66) / 6.6))}</text>
              {c.lines[0] && <text className="svg-muted" x={c.x + 8} y={c.y + 38} fontSize={10}>{fit(c.lines[0], Math.floor((c.w - 16) / 5.6))}</text>}
              {c.weight && <><rect className="scdl-weight" x={c.x + c.w - 52} y={c.y} width={52} height={17} /><text x={c.x + c.w - 48} y={c.y + 12.5} fontSize={11}>{c.weight}</text></>}
            </g>
          ))}
        </svg>
      </div>
      {issues.length === 0 ? <span className="badge ok">✓ SCDL の検証でエラー・警告はありません</span> : issues.map((i, k) => <div key={k} className={`badge ${i.severity === "error" ? "err" : "warn"}`}>{i.severity === "error" ? "✕" : "▲"} {i.message}{i.ref ? `(${i.ref})` : ""}</div>)}
    </div>
  );
}
