import { useEffect, useMemo, useState } from "react";
import { addChild, addMessage, moveMessage, removeMessage, renameMessage, type ElementGraph } from "@fusamod/sysml-graph";
import { editBlockReason, editModelWith, useStore } from "../store.js";
import { layoutSequence, Q } from "../lib/sequence-layout.js";
import { fit } from "../ui.js";

const last = (qn: string) => qn.slice(qn.lastIndexOf("::") + 2);

/** シーケンス図の対象にできる要素: メッセージを持つ要素、または 2 つ以上の部品を持つ要素（そこにメッセージを足せる）。 */
export function sequenceContainers(g: ElementGraph | null): { qn: string; label: string }[] {
  if (!g) return [];
  const withMsg = new Set((g.messages ?? []).map((m) => m.owner).filter((x): x is string => !!x));
  const parts = new Map<string, number>();
  for (const e of g.elements) if (e.kind === "PartUsage" && e.owner) parts.set(e.owner, (parts.get(e.owner) ?? 0) + 1);
  const cand = new Set([...withMsg, ...[...parts].filter(([, n]) => n >= 2).map(([qn]) => qn)]);
  return [...cand].filter((qn) => g.elements.some((e) => e.qualifiedName === qn && (e.kind === "PartUsage" || e.kind === "PartDefinition"))).map((qn) => ({ qn, label: last(qn) }));
}

/** シーケンス図: 部品をライフライン、`message … from a to b;` を矢印（宣言順 = 時間順）で描く。 */
export function SequenceView() {
  const graph = useStore((s) => s.graph);
  const sel = useStore((s) => s.selectedElementId);
  const containers = useMemo(() => sequenceContainers(graph), [graph]);
  const [pick, setPick] = useState("");
  const container = containers.find((c) => c.qn === pick)?.qn ?? containers.find((c) => c.qn === sel)?.qn ?? containers[0]?.qn;
  const why = useStore((s) => editBlockReason(s, container));
  const [selMsg, setSelMsg] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [after, setAfter] = useState(false);
  const [partName, setPartName] = useState("");
  const [editing, setEditing] = useState<{ id: string; value: string; x: number; y: number } | undefined>(undefined);

  useEffect(() => setSelMsg(undefined), [container]);
  const data = useMemo(() => {
    if (!graph || !container) return undefined;
    const parts = graph.elements.filter((e) => e.kind === "PartUsage" && e.owner === container);
    const msgs = (graph.messages ?? []).filter((m) => m.owner === container).sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0));
    // メッセージの両端が、直下の部品の内部（入れ子）を指す場合は、直下の部品に丸める
    const lifeOf = (qn: string) => parts.find((p) => qn === p.qualifiedName || qn.startsWith(`${p.qualifiedName}::`))?.qualifiedName;
    const lifelines = parts.map((p) => ({ id: p.qualifiedName, label: p.name ?? last(p.qualifiedName) }));
    const messages = msgs.flatMap((m) => {
      const f = lifeOf(m.from);
      const t = lifeOf(m.to);
      return f && t ? [{ id: m.qualifiedName, label: `${m.name ?? "（無名）"}${m.payload ? `: ${m.payload}` : ""}`, from: f, to: t }] : [];
    });
    return { lifelines, messages, layout: layoutSequence(lifelines, messages) };
  }, [graph, container]);
  const lifelines = data?.lifelines ?? [];
  useEffect(() => {
    if (lifelines.length > 0) {
      setFrom((f) => (lifelines.some((l) => l.id === f) ? f : lifelines[0]!.id));
      setTo((t) => (lifelines.some((l) => l.id === t) ? t : (lifelines[1] ?? lifelines[0]!).id));
    }
  }, [lifelines.map((l) => l.id).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!graph) return <div className="empty">シーケンス図を表示できません（モデルにエラーがあるか、解析できていません）</div>;

  const addPart = () => {
    if (container && partName.trim() && editModelWith(container, (t, g) => addChild(t, g, container, "part", partName))) setPartName("");
  };
  const addMsg = () => {
    if (container && editModelWith(container, (t, g) => addMessage(t, g, container, name, from, to, after ? selMsg : undefined))) setName("");
  };
  const commitRename = () => {
    if (!editing) return;
    const cur = editing;
    setEditing(undefined);
    const old = graph.messages?.find((m) => m.qualifiedName === cur.id)?.name ?? "";
    if (cur.value.trim() && cur.value.trim() !== old) editModelWith(container, (t, g) => renameMessage(t, g, cur.id, cur.value.trim()));
  };

  return (
    <div className="stack" style={{ minHeight: 0, flex: 1 }}>
      <div className="row">
        <label className="row"><span className="muted">対象</span>
          <select aria-label="シーケンス図の対象" value={container ?? ""} onChange={(e) => setPick(e.target.value)}>
            {containers.length === 0 && <option value="">（部品を 2 つ以上持つ要素がありません）</option>}
            {containers.map((c) => <option key={c.qn} value={c.qn}>{c.label}</option>)}
          </select>
        </label>
        <span className="muted">メッセージはクリックで選択、ダブルクリックで名前を変更。上から下が時間順（テキストの宣言順）です。</span>
      </div>
      {container && (
        <>
          <div className="row" role="group" aria-label="ライフラインの編集">
            <input type="text" aria-label="追加するライフライン（部品）の名前" placeholder="部品名" value={partName} maxLength={100} onChange={(e) => setPartName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addPart(); }} />
            <button className="btn small" disabled={!!why || !partName.trim()} title={why ?? "この要素の中に部品（ライフライン）を追加"} onClick={addPart}>＋ ライフライン</button>
          </div>
          <div className="row" role="group" aria-label="メッセージの編集">
            <input type="text" aria-label="メッセージの名前" placeholder="メッセージ名（省略可）" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addMsg(); }} />
            <select aria-label="送り手" value={from} onChange={(e) => setFrom(e.target.value)}>{lifelines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
            <span aria-hidden="true">→</span>
            <select aria-label="受け手" value={to} onChange={(e) => setTo(e.target.value)}>{lifelines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
            <label className="row" style={{ fontSize: 12 }}><input type="checkbox" checked={after} disabled={!selMsg} onChange={(e) => setAfter(e.target.checked)} />選択中のメッセージの後に挿入</label>
            <button className="btn small" disabled={!!why || lifelines.length === 0} title={why ?? "メッセージを追加"} onClick={addMsg}>＋ メッセージ</button>
            <button className="btn small" disabled={!!why || !selMsg} title="1 つ前へ（時間を早める）" aria-label="選択中のメッセージを前へ" onClick={() => { if (selMsg) editModelWith(container, (t, g) => moveMessage(t, g, selMsg, -1)); }}>↑</button>
            <button className="btn small" disabled={!!why || !selMsg} title="1 つ後ろへ（時間を遅らせる）" aria-label="選択中のメッセージを後ろへ" onClick={() => { if (selMsg) editModelWith(container, (t, g) => moveMessage(t, g, selMsg, 1)); }}>↓</button>
            <button className="btn small danger" disabled={!!why || !selMsg} title={why ?? "選択中のメッセージを削除"} onClick={() => { if (selMsg && editModelWith(container, (t, g) => removeMessage(t, g, selMsg))) setSelMsg(undefined); }}>メッセージを削除</button>
          </div>
        </>
      )}
      {why && container && <div className="muted" role="note">編集できません: {why}</div>}
      {!data || data.lifelines.length === 0 ? <div className="empty">図にする部品がありません。「＋ ライフライン」で部品を追加してください。</div> : (
        <div className="diagram" role="region" tabIndex={0} aria-label="シーケンス図">
          <svg width={data.layout.width} height={data.layout.height} role="group" aria-label="シーケンス図">
            <defs><marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text)" /></marker></defs>
            {data.layout.heads.map((h) => (
              <g key={h.id} data-life={h.id}>
                <line x1={h.cx} y1={h.y + h.h} x2={h.cx} y2={h.bottom} stroke="var(--muted)" strokeDasharray="5 4" />
                <rect className="box-el" x={h.x} y={h.y} width={h.w} height={h.h} rx={6} />
                <text x={h.cx} y={h.y + h.h / 2 + 5} fontSize={13} fontWeight={700} textAnchor="middle">{fit(h.label, 16)}</text>
              </g>
            ))}
            {data.layout.arrows.map((a) => {
              const on = selMsg === a.id;
              const x1 = a.x1;
              const x2 = a.self ? a.x1 : a.x2;
              const mid = (x1 + x2) / 2;
              return (
                <g key={a.id} role="button" tabIndex={0} data-msg={a.id} aria-label={`メッセージ ${a.no}: ${a.label}`} aria-pressed={on}
                  onClick={() => setSelMsg(on ? undefined : a.id)} onDoubleClick={() => { const m = graph.messages?.find((x) => x.qualifiedName === a.id); if (m?.name && !why) setEditing({ id: a.id, value: m.name, x: Math.min(x1, x2) + 6, y: a.y - 30 }); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelMsg(on ? undefined : a.id); } }}>
                  <rect x={Math.min(x1, x2) - 4} y={a.y - 28} width={Math.abs(x2 - x1) + 8 + (a.self ? 150 : 0)} height={40} fill={on ? "var(--accent-bg)" : "transparent"} />
                  {a.self ? (
                    <polyline points={`${x1},${a.y - 8} ${x1 + 40},${a.y - 8} ${x1 + 40},${a.y + 8} ${x1 + 2},${a.y + 8}`} fill="none" stroke={on ? "var(--accent)" : "var(--text)"} strokeWidth={on ? 3 : 1.5} markerEnd="url(#seq-arrow)" />
                  ) : (
                    <line x1={x1} y1={a.y} x2={x2 + (x2 > x1 ? -2 : 2)} y2={a.y} stroke={on ? "var(--accent)" : "var(--text)"} strokeWidth={on ? 3 : 1.5} markerEnd="url(#seq-arrow)" />
                  )}
                  <text x={a.self ? x1 + 46 : mid} y={a.self ? a.y + 4 : a.y - 8} fontSize={12} textAnchor={a.self ? "start" : "middle"}>{a.no}. {fit(a.label, 28)}</text>
                </g>
              );
            })}
            {editing && (
              <foreignObject x={editing.x} y={editing.y} width={Math.max(150, Q.colW - 20)} height={28}>
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
