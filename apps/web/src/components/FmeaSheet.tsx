import { useState } from "react";
import { levelLabel } from "@fusamod/analysis";
import type { FmeaCause, FmeaRow } from "@fusamod/safety-core";
import { exportFile, openTab, select, updateSafety, useStore } from "../store.js";
import { nextId } from "../ui.js";

const rating = (v: string): number | undefined => (v === "" ? undefined : Math.min(10, Math.max(1, Math.round(Number(v)))));

/** AIAG-VDA の FMEA シート。ネットの射影なので、上位の故障影響と下位の故障原因は、他の要素の FMEA と同じノードで繋がる。 */
export function FmeaSheet() {
  const a = useStore((s) => s.analysis);
  const safety = useStore((s) => s.draftSafety);
  const sel = useStore((s) => s.selectedElementId);
  const [adding, setAdding] = useState(false);
  const [addCauseFor, setAddCauseFor] = useState<string | undefined>();
  if (!a || !safety) return <div className="empty">FMEA を表示できません</div>;

  const withFns = a.net.elements.filter((e) => a.net.functions.some((f) => f.ownerId === e.id));
  const focus = sel && withFns.some((e) => e.id === sel) ? sel : withFns[0]?.id;
  if (!focus) return <div className="empty">機能を持つ構造要素がありません。モデルに action と perform を追加してください。</div>;
  const view = a.fmea[focus];
  const fns = a.net.functions.filter((f) => f.ownerId === focus);
  const nameOf = (id: string) => a.net.elements.find((e) => e.id === id)?.name ?? id;
  const failureOf = (id: string) => safety.failures.find((f) => f.id === id);

  const setLink = (linkId: string, patch: Record<string, number | string | undefined>) =>
    updateSafety((d) => {
      const l = d.links.find((x) => x.id === linkId) as unknown as Record<string, unknown> | undefined;
      if (!l) return;
      for (const [k, v] of Object.entries(patch)) if (v === undefined || v === "") delete l[k]; else l[k] = v;
    });
  const removeCause = (linkId: string) => {
    const l = safety.links.find((x) => x.id === linkId);
    if (!l) return;
    const f = failureOf(l.causeId);
    const orphan = f?.isBasicCause && safety.links.filter((x) => x.causeId === l.causeId).length === 1;
    if (!window.confirm(`この故障原因のリンクを削除します${orphan ? `(根本原因「${f!.description}」も削除されます)` : ""}。よろしいですか?`)) return;
    updateSafety((d) => {
      d.links = d.links.filter((x) => x.id !== linkId);
      if (orphan) d.failures = d.failures.filter((x) => x.id !== l.causeId);
    });
  };

  return (
    <div className="stack" style={{ minHeight: 0 }}>
      <div className="row">
        <label className="row"><span className="muted">注目要素</span>
          <select aria-label="FMEA の注目要素" value={focus} onChange={(e) => select(e.target.value)}>
            {withFns.map((e) => <option key={e.id} value={e.id}>{e.name}({levelLabel(a.levelOf[e.id] ?? "system")})</option>)}
          </select>
        </label>
        <button className="btn small" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>＋ 故障モードを追加</button>
        <button className="btn small" onClick={() => void exportFile("fmea.csv", `?element=${encodeURIComponent(focus)}`)}>この要素を CSV 出力</button>
        <button className="btn small" onClick={() => openTab("net")}>エラーネットで見る</button>
        {a.apStatus === "none" && <span className="muted">AP 表が未設定(RPN のみ)</span>}
        {a.apStatus === "declared" && <span className="muted" title={safety.apTableSource}>AP: 設定済み(出典あり)</span>}
        {(a.apStatus === "unofficial" || a.apStatus === "unknown") && (
          <span className="badge warn" title={safety.apTableSource ?? "出典が未記入"}>
            ▲ AP は {a.apStatus === "unofficial" ? "非公式のサンプル表" : "出典が未確認の表"} による値です(実際の分析では正式な表に置き換え)
          </span>
        )}
      </div>
      {!a.apAvailable && (
        <div className="banner" role="note">
          AIAG-VDA の Action Priority(AP)表が未設定です。「データ」タブの <code>apTable</code> に、ハンドブックの正式な表を設定すると、AP を表示します。それまでは RPN のみを表示します。
        </div>
      )}
      {adding && <AddFailure focusFns={fns} onDone={() => setAdding(false)} existing={safety.failures.map((f) => f.id)} />}
      <div style={{ overflow: "auto", minHeight: 0 }} tabIndex={0} role="region" aria-label={`${nameOf(focus)} の FMEA(スクロールできます)`}>
        <table className="grid" aria-label={`${nameOf(focus)} の FMEA`}>
          <thead>
            <tr>
              <th>機能</th><th>故障モード(FM)</th><th>故障影響(FE:上位)</th><th className="num" title="重大度">S</th>
              <th>故障原因(FC:下位/根本)</th><th>予防管理</th><th className="num" title="発生度">O</th><th>検出管理</th><th className="num" title="検出度">D</th>
              <th className="num">RPN</th><th className="num">AP</th><th><span className="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {view?.rows.length === 0 && <tr><td colSpan={12} className="muted">この要素の機能に、故障モードがありません。「故障モードを追加」で作成するか、AI に提案させてください。</td></tr>}
            {view?.rows.map((r) => <FmRows key={r.failureModeId} r={r} nameOf={nameOf} setLink={setLink} removeCause={removeCause} ap={a.apAvailable}
              adding={addCauseFor === r.failureModeId} toggleAdd={() => setAddCauseFor(addCauseFor === r.failureModeId ? undefined : r.failureModeId)} focus={focus} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FmRows(p: { r: FmeaRow; nameOf: (id: string) => string; setLink: (id: string, patch: Record<string, number | string | undefined>) => void; removeCause: (id: string) => void; ap: boolean; adding: boolean; toggleAdd: () => void; focus: string }) {
  const { r } = p;
  const safety = useStore((s) => s.draftSafety)!;
  const own = safety.failures.find((f) => f.id === r.failureModeId);
  const span = Math.max(1, r.causes.length) + (p.adding ? 1 : 0);
  const topLevel = r.effects.length === 0;
  const head = (
    <>
      <td rowSpan={span}>{r.functionName}</td>
      <td rowSpan={span}><strong>{r.failureMode}</strong><div className="muted">{r.failureModeId}</div><button className="btn small" onClick={p.toggleAdd} aria-expanded={p.adding}>＋ 原因</button></td>
      <td rowSpan={span}>{r.effects.length ? r.effects.map((e) => <div key={e.failureId}>{p.nameOf(e.elementId)}: {e.description}</div>) : <span className="muted">(最上位)</span>}</td>
      <td className="num" rowSpan={span}>
        {topLevel ? (
          <input type="number" min={1} max={10} aria-label={`${r.failureMode} の重大度`} value={own?.severity ?? ""} onChange={(e) => updateSafety((d) => { const f = d.failures.find((x) => x.id === r.failureModeId); if (!f) return; const v = rating(e.target.value); if (v === undefined) delete f.severity; else f.severity = v; })} />
        ) : r.severity !== undefined ? <span title="最上位の故障影響から継承">{r.severity}</span> : <span className="muted" title="最上位の故障影響に重大度が未設定">—</span>}
      </td>
    </>
  );
  const causeRow = (c: FmeaCause) => (
    <>
      <td>{p.nameOf(c.elementId)}: {c.description}</td>
      <td><input type="text" aria-label={`${c.description} の予防管理`} value={c.preventionControl ?? ""} onChange={(e) => p.setLink(c.linkId, { preventionControl: e.target.value })} /></td>
      <td className="num"><input type="number" min={1} max={10} aria-label={`${c.description} の発生度`} value={c.occurrence ?? ""} onChange={(e) => p.setLink(c.linkId, { occurrence: rating(e.target.value) })} /></td>
      <td><input type="text" aria-label={`${c.description} の検出管理`} value={c.detectionControl ?? ""} onChange={(e) => p.setLink(c.linkId, { detectionControl: e.target.value })} /></td>
      <td className="num"><input type="number" min={1} max={10} aria-label={`${c.description} の検出度`} value={c.detection ?? ""} onChange={(e) => p.setLink(c.linkId, { detection: rating(e.target.value) })} /></td>
      <td className={`num ${c.rpn !== undefined && c.rpn >= 120 ? "rpn-high" : ""}`}>{c.rpn ?? "—"}</td>
      <td className="num">{c.ap ?? (p.ap ? "—" : "")}</td>
      <td><button className="btn small danger" onClick={() => p.removeCause(c.linkId)} aria-label={`${c.description} を原因から外す`}>✕</button></td>
    </>
  );
  return (
    <>
      <tr>{head}{r.causes[0] ? causeRow(r.causes[0]) : <td colSpan={8} className="muted">故障原因が未定義です</td>}</tr>
      {r.causes.slice(1).map((c) => <tr key={c.linkId}>{causeRow(c)}</tr>)}
      {p.adding && <tr><td colSpan={8}><AddCause r={r} focus={p.focus} done={p.toggleAdd} /></td></tr>}
    </>
  );
}

function AddFailure({ focusFns, onDone, existing }: { focusFns: { id: string; name: string }[]; onDone: () => void; existing: string[] }) {
  const [fn, setFn] = useState(focusFns[0]?.id ?? "");
  const [text, setText] = useState("");
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (!text.trim() || !fn) return; updateSafety((d) => { d.failures.push({ id: nextId("FM", [...existing, ...d.failures.map((x) => x.id)]), description: text.trim(), functionId: fn }); }); onDone(); }}>
      <select aria-label="対象の機能" value={fn} onChange={(e) => setFn(e.target.value)}>{focusFns.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      <input type="text" aria-label="故障モードの内容" placeholder="例: トルクが出ない" value={text} onChange={(e) => setText(e.target.value)} style={{ minWidth: 260 }} />
      <button className="btn small primary" disabled={!text.trim()}>追加</button>
    </form>
  );
}

function AddCause({ r, focus, done }: { r: FmeaRow; focus: string; done: () => void }) {
  const a = useStore((s) => s.analysis)!;
  const safety = useStore((s) => s.draftSafety)!;
  const childEls = new Set(a.net.elements.filter((e) => e.parentId === focus).map((e) => e.id));
  const linked = new Set(safety.links.filter((l) => l.effectId === r.failureModeId).map((l) => l.causeId));
  const options = safety.failures.filter((f) => !linked.has(f.id) && !f.isBasicCause && childEls.has(a.net.functions.find((x) => x.id === f.functionId)?.ownerId ?? ""));
  const [choice, setChoice] = useState(options[0]?.id ?? "__new");
  const [text, setText] = useState("");
  const create = () => updateSafety((d) => {
    const ids = [...d.failures.map((x) => x.id), ...d.links.map((x) => x.id)];
    let causeId = choice;
    if (choice === "__new") {
      causeId = nextId("FC", ids);
      d.failures.push({ id: causeId, description: text.trim(), functionId: r.functionId, isBasicCause: true });
    }
    d.links.push({ id: nextId("L", [...ids, causeId]), causeId, effectId: r.failureModeId });
  });
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (choice === "__new" && !text.trim()) return; create(); done(); }}>
      <select aria-label="故障原因の選択" value={choice} onChange={(e) => setChoice(e.target.value)}>
        {options.map((f) => <option key={f.id} value={f.id}>下位の故障モード: {f.description}</option>)}
        <option value="__new">新しい根本原因を入力…</option>
      </select>
      {choice === "__new" && <input type="text" aria-label="根本原因の内容" placeholder="例: 巻線の断線" value={text} onChange={(e) => setText(e.target.value)} style={{ minWidth: 220 }} />}
      <button className="btn small primary">原因を追加</button>
      <button type="button" className="btn small" onClick={done}>取消</button>
    </form>
  );
}
