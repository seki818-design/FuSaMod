import { levelLabel } from "@fusamod/analysis";
import { openTab, sendChat, setMainView, useStore } from "../store.js";
import { StructureDiagram } from "./StructureDiagram.js";
import { TextEditor } from "./TextEditor.js";
import { AsilBadge } from "../ui.js";

function SelectedPanel() {
  const a = useStore((s) => s.analysis);
  const id = useStore((s) => s.selectedElementId);
  if (!a || !id) return <aside aria-label="選択要素" className="muted" style={{ padding: 8 }}>要素を選択してください</aside>;
  const e = a.net.elements.find((x) => x.id === id);
  if (!e) return null;
  const fns = a.net.functions.filter((f) => f.ownerId === id);
  const reqs = a.trace.cells.filter((c) => c.elementId === id).map((c) => a.trace.rows.find((r) => r.id === c.requirementId)!);
  const w = a.scdl.elements.find((x) => x.id === a.scdlElementIds[id])?.weight;
  const issues = a.issues.filter((i) => i.elementId === id);
  return (
    <aside aria-label="選択要素" className="stack" style={{ padding: 8, minWidth: 170, maxWidth: 190, fontSize: 12.5, borderLeft: "1px solid var(--border)", overflow: "auto" }}>
      <div>
        <strong>{e.name}</strong>
        <div className="row"><span className="badge undet">{levelLabel(a.levelOf[id] ?? "system")}</span>{w && <AsilBadge asil={w} />}</div>
      </div>
      <dl className="kv">
        <dt>機能</dt><dd>{fns.map((f) => f.name).join("、") || "—"}</dd>
        <dt>要求</dt><dd>{reqs.map((r) => r.label).join("、") || "—"}</dd>
        <dt>指摘</dt><dd>{issues.length ? `${issues.filter((i) => i.severity === "error").length} エラー / ${issues.filter((i) => i.severity === "warning").length} 警告` : "なし"}</dd>
      </dl>
      <div className="stack">
        <strong className="muted">安全分析アクション</strong>
        <button className="btn small" onClick={() => openTab("fmea")}>FMEA を開く</button>
        <button className="btn small" onClick={() => openTab("net")}>エラーネットを見る</button>
        <button className="btn small" onClick={() => void sendChat(`${e.name} の FMEA を実施して`)}>AI で FMEA を提案</button>
        <button className="btn small" onClick={() => void sendChat(`${e.name} の影響分析`)}>変更の影響分析</button>
      </div>
    </aside>
  );
}

export function ViewSpace() {
  const view = useStore((s) => s.mainView);
  return (
    <section className="panel" aria-label="ビュースペース">
      <header>
        <h2>ビュースペース</h2>
        <div role="tablist" aria-label="表示の切り替え" className="row">
          <button role="tab" className="btn small" aria-selected={view === "diagram"} onClick={() => setMainView("diagram")} style={view === "diagram" ? { borderColor: "var(--accent)" } : {}}>図</button>
          <button role="tab" className="btn small" aria-selected={view === "text"} onClick={() => setMainView("text")} style={view === "text" ? { borderColor: "var(--accent)" } : {}}>テキスト</button>
        </div>
      </header>
      <div className="body" style={{ display: "flex", gap: 8, padding: 8 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>{view === "diagram" ? <StructureDiagram /> : <TextEditor />}</div>
        <SelectedPanel />
      </div>
    </section>
  );
}
