import { levelLabel } from "@fusamod/analysis";
import { openTab, select, setMainView, useStore, type TabKey } from "../store.js";
import { last } from "../ui.js";
import { ElementActions } from "./ElementActions.js";

export function Explorer() {
  const a = useStore((s) => s.analysis);
  const sel = useStore((s) => s.selectedElementId);
  const refs = useStore((s) => s.refs);
  const server = useStore((s) => s.server);
  const proposals = useStore((s) => s.proposals);

  if (!a)
    return (
      <nav className="panel" aria-label="エクスプローラ">
        <header><h2>エクスプローラ</h2></header>
        <div className="empty">{server ? "モデルにエラーがあります。テキストで修正してください。" : "プロジェクトを選んでください"}</div>
      </nav>
    );

  const kids = new Map<string | undefined, string[]>();
  for (const e of a.net.elements) kids.set(e.parentId, [...(kids.get(e.parentId) ?? []), e.id]);
  const el = (id: string) => a.net.elements.find((e) => e.id === id)!;
  const open = (id: string, tab?: TabKey) => {
    select(id);
    if (tab) openTab(tab);
  };
  const tree = (id: string): JSX.Element => (
    <li key={id}>
      <button aria-current={sel === id} onClick={() => { select(id); setMainView("diagram"); }}>
        <span aria-hidden="true">▣</span> {el(id).name} <span className="muted">{levelLabel(a.levelOf[id] ?? "system")}</span>
      </button>
      {(kids.get(id)?.length ?? 0) > 0 && <ul>{kids.get(id)!.map(tree)}</ul>}
    </li>
  );
  const fnKids = new Map<string | undefined, string[]>();
  for (const f of a.net.functions) fnKids.set(f.parentFunctionId, [...(fnKids.get(f.parentFunctionId) ?? []), f.id]);
  const fnTree = (id: string): JSX.Element => {
    const f = a.net.functions.find((x) => x.id === id)!;
    return (
      <li key={id}>
        <button onClick={() => open(f.ownerId, "fmea")} aria-label={`機能 ${f.name}(担当 ${el(f.ownerId).name})`}>
          <span aria-hidden="true">ƒ</span> {f.name} <span className="muted">{el(f.ownerId).name}</span>
        </button>
        {(fnKids.get(id)?.length ?? 0) > 0 && <ul>{fnKids.get(id)!.map(fnTree)}</ul>}
      </li>
    );
  };
  const fmeaEls = Object.keys(a.fmea);
  const pending = proposals.filter((p) => p.status === "pending").length;

  return (
    <nav className="panel" aria-label="エクスプローラ">
      <header>
        <h2>エクスプローラ</h2>
        <span className="muted">{server?.id}</span>
      </header>
      <div className="body tree">
        <details open>
          <summary>要件({a.trace.rows.length})</summary>
          <ul>
            {a.trace.rows.map((r) => (
              <li key={r.id}>
                <button onClick={() => { const c = a.trace.cells.find((x) => x.requirementId === r.id); if (c) select(c.elementId); openTab("trace"); }} title={r.text}>
                  <span aria-hidden="true">{r.kind === "sysml" ? "▤" : "⛨"}</span> {r.label}
                  {r.asil && <span className="muted">ASIL {r.originAsil && r.originAsil !== r.asil ? `${r.asil}(${r.originAsil})` : r.asil}</span>}
                </button>
              </li>
            ))}
          </ul>
        </details>
        <details open>
          <summary>構造({a.net.elements.length})</summary>
          <ElementActions compact />
          <ul>{(kids.get(undefined) ?? []).map(tree)}</ul>
        </details>
        <details>
          <summary>振る舞い({a.net.functions.length})</summary>
          <ul>{(fnKids.get(undefined) ?? []).map(fnTree)}</ul>
        </details>
        <details open>
          <summary>安全分析</summary>
          <ul>
            <li><button onClick={() => openTab("fmea")}>FMEA({fmeaEls.length} 要素)</button></li>
            <li><button onClick={() => openTab("net")}>エラーネット</button></li>
            <li><button onClick={() => openTab("fta")}>FTA({a.net.failures.length} 故障ノード)</button></li>
            <li><button onClick={() => openTab("hara")}>ハザード分析(HARA)</button></li>
            <li><button onClick={() => openTab("concept")}>安全コンセプト(ペア・分解)</button></li>
            <li><button onClick={() => openTab("scdl")}>SCDL ビュー</button></li>
            <li><button onClick={() => openTab("issues")}>問題({a.summary.errors + a.summary.warnings})</button></li>
          </ul>
        </details>
        <details>
          <summary>AI の提案{pending > 0 ? `(承認待ち ${pending})` : ""}</summary>
          <ul>
            {proposals.length === 0 && <li className="muted">なし</li>}
            {proposals.slice(-8).map((p) => (
              <li key={p.id}><span className="muted">{p.status === "pending" ? "● " : p.status === "applied" ? "✓ " : "✕ "}{p.title}</span></li>
            ))}
          </ul>
        </details>
        <details>
          <summary>参考文書({refs.length})</summary>
          <ul>{refs.map((r) => <li key={r.name}><button onClick={() => alert(`${r.name}\n\n${r.text}`)}>▢ {last(r.name)}</button></li>)}</ul>
        </details>
      </div>
    </nav>
  );
}
