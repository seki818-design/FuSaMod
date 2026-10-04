import { useEffect, useMemo, useState } from "react";
import { addChild, addSuccession, removeSuccession, type ElementGraph } from "@fusamod/sysml-graph";
import { deleteElement, editBlockReason, editModelWith, getState, renameElementTo, toast, useStore } from "../store.js";
import { layoutActivity, type ActNode } from "../lib/activity-layout.js";
import { fit } from "../ui.js";

const last = (qn: string) => qn.slice(qn.lastIndexOf("::") + 2);

/** アクションを持つ要素（action def・part・action）。アクティビティ図は、その中のアクションと矢印を描く。 */
export function activityContainers(g: ElementGraph | null): { qn: string; label: string }[] {
  if (!g) return [];
  const withActions = new Set(g.elements.filter((e) => e.kind === "ActionUsage" && e.owner).map((e) => e.owner!));
  const defs = g.elements.filter((e) => e.kind === "ActionDefinition").map((e) => e.qualifiedName);
  const all = [...new Set([...withActions, ...defs])];
  return all
    .map((qn) => ({ qn, kind: g.elements.find((e) => e.qualifiedName === qn)?.kind }))
    .filter((c) => c.kind === "ActionDefinition" || c.kind === "PartUsage" || c.kind === "ActionUsage" || c.kind === "PartDefinition")
    .map((c) => ({ qn: c.qn, label: `${last(c.qn)}（${c.kind === "ActionDefinition" ? "action def" : c.kind === "PartDefinition" ? "part def" : c.kind === "ActionUsage" ? "action" : "part"}）` }));
}

interface ToolbarProps {
  why: string | undefined;
  actions: ActNode[];
  newName: string;
  setNewName: (v: string) => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  onAdd: () => void;
  onConnect: () => void;
  onDeleteEdge: () => void;
  onDeleteNode: () => void;
  canDeleteEdge: boolean;
  canDeleteNode: boolean;
}

function ActivityToolbar(p: ToolbarProps) {
  return (
    <div className="row" role="group" aria-label="アクティビティ図の編集">
      <input type="text" aria-label="追加するアクションの名前" placeholder="アクション名" value={p.newName} maxLength={100} onChange={(e) => p.setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") p.onAdd(); }} />
      <button className="btn small" disabled={!!p.why || !p.newName.trim()} title={p.why ?? "この要素の中にアクションを追加"} onClick={p.onAdd}>＋ アクション</button>
      <span className="muted">矢印:</span>
      <select aria-label="矢印の元" value={p.from} onChange={(e) => p.setFrom(e.target.value)}>
        <option value="start">開始</option>{p.actions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>
      <span aria-hidden="true">→</span>
      <select aria-label="矢印の先" value={p.to} onChange={(e) => p.setTo(e.target.value)}>
        {p.actions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}<option value="done">終了</option>
      </select>
      <button className="btn small" disabled={!!p.why} title={p.why ?? "矢印（first … then …）を追加"} onClick={p.onConnect}>つなぐ</button>
      <button className="btn small danger" disabled={!!p.why || !p.canDeleteEdge} title={p.why ?? (p.canDeleteEdge ? "選択中の矢印を削除" : "削除する矢印をクリックで選択")} onClick={p.onDeleteEdge}>矢印を削除</button>
      <button className="btn small danger" disabled={!!p.why || !p.canDeleteNode} title="選択中のアクションを削除（つながる矢印も消えます）" onClick={p.onDeleteNode}>アクションを削除</button>
    </div>
  );
}

/** アクティビティ図: アクションを箱、`first a then b;` を矢印で描く。名前の変更・アクションの追加・矢印のつなぎ直しができる。 */
export function ActivityView() {
  const graph = useStore((s) => s.graph);
  const sel = useStore((s) => s.selectedElementId);
  const containers = useMemo(() => activityContainers(graph), [graph]);
  const [pick, setPick] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [from, setFrom] = useState("start");
  const [to, setTo] = useState("done");
  const [selNode, setSelNode] = useState<string | undefined>(undefined);
  const [selEdge, setSelEdge] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<{ id: string; value: string; x: number; y: number } | undefined>(undefined);
  const container = containers.find((c) => c.qn === pick)?.qn ?? containers.find((c) => c.qn === sel)?.qn ?? containers[0]?.qn;
  const why = useStore((s) => editBlockReason(s, container));
  useEffect(() => {
    setSelNode(undefined);
    setSelEdge(undefined);
  }, [container]);

  const view = useMemo(() => {
    if (!graph || !container) return undefined;
    const actions = graph.elements.filter((e) => e.kind === "ActionUsage" && e.owner === container);
    const nodes: ActNode[] = [
      { id: "start", label: "開始", kind: "start" },
      ...actions.map((a) => ({ id: a.qualifiedName, label: a.name ?? last(a.qualifiedName), kind: "action" as const })),
      { id: "done", label: "終了", kind: "done" },
    ];
    const edges = (graph.successions ?? []).filter((s) => s.owner === container).map((s) => ({ from: s.source, to: s.target }));
    return { nodes, layout: layoutActivity(nodes, edges), edges };
  }, [graph, container]);

  if (!graph) return <div className="empty">アクティビティ図を表示できません（モデルにエラーがあるか、解析できていません）</div>;
  const actions = view?.nodes.filter((n) => n.kind === "action") ?? [];

  const add = () => {
    if (!container || !newName.trim()) return;
    if (editModelWith(container, (t, g) => addChild(t, g, container, "action", newName))) setNewName("");
  };
  const connect = () => {
    if (container) editModelWith(container, (t, g) => addSuccession(t, g, container, from, to));
  };
  const commitRename = () => {
    if (!editing) return;
    const cur = editing;
    setEditing(undefined);
    const old = graph.elements.find((e) => e.qualifiedName === cur.id)?.name ?? "";
    if (cur.value.trim() && cur.value.trim() !== old) renameElementTo(cur.id, cur.value.trim(), true);
  };
  const startRename = (id: string, label: string, x: number, y: number) => {
    const w = editBlockReason(getState(), id);
    if (w) toast("info", w);
    else setEditing({ id, value: label, x, y });
  };
  const edge = selEdge ? view?.edges.find((e) => `${e.from}>${e.to}` === selEdge) : undefined;

  return (
    <div className="stack" style={{ minHeight: 0, flex: 1 }}>
      <div className="row">
        <label className="row"><span className="muted">対象</span>
          <select aria-label="アクティビティ図の対象" value={container ?? ""} onChange={(e) => setPick(e.target.value)}>
            {containers.length === 0 && <option value="">（アクションを持つ要素がありません）</option>}
            {containers.map((c) => <option key={c.qn} value={c.qn}>{c.label}</option>)}
          </select>
        </label>
        <span className="muted">箱はクリックで選択、ダブルクリックで名前を変更。矢印はクリックで選択。</span>
      </div>
      {container && (
        <ActivityToolbar
          why={why} actions={actions} newName={newName} setNewName={setNewName} from={from} setFrom={setFrom} to={to} setTo={setTo}
          onAdd={add} onConnect={connect} canDeleteEdge={!!edge} canDeleteNode={!!selNode && selNode !== "start" && selNode !== "done"}
          onDeleteEdge={() => { if (edge && container && editModelWith(container, (t, g) => removeSuccession(t, g, container, edge.from, edge.to))) setSelEdge(undefined); }}
          onDeleteNode={() => { if (selNode && window.confirm("このアクションと、つながる矢印を削除しますか?") && deleteElement(selNode)) setSelNode(undefined); }}
        />
      )}
      {why && container && <div className="muted" role="note">編集できません: {why}</div>}
      {!view ? <div className="empty">図にするアクションがありません。「＋ アクション」で追加するか、テキストで <code>action</code> を書いてください。</div> : (
        <div className="diagram" role="region" tabIndex={0} aria-label="アクティビティ図">
          <svg width={view.layout.width} height={view.layout.height} role="group" aria-label="アクティビティ図">
            <defs><marker id="act-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text)" /></marker></defs>
            {view.layout.lines.map((l) => {
              const id = `${l.from}>${l.to}`;
              const pts = l.points.map((p) => p.join(",")).join(" ");
              return (
                <g key={id} role="button" tabIndex={0} aria-label={`矢印 ${l.from === "start" ? "開始" : last(l.from)} から ${l.to === "done" ? "終了" : last(l.to)}`} aria-pressed={selEdge === id} onClick={() => { setSelEdge(selEdge === id ? undefined : id); setSelNode(undefined); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelEdge(id); } }}>
                  <polyline points={pts} fill="none" stroke="transparent" strokeWidth={12} />
                  <polyline points={pts} fill="none" stroke={selEdge === id ? "var(--accent)" : "var(--text)"} strokeWidth={selEdge === id ? 3 : 1.5} strokeDasharray={l.back ? "5 3" : undefined} markerEnd="url(#act-arrow)" />
                </g>
              );
            })}
            {view.layout.boxes.map((b) => (
              <g key={b.id} role="button" tabIndex={0} data-act={b.id} aria-label={b.kind === "action" ? `アクション ${b.label}` : b.label} aria-pressed={selNode === b.id}
                onClick={() => { setSelNode(b.id); setSelEdge(undefined); }} onDoubleClick={() => { if (b.kind === "action") startRename(b.id, b.label, b.x, b.y + 6); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelNode(b.id); } else if (e.key === "F2" && b.kind === "action") startRename(b.id, b.label, b.x, b.y + 6); }}>
                {b.kind === "action" ? (
                  <>
                    <rect className={`box-el ${selNode === b.id ? "sel" : ""}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={14} />
                    <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 5} fontSize={13} textAnchor="middle">{fit(b.label, 20)}</text>
                  </>
                ) : (
                  <>
                    <circle className={`box-el ${selNode === b.id ? "sel" : ""}`} cx={b.x + b.w / 2} cy={b.y + b.h / 2} r={b.w / 2} style={{ fill: b.kind === "start" ? "var(--text)" : "var(--panel)" }} />
                    {b.kind === "done" && <circle cx={b.x + b.w / 2} cy={b.y + b.h / 2} r={b.w / 4} style={{ fill: "var(--text)" }} />}
                    <text className="svg-muted" x={b.x + b.w / 2} y={b.y + b.h + 14} fontSize={11} textAnchor="middle">{b.label}</text>
                  </>
                )}
              </g>
            ))}
            {editing && (
              <foreignObject x={editing.x} y={editing.y} width={150} height={28}>
                <input className="svg-input" ref={(el) => el?.focus()} aria-label="名前の変更（Enter で確定、Esc で取り消し）" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitRename(); else if (e.key === "Escape") setEditing(undefined); }} onBlur={commitRename} />
              </foreignObject>
            )}
          </svg>
        </div>
      )}
    </div>
  );
}
