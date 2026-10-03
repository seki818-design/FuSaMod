import { useState } from "react";
import { ASILS, isValidDecomposition, type Asil } from "@fusamod/safety-core";
import { updateSafety, useStore } from "../store.js";
import { AsilBadge, nextId } from "../ui.js";
import { HardwareEditor } from "./HardwareEditor.js";

const OPTIONS: Record<string, [Asil, Asil][]> = { D: [["D", "QM"], ["C", "A"], ["B", "B"]], C: [["C", "QM"], ["B", "A"]], B: [["B", "QM"], ["A", "A"]], A: [["A", "QM"]] };

/** 安全コンセプト: 意図機能と安全機構のペア、安全要求の導出、ASIL デコンポジション。各階層(構造要素)で識別できる。 */
export function ConceptView() {
  const a = useStore((s) => s.analysis);
  const safety = useStore((s) => s.draftSafety);
  const [form, setForm] = useState<"" | "if" | "sm" | "pair" | "dec">("");
  if (!a || !safety) return <div className="empty">安全コンセプトを表示できません</div>;
  const nameOf = (id: string) => a.net.elements.find((e) => e.id === id)?.name ?? id;
  const level = (id: string) => (a.levelOf[id] ? a.scdl.elements.find((e) => e.id === a.scdlElementIds[id])?.id ?? "" : "");
  const issuesOf = (ref: string) => a.issues.filter((i) => i.ref === ref);
  const flag = (ref: string) => { const ix = issuesOf(ref); return ix.some((i) => i.severity === "error") ? <span className="badge err">✕ {ix.find((i) => i.severity === "error")!.message}</span> : ix.length ? <span className="badge warn">▲ {ix[0]!.message}</span> : <span className="badge ok">✓</span>; };
  return (
    <div className="stack scroll-stack" style={{ minHeight: 0 }}>
      <div className="row">
        {(["if", "sm", "pair", "dec"] as const).map((k) => <button key={k} className="btn small" aria-expanded={form === k} onClick={() => setForm(form === k ? "" : k)}>＋ {{ if: "意図機能", sm: "安全機構", pair: "ペア", dec: "ASIL 分解" }[k]}</button>)}
        <span className="muted">要素の識別子は SCDL の ID(vehicle/powertrain/vcu のように、名前をつないだもの)です。</span>
      </div>
      {form === "if" && <AddItem kind="if" onDone={() => setForm("")} />}
      {form === "sm" && <AddItem kind="sm" onDone={() => setForm("")} />}
      {form === "pair" && <AddPair onDone={() => setForm("")} />}
      {form === "dec" && <AddDecomposition onDone={() => setForm("")} />}
      <HardwareMetrics />
      <HardwareEditor />
      <div style={{ overflow: "auto" }} tabIndex={0} role="region" aria-label="意図機能と安全機構(スクロールできます)">
        <table className="grid" aria-label="意図機能と安全機構">
          <thead><tr><th>種別</th><th>ID</th><th>名称</th><th>階層・要素</th><th>ASIL</th><th>FTTI(ms)</th><th>状態</th></tr></thead>
          <tbody>
            {safety.intendedFunctions.map((f) => <tr key={f.id}><td>意図機能</td><td>{f.id}</td><td>{f.name}</td><td>{level(f.elementId)} {nameOf(f.elementId)}</td><td><AsilBadge asil={f.asil} origin={f.originAsil} /></td><td>—</td><td>{flag(f.id)}</td></tr>)}
            {safety.mechanisms.map((m) => <tr key={m.id}><td>安全機構</td><td>{m.id}</td><td>{m.name}</td><td>{level(m.elementId)} {nameOf(m.elementId)}</td><td>{m.asil ? <AsilBadge asil={m.asil} origin={m.originAsil} /> : "—"}</td><td>{m.ftti ?? "—"}</td><td>{flag(m.id)}</td></tr>)}
            {safety.intendedFunctions.length + safety.mechanisms.length === 0 && <tr><td colSpan={7} className="muted">意図機能・安全機構が未定義です</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ overflow: "auto" }} tabIndex={0} role="region" aria-label="ペア(スクロールできます)">
        <table className="grid" aria-label="ペア">
          <thead><tr><th>ペア</th><th>意図機能 ↔ 安全機構</th><th>独立性の要求(SCDL の制約条件)</th><th>状態</th></tr></thead>
          <tbody>
            {safety.pairs.map((p, i) => (
              <tr key={p.id}><td>{p.id}</td><td>{p.intendedFunctionId} ↔ {p.mechanismId}</td>
                <td><input type="text" aria-label={`${p.id} の独立性の要求`} value={p.independence ?? ""} onChange={(e) => updateSafety((d) => { const t = d.pairs[i]!; if (e.target.value) t.independence = e.target.value; else delete t.independence; })} /></td>
                <td>{flag(p.id)}{a.issues.filter((x) => x.source === "scdl" && x.ref === p.id).map((x, k) => <div key={k} className="badge warn">▲ {x.message}</div>)}</td></tr>
            ))}
            {safety.pairs.length === 0 && <tr><td colSpan={4} className="muted">ペアが未定義です(意図機能には、対応する安全機構が必要です)</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ overflow: "auto" }} tabIndex={0} role="region" aria-label="ASIL 分解(スクロールできます)">
        <table className="grid" aria-label="ASIL 分解">
          <thead><tr><th>分解</th><th>元の要求</th><th>分解先</th><th>独立性の根拠</th><th>状態</th></tr></thead>
          <tbody>
            {safety.decompositions.map((d, i) => {
              const parent = safety.safetyRequirements.find((r) => r.id === d.parentRequirementId);
              const kids = d.childRequirementIds.map((id) => safety.safetyRequirements.find((r) => r.id === id));
              return (
                <tr key={d.id}><td>{d.id}</td>
                  <td>{parent ? <>{parent.id} <AsilBadge asil={parent.asil} origin={parent.originAsil} /></> : d.parentRequirementId}</td>
                  <td>{kids.map((k, j) => <div key={j}>{k ? <>{k.id} <AsilBadge asil={k.asil} origin={k.originAsil} /> {nameOf(k.allocatedTo ?? "")}</> : d.childRequirementIds[j]}</div>)}</td>
                  <td><input type="text" aria-label={`${d.id} の独立性の根拠`} value={d.independenceEvidence ?? ""} onChange={(e) => updateSafety((x) => { const t = x.decompositions[i]!; if (e.target.value) t.independenceEvidence = e.target.value; else delete t.independenceEvidence; })} /></td>
                  <td>{flag(d.id)}{parent && kids[0] && kids[1] && isValidDecomposition(parent.asil, kids[0].asil, kids[1].asil) ? <div className="muted">ASIL {parent.asil} = {kids[0].asil} + {kids[1].asil}</div> : null}</td></tr>
              );
            })}
            {safety.decompositions.length === 0 && <tr><td colSpan={5} className="muted">分解はありません</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ overflow: "auto" }} tabIndex={0} role="region" aria-label="安全要求(スクロールできます)">
        <table className="grid" aria-label="安全要求">
          <thead><tr><th>ID</th><th>階層</th><th>内容</th><th>ASIL</th><th>配置先</th><th>上位</th></tr></thead>
          <tbody>
            {safety.safetyRequirements.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.level}</td><td>{r.text}</td><td><AsilBadge asil={r.asil} origin={r.originAsil} /></td><td>{r.allocatedTo ? `${level(r.allocatedTo)} ${nameOf(r.allocatedTo)}` : "—"}</td><td>{r.parentId ?? "—"}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddItem({ kind, onDone }: { kind: "if" | "sm"; onDone: () => void }) {
  const a = useStore((s) => s.analysis)!;
  const [name, setName] = useState("");
  const [el, setEl] = useState(a.net.elements[0]?.id ?? "");
  const [asil, setAsil] = useState<Asil>("B");
  const [ftti, setFtti] = useState("");
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (!name.trim() || !el) return; updateSafety((d) => {
      const ids = [...d.intendedFunctions, ...d.mechanisms, ...d.safetyRequirements].map((x) => x.id);
      if (kind === "if") d.intendedFunctions.push({ id: nextId("IF", ids), name: name.trim(), elementId: el, asil });
      else d.mechanisms.push({ id: nextId("SM", ids), name: name.trim(), elementId: el, asil, ...(ftti ? { ftti: Number(ftti) } : {}) });
    }); onDone(); }}>
      <input type="text" aria-label="名称" placeholder={kind === "if" ? "意図機能の名称" : "安全機構の名称"} value={name} onChange={(e) => setName(e.target.value)} />
      <select aria-label="構造要素" value={el} onChange={(e) => setEl(e.target.value)}>{a.net.elements.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="ASIL" value={asil} onChange={(e) => setAsil(e.target.value as Asil)}>{ASILS.map((s) => <option key={s}>{s}</option>)}</select>
      {kind === "sm" && <input type="number" min={1} aria-label="FTTI(ms)" placeholder="FTTI ms" value={ftti} onChange={(e) => setFtti(e.target.value)} style={{ width: 100 }} />}
      <button className="btn small primary" disabled={!name.trim()}>追加</button>
    </form>
  );
}

function AddPair({ onDone }: { onDone: () => void }) {
  const safety = useStore((s) => s.draftSafety)!;
  const [f, setF] = useState(safety.intendedFunctions[0]?.id ?? "");
  const [m, setM] = useState(safety.mechanisms[0]?.id ?? "");
  const [ind, setInd] = useState("");
  if (safety.intendedFunctions.length === 0 || safety.mechanisms.length === 0) return <div className="muted">先に意図機能と安全機構を追加してください。</div>;
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); updateSafety((d) => { d.pairs.push({ id: nextId("PAIR", d.pairs.map((p) => p.id)), intendedFunctionId: f, mechanismId: m, ...(ind ? { independence: ind } : {}) }); }); onDone(); }}>
      <select aria-label="意図機能" value={f} onChange={(e) => setF(e.target.value)}>{safety.intendedFunctions.map((x) => <option key={x.id} value={x.id}>{x.id} {x.name}</option>)}</select>
      <select aria-label="安全機構" value={m} onChange={(e) => setM(e.target.value)}>{safety.mechanisms.map((x) => <option key={x.id} value={x.id}>{x.id} {x.name}</option>)}</select>
      <input type="text" aria-label="独立性の要求" placeholder="独立性の要求(同時侵害となる従属故障がないこと 等)" value={ind} onChange={(e) => setInd(e.target.value)} style={{ minWidth: 300 }} />
      <button className="btn small primary">追加</button>
    </form>
  );
}

function AddDecomposition({ onDone }: { onDone: () => void }) {
  const a = useStore((s) => s.analysis)!;
  const safety = useStore((s) => s.draftSafety)!;
  const candidates = safety.safetyRequirements.filter((r) => r.asil !== "QM" && !safety.decompositions.some((d) => d.parentRequirementId === r.id));
  const [parent, setParent] = useState(candidates[0]?.id ?? "");
  const par = candidates.find((r) => r.id === parent);
  const opts = par ? OPTIONS[par.asil] ?? [] : [];
  const [opt, setOpt] = useState(0);
  const [e1, setE1] = useState(a.net.elements[0]?.id ?? "");
  const [e2, setE2] = useState(a.net.elements[1]?.id ?? a.net.elements[0]?.id ?? "");
  const [ev, setEv] = useState("");
  if (!par) return <div className="muted">分解できる安全要求(ASIL A 以上で、未分解のもの)がありません。</div>;
  const [x, y] = opts[opt] ?? opts[0]!;
  const sameEl = e1 === e2;
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (sameEl) return; updateSafety((d) => {
      const origin = par.originAsil ?? par.asil;
      const ids = [...d.safetyRequirements.map((r) => r.id), ...d.decompositions.map((q) => q.id)];
      const c1 = nextId(`${par.id}`, ids), c2 = nextId(`${par.id}`, [...ids, c1]);
      const mk = (id: string, asil: Asil, el: string) => ({ id, text: `${par.text}(分解先)`, level: par.level, asil, originAsil: origin, parentId: par.id, allocatedTo: el });
      d.safetyRequirements.push(mk(c1, x, e1), mk(c2, y, e2));
      d.decompositions.push({ id: nextId("DEC", d.decompositions.map((q) => q.id)), parentRequirementId: par.id, childRequirementIds: [c1, c2], ...(ev ? { independenceEvidence: ev } : {}) });
    }); onDone(); }}>
      <div className="row">
        <select aria-label="分解する安全要求" value={parent} onChange={(e) => { setParent(e.target.value); setOpt(0); }}>{candidates.map((r) => <option key={r.id} value={r.id}>{r.id}(ASIL {r.asil})</option>)}</select>
        <select aria-label="分解の組み合わせ" value={opt} onChange={(e) => setOpt(Number(e.target.value))}>{opts.map(([p, q], i) => <option key={i} value={i}>{p} + {q}</option>)}</select>
        <span className="muted">ISO 26262-9 で許される組み合わせだけを選べます。</span>
      </div>
      <div className="row">
        <label className="row">分解先 1({x}) の配置先<select aria-label="分解先 1 の構造要素" value={e1} onChange={(e) => setE1(e.target.value)}>{a.net.elements.map((el) => <option key={el.id} value={el.id}>{el.name}</option>)}</select></label>
        <label className="row">分解先 2({y}) の配置先<select aria-label="分解先 2 の構造要素" value={e2} onChange={(e) => setE2(e.target.value)}>{a.net.elements.map((el) => <option key={el.id} value={el.id}>{el.name}</option>)}</select></label>
        {sameEl && <span className="badge err" role="alert">✕ 同じ要素では独立性が成立しません</span>}
      </div>
      <div className="row"><input type="text" aria-label="独立性の根拠" placeholder="独立性の根拠(依存故障解析の文書番号など)" value={ev} onChange={(e) => setEv(e.target.value)} style={{ minWidth: 340 }} /><button className="btn small primary" disabled={sameEl}>分解を追加</button></div>
    </form>
  );
}

/** ハードウェアアーキテクチャのメトリクス(SPFM / LFM。ISO 26262-5)。故障率は下の入力欄(hardwareFailureModes)に入れる。 */
function HardwareMetrics() {
  const a = useStore((s) => s.analysis);
  const hw = a?.hardware;
  if (!a) return null;
  const pct = (v: number | undefined) => (v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
  if (!hw)
    return <div className="muted" role="note">ハードウェアのメトリクス(SPFM/LFM)は、故障率を入れると算出されます(下の「ハードウェア故障モード」で入力)。</div>;
  const ng = (v: number | undefined, t: number | undefined) => v !== undefined && t !== undefined && v < t;
  const cls = (v: number | undefined, t: number | undefined) => (v === undefined ? "warn" : ng(v, t) ? "err" : "ok"); // 算出できない（故障率 0 など）は緑にしない
  const perGoalNg = a.issues.some((i) => i.source === "hardware" && (i.code === "HW_SPFM_BELOW_TARGET" || i.code === "HW_LFM_BELOW_TARGET" || i.code === "HW_METRICS_MISSING"));
  return (
    <div className="row" role="status" aria-label="ハードウェアメトリクス">
      <strong>ハードウェアメトリクス</strong>
      <span className={`badge ${perGoalNg && !ng(hw.spfm, hw.target?.spfm) ? "warn" : cls(hw.spfm, hw.target?.spfm)}`} title="単一点故障メトリクス = 1 − (単一点+残存故障の故障率) / 安全関連の故障率">SPFM {pct(hw.spfm)}{hw.spfm === undefined ? "(算出不可)" : ""}{hw.target ? `(目標 ${pct(hw.target.spfm)})` : ""}</span>
      <span className={`badge ${perGoalNg && !ng(hw.lfm, hw.target?.lfm) ? "warn" : cls(hw.lfm, hw.target?.lfm)}`} title="潜在故障メトリクス">LFM {pct(hw.lfm)}{hw.target ? `(目標 ${pct(hw.target.lfm)})` : ""}</span>
      <span className="muted">最大 ASIL {hw.targetAsil}、安全関連 {hw.totalFit} FIT(全故障モードの合算。評価できていない安全目標があれば黄色。安全目標ごとの判定は「問題」タブ)。故障率は利用者の入力で、PMHF は算出しません。</span>
    </div>
  );
}
