import { useEffect, useMemo, useRef, useState } from "react";
import { clearHighlight, editBlockReason, getState, toast, moveBoxes, renameElementTo, resetLayout, select, setDiagramFocus, setDiagramLevel, useStore } from "../store.js";
import { ElementActions } from "./ElementActions.js";
import { fit } from "../ui.js";
import { layoutNested, type Box } from "../lib/layout.js";
import { GROUP_PREFIX, LEVEL_CHOICES, structureTree, type DiagramLevel } from "../lib/structure.js";

const DRAG_THRESHOLD = 4;

/** 自動配置に、手動調整のずれを足す(親を動かすと、中の子も一緒に動く)。 */
export function applyOffsets(boxes: Box[], offsets: Record<string, { dx: number; dy: number }>): Box[] {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const total = (b: Box): { dx: number; dy: number } => {
    let dx = 0;
    let dy = 0;
    for (let cur: Box | undefined = b; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      dx += offsets[cur.id]?.dx ?? 0;
      dy += offsets[cur.id]?.dy ?? 0;
    }
    return { dx, dy };
  };
  return boxes.map((b) => {
    const t = total(b);
    return { ...b, x: b.x + t.dx, y: b.y + t.dy };
  });
}

interface Drag {
  id: string;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
}

/** 構造ネットを、入れ子の箱で表す図。箱の枠の色は、そこに属する指摘の最も重いもの。箱はドラッグで動かせる。 */
export function StructureDiagram() {
  const a = useStore((s) => s.analysis);
  const sel = useStore((s) => s.selectedElementId);
  const level = useStore((s) => s.diagramLevel);
  const focus = useStore((s) => s.diagramFocus);
  const offsets = useStore((s) => s.layoutOffsets);
  const highlight = useStore((s) => s.highlight);
  const [manual, setManual] = useState<number | undefined>(undefined); // undefined = 幅に合わせる
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  /** 図の中で名前を直接書き換えている最中の要素・機能 */
  const [editing, setEditing] = useState<{ id: string; value: string; x: number; y: number; w: number } | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const base = useMemo(() => (a ? layoutNested(structureTree(a, { level, ...(focus && sel ? { focusId: sel } : {}) })) : undefined), [a, level, focus, sel]);
  const ready = base !== undefined;
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [ready]);

  const live = useMemo(() => {
    if (!base) return undefined;
    const o = drag && drag.moved ? { ...offsets, [drag.id]: { dx: (offsets[drag.id]?.dx ?? 0) + drag.dx, dy: (offsets[drag.id]?.dy ?? 0) + drag.dy } } : offsets;
    return applyOffsets(base.boxes, o);
  }, [base, offsets, drag]);
  if (!a || !base || !live) return <EmptyDiagram />;

  const minX = Math.min(0, ...live.map((b) => b.x));
  const minY = Math.min(0, ...live.map((b) => b.y));
  const vbW = Math.max(base.width, ...live.map((b) => b.x + b.w + 12)) - minX;
  const vbH = Math.max(base.height, ...live.map((b) => b.y + b.h + 12)) - minY;
  const fitZoom = width > 0 ? Math.max(0.45, Math.min(1, (width - 12) / vbW)) : 1;
  const zoom = manual ?? fitZoom;
  const moved = Object.keys(offsets).length > 0;
  const worst = (id: string) => {
    const ix = a.issues.filter((i) => i.elementId === id);
    return ix.some((i) => i.severity === "error") ? "err" : ix.length ? "warn" : "";
  };
  const hl = highlight ? new Set(highlight.ids) : undefined;
  const emph = highlight ? new Set(highlight.emphasis) : undefined;
  const isGroup = (id: string) => id.startsWith(GROUP_PREFIX);

  /** ダブルクリックで、その場で名前を書き換える。編集できない要素（型から展開されたもの等）は理由を出す。 */
  const startEdit = (id: string, current: string, x: number, y: number, w: number) => {
    if (isGroup(id)) return;
    const why = editBlockReason(getState(), id);
    if (why) {
      toast("info", why);
      return;
    }
    setEditing({ id, value: current, x, y, w });
  };
  const commitEdit = () => {
    if (!editing) return;
    const cur = editing;
    setEditing(undefined);
    const name = cur.value.trim();
    const old = a.net.elements.find((e) => e.id === cur.id)?.name ?? a.net.functions.find((f) => f.id === cur.id)?.name ?? "";
    if (name && name !== old) renameElementTo(cur.id, name, true);
  };
  const onDown = (e: React.PointerEvent, b: Box) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: b.id, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / zoom;
    const dy = (e.clientY - drag.startY) / zoom;
    const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD;
    setDrag({ ...drag, dx, dy, moved });
  };
  const onUp = () => {
    if (!drag) return;
    if (drag.moved) moveBoxes({ [drag.id]: { dx: drag.dx, dy: drag.dy } });
    else if (!isGroup(drag.id)) select(drag.id);
    setDrag(undefined);
  };
  const onKey = (e: React.KeyboardEvent, b: Box) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!isGroup(b.id)) select(b.id);
      return;
    }
    // Alt + 矢印: 10px ずつ動かす(キーボードだけでも配置を調整できる)
    const step = e.shiftKey ? 40 : 10;
    const d = e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] : e.key === "ArrowUp" ? [0, -step] : e.key === "ArrowDown" ? [0, step] : undefined;
    if (e.altKey && d) {
      e.preventDefault();
      moveBoxes({ [b.id]: { dx: d[0]!, dy: d[1]! } });
    }
  };

  return (
    <div className="stack" style={{ minHeight: 0, flex: 1 }}>
      <div className="row">
        <button className="btn small" onClick={() => setManual(Math.max(0.4, zoom - 0.1))} aria-label="縮小">－</button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button className="btn small" onClick={() => setManual(undefined)} aria-pressed={manual === undefined} title="図の幅をパネルに合わせます">幅に合わせる</button>
        <button className="btn small" onClick={() => setManual(Math.min(2, zoom + 0.1))} aria-label="拡大">＋</button>
        <label className="row" style={{ fontSize: 12 }}>
          <span className="muted">階層</span>
          <select aria-label="図の階層" value={level} onChange={(e) => setDiagramLevel(e.target.value as DiagramLevel)}>
            {LEVEL_CHOICES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="row" style={{ fontSize: 12 }} title="選択中の要素を根として、その内部だけを表示します">
          <input type="checkbox" checked={focus} disabled={!sel} onChange={(e) => setDiagramFocus(e.target.checked)} />選択要素の内部のみ
        </label>
        <button className="btn small" onClick={resetLayout} disabled={!moved} title="手動で動かした箱の位置を、自動配置に戻します">配置を戻す</button>
        <div className="legend" aria-label="凡例">
          <span>枠: 灰=指摘なし</span><span style={{ color: "var(--warn)" }}>橙=警告あり</span><span style={{ color: "var(--err)" }}>赤=エラーあり</span><span>ƒ=担当する機能</span><span>箱はドラッグで移動(Alt+矢印でも可)、ダブルクリック/F2 で名前を変更</span>
        </div>
      </div>
      <ElementActions />
      {highlight && (
        <div className="banner" role="status">
          ハイライト: {highlight.label}({highlight.ids.length} 要素{highlight.emphasis.length > 0 ? `、うち指摘あり ${highlight.emphasis.length}` : ""})
          <button className="btn small" style={{ marginLeft: 8 }} onClick={clearHighlight}>解除</button>
        </div>
      )}
      <div className="diagram" ref={box} role="region" tabIndex={0} aria-label="構造図(入れ子の箱)">
        <svg width={vbW * zoom} height={vbH * zoom} viewBox={`${minX} ${minY} ${vbW} ${vbH}`} role="group" aria-label="構造図" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(undefined)} style={{ touchAction: "none" }}>
          {[...live].sort((p, q) => p.depth - q.depth).map((b) => {
            const group = isGroup(b.id);
            const dim = hl !== undefined && !hl.has(b.id);
            const on = hl?.has(b.id) ?? false;
            return (
              <g key={b.id} role="button" tabIndex={0} data-box={b.id} aria-label={`${b.label}${worst(b.id) === "err" ? "、エラーあり" : worst(b.id) === "warn" ? "、警告あり" : ""}${on ? "、ハイライト中" : ""}`} aria-pressed={sel === b.id}
                 style={{ cursor: drag?.id === b.id && drag.moved ? "grabbing" : "grab", opacity: dim ? 0.35 : 1 }}
                 onPointerDown={(e) => onDown(e, b)} onKeyDown={(e) => { if (e.key === "F2") { e.preventDefault(); startEdit(b.id, a.net.elements.find((x) => x.id === b.id)?.name ?? "", b.x + 6, b.y + 4, b.w - 12); } else onKey(e, b); }}
                 onDoubleClick={(e) => { e.stopPropagation(); startEdit(b.id, a.net.elements.find((x) => x.id === b.id)?.name ?? "", b.x + 6, b.y + 4, b.w - 12); }}>
                <rect className={`box-el ${group ? "group" : worst(b.id)} ${sel === b.id ? "sel" : ""} ${on ? (emph?.has(b.id) ? "hl hl-strong" : "hl") : ""}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={8} />
                <title>{b.label}</title>
                <text x={b.x + 10} y={b.y + 18} fontSize={13} fontWeight={700}>{fit(b.label, Math.floor((b.w - 20) / 7))}</text>
                {b.lines.map((l, i) => {
                  const fnId = b.lineIds?.[i];
                  const fn = fnId ? a.net.functions.find((f) => f.id === fnId) : undefined;
                  return (
                    <text key={i} className="svg-muted" x={b.x + 12} y={b.y + 36 + i * 16} fontSize={12}
                      onDoubleClick={fn ? (e) => { e.stopPropagation(); startEdit(fn.id, fn.name, b.x + 6, b.y + 24 + i * 16, b.w - 12); } : undefined}>
                      {fit(l, Math.floor((b.w - 24) / 6.5))}{fn ? <title>ダブルクリックで機能名を変更</title> : null}
                    </text>
                  );
                })}
              </g>
            );
          })}
          {editing && (
            <foreignObject x={editing.x} y={editing.y} width={Math.max(120, editing.w)} height={26}>
              <input className="svg-input" ref={(el) => el?.focus()} aria-label="名前の変更（Enter で確定、Esc で取り消し）" value={editing.value}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })} onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitEdit(); else if (e.key === "Escape") setEditing(undefined); }}
                onBlur={commitEdit} onPointerDown={(e) => e.stopPropagation()} />
            </foreignObject>
          )}
        </svg>
      </div>
    </div>
  );
}

/** 解析できていないときの表示: 原因と、編集ボタン（押せない理由つき）。 */
function EmptyDiagram() {
  const err = useStore((s) => s.sysmlError);
  const diag = useStore((s) => s.diagnostics.find((d) => d.severity === "error")?.message);
  return (
    <div className="stack">
      <ElementActions />
      <div className="empty" role="status">
        図を表示できません。{err ? `原因: ${err}` : diag ? `モデルのエラー: ${diag}` : "モデルにエラーがあるか、解析できていません。"}
        <br />「テキスト」で内容を確認してください。Java 21 が無い環境では、同梱のデモ以外の新しいモデルは解析できません。
      </div>
    </div>
  );
}
