import { updateSafety, useStore } from "../store.js";
import { nextId } from "../ui.js";

const num = (v: string): number | undefined => (v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

/** ハードウェア故障モード(故障率・診断カバレッジ)の入力。SPFM/LFM の算出に使う(ISO 26262-5)。値は利用者の入力で、根拠(FMEDA の出典など)を必ず記録する。 */
export function HardwareEditor() {
  const a = useStore((s) => s.analysis);
  const safety = useStore((s) => s.draftSafety);
  if (!a || !safety) return null;
  const modes = safety.hardwareFailureModes ?? [];
  const issuesOf = (id: string) => a.issues.filter((i) => i.source === "hardware" && i.ref === id);
  return (
    <details>
      <summary>ハードウェア故障モードと故障率({modes.length} 件)— SPFM/LFM の入力</summary>
      <div className="stack" style={{ marginTop: 6 }}>
        <div className="row">
          <button className="btn small" onClick={() => updateSafety((d) => { (d.hardwareFailureModes ??= []).push({ id: nextId("HW", (d.hardwareFailureModes ?? []).map((m) => m.id)), name: "", fit: 0, type: "single" }); })}>＋ 故障モード</button>
          <span className="muted">FIT = 10⁻⁹/h。DC を主張するときは、担う安全機構と根拠を記入してください(区分 low/medium/high の上限は 60/90/99%)。</span>
        </div>
        <div style={{ overflow: "auto" }} tabIndex={0} role="region" aria-label="ハードウェア故障モード(スクロールできます)">
          <table className="grid" aria-label="ハードウェア故障モード">
            <thead><tr><th>ID</th><th>名称</th><th>構造要素</th><th className="num">FIT</th><th>種別</th><th className="num">安全な故障</th><th className="num">DC</th><th>安全機構</th><th>対象の安全目標</th><th>根拠</th><th>指摘</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {modes.map((m, i) => {
                const set = <K extends keyof typeof m>(k: K, v: (typeof m)[K] | undefined) => updateSafety((d) => { const t = d.hardwareFailureModes![i]!; if (v === undefined || v === "") delete t[k]; else t[k] = v as never; });
                const dcKey = m.type === "single" ? "dcSpfRf" : "dcLatent";
                return (
                  <tr key={m.id}>
                    <td>{m.id}</td>
                    <td><input type="text" aria-label={`${m.id} の名称`} value={m.name} onChange={(e) => updateSafety((d) => { d.hardwareFailureModes![i]!.name = e.target.value; })} /></td>
                    <td><select aria-label={`${m.id} の構造要素`} value={m.elementId ?? ""} onChange={(e) => set("elementId", e.target.value)}><option value="">(なし)</option>{a.net.elements.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
                    <td className="num"><input type="number" min={0} step="any" aria-label={`${m.id} の故障率(FIT)`} value={m.fit} onChange={(e) => updateSafety((d) => { d.hardwareFailureModes![i]!.fit = Math.max(0, num(e.target.value) ?? 0); })} /></td>
                    <td><select aria-label={`${m.id} の種別`} value={m.type} onChange={(e) => updateSafety((d) => { const t = d.hardwareFailureModes![i]!; t.type = e.target.value as "single" | "multiple"; delete t.dcSpfRf; delete t.dcLatent; })}><option value="single">単一点・残存</option><option value="multiple">多重(潜在)</option></select></td>
                    <td className="num"><input type="number" min={0} max={1} step={0.01} aria-label={`${m.id} の安全な故障の割合`} value={m.safeFraction ?? ""} onChange={(e) => set("safeFraction", num(e.target.value))} /></td>
                    <td className="num"><input type="number" min={0} max={1} step={0.001} aria-label={`${m.id} の診断カバレッジ`} value={m[dcKey] ?? ""} onChange={(e) => set(dcKey, num(e.target.value))} /></td>
                    <td><select aria-label={`${m.id} の安全機構`} value={m.mechanismId ?? ""} onChange={(e) => set("mechanismId", e.target.value)}><option value="">(なし)</option>{safety.mechanisms.map((x) => <option key={x.id} value={x.id}>{x.id}{x.diagnosticCoverage ? `(${x.diagnosticCoverage})` : ""}</option>)}</select></td>
                    <td><input type="text" aria-label={`${m.id} の対象の安全目標(カンマ区切り。空 = すべて)`} placeholder="SG-1, SG-2" value={(m.goalIds ?? []).join(", ")} onChange={(e) => updateSafety((d) => { const t = d.hardwareFailureModes![i]!; const ids = e.target.value.split(/[,、\s]+/).filter(Boolean); if (ids.length) t.goalIds = ids; else delete t.goalIds; })} /></td>
                    <td><input type="text" aria-label={`${m.id} の根拠`} value={m.rationale ?? ""} onChange={(e) => set("rationale", e.target.value)} /></td>
                    <td>{issuesOf(m.id).map((x, k) => <div key={k} className={`badge ${x.severity === "error" ? "err" : "warn"}`}>{x.severity === "error" ? "✕" : "▲"} {x.message}</div>)}</td>
                    <td><button className="btn small danger" aria-label={`${m.id} を削除`} onClick={() => { if (window.confirm(`${m.id} を削除しますか?`)) updateSafety((d) => { d.hardwareFailureModes!.splice(i, 1); }); }}>✕</button></td>
                  </tr>
                );
              })}
              {modes.length === 0 && <tr><td colSpan={12} className="muted">故障モードが未入力です。ASIL B 以上の安全目標では、SPFM/LFM の評価に必要です</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
