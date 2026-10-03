import { ASILS, determineAsil, eventAsil, goalAsilFromEvents, type Asil } from "@fusamod/safety-core";
import { updateSafety, useStore } from "../store.js";
import { AsilBadge, nextId } from "../ui.js";

const S_HINT = ["S0 傷害なし", "S1 軽傷・中程度の傷害", "S2 重傷(生存の可能性あり)", "S3 生命に関わる傷害"];
const E_HINT = ["E0 考えにくい", "E1 非常にまれ", "E2 まれ", "E3 時折", "E4 高い頻度"];
const C_HINT = ["C0 一般に制御可能", "C1 容易に制御可能", "C2 通常は制御可能", "C3 制御が困難または不可能"];

/** ハザード分析とリスク評価(HARA)。S/E/C から ASIL を導出し、安全目標の ASIL との整合を確認する。判定ロジックは ISO 26262-3 の表と全組み合わせで照合済み。 */
export function HaraView() {
  const a = useStore((s) => s.analysis);
  const safety = useStore((s) => s.draftSafety);
  if (!safety) return <div className="empty">HARA を表示できません</div>;
  const hara = safety.hara;
  const issues = a?.issues.filter((i) => i.source === "hara") ?? [];
  return (
    <div className="stack" style={{ minHeight: 0 }}>
      <div className="row">
        <button className="btn small" onClick={() => updateSafety((d) => { d.hara.events.push({ id: nextId("HE", d.hara.events.map((e) => e.id)), hazard: "", situation: "", severity: 1, exposure: 1, controllability: 1 }); })}>＋ ハザード事象</button>
        <button className="btn small" onClick={() => updateSafety((d) => { d.hara.goals.push({ id: nextId("SG", d.hara.goals.map((g) => g.id)), text: "", asil: "QM" }); })}>＋ 安全目標</button>
        <span className="muted">ASIL は S・E・C から自動で導出します(ISO 26262-3 の決定表)。評価の根拠は必ず記録してください。</span>
      </div>
      <div style={{ overflow: "auto" }} tabIndex={0} role="region" aria-label="ハザード事象(スクロールできます)">
        <table className="grid" aria-label="ハザード事象">
          <thead><tr><th>ID</th><th>ハザード</th><th>運転状況</th><th className="num">S</th><th className="num">E</th><th className="num">C</th><th>ASIL</th><th>安全目標</th><th>評価の根拠</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>
            {hara.events.map((e, i) => (
              <tr key={e.id}>
                <td>{e.id}</td>
                <td><input type="text" aria-label={`${e.id} のハザード`} value={e.hazard} onChange={(x) => updateSafety((d) => { d.hara.events[i]!.hazard = x.target.value; })} /></td>
                <td><input type="text" aria-label={`${e.id} の運転状況`} value={e.situation} onChange={(x) => updateSafety((d) => { d.hara.events[i]!.situation = x.target.value; })} /></td>
                <td className="num"><select aria-label={`${e.id} の S`} title={S_HINT[e.severity]} value={e.severity} onChange={(x) => updateSafety((d) => { d.hara.events[i]!.severity = Number(x.target.value) as 0 | 1 | 2 | 3; })}>{S_HINT.map((h, v) => <option key={v} value={v}>{h}</option>)}</select></td>
                <td className="num"><select aria-label={`${e.id} の E`} title={E_HINT[e.exposure]} value={e.exposure} onChange={(x) => updateSafety((d) => { d.hara.events[i]!.exposure = Number(x.target.value) as 0 | 1 | 2 | 3 | 4; })}>{E_HINT.map((h, v) => <option key={v} value={v}>{h}</option>)}</select></td>
                <td className="num"><select aria-label={`${e.id} の C`} title={C_HINT[e.controllability]} value={e.controllability} onChange={(x) => updateSafety((d) => { d.hara.events[i]!.controllability = Number(x.target.value) as 0 | 1 | 2 | 3; })}>{C_HINT.map((h, v) => <option key={v} value={v}>{h}</option>)}</select></td>
                <td><AsilBadge asil={determineAsil(e.severity, e.exposure, e.controllability)} /></td>
                <td><select aria-label={`${e.id} の安全目標`} value={e.safetyGoalId ?? ""} onChange={(x) => updateSafety((d) => { const ev = d.hara.events[i]!; if (x.target.value) ev.safetyGoalId = x.target.value; else delete ev.safetyGoalId; })}><option value="">(なし)</option>{hara.goals.map((g) => <option key={g.id} value={g.id}>{g.id}</option>)}</select></td>
                <td><input type="text" aria-label={`${e.id} の根拠`} value={e.rationale ?? ""} onChange={(x) => updateSafety((d) => { const ev = d.hara.events[i]!; if (x.target.value) ev.rationale = x.target.value; else delete ev.rationale; })} /></td>
                <td><button className="btn small danger" aria-label={`${e.id} を削除`} onClick={() => { if (window.confirm(`${e.id} を削除しますか?`)) updateSafety((d) => { d.hara.events.splice(i, 1); }); }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ overflow: "auto" }} tabIndex={0} role="region" aria-label="安全目標(スクロールできます)">
        <table className="grid" aria-label="安全目標">
          <thead><tr><th>ID</th><th>安全目標</th><th>ASIL</th><th>事象から導出した ASIL</th><th className="num">FTTI(ms)</th><th>安全状態</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>
            {hara.goals.map((g, i) => {
              const derived = goalAsilFromEvents(hara, g.id);
              return (
                <tr key={g.id}>
                  <td>{g.id}</td>
                  <td><input type="text" aria-label={`${g.id} の内容`} value={g.text} onChange={(x) => updateSafety((d) => { d.hara.goals[i]!.text = x.target.value; })} /></td>
                  <td><select aria-label={`${g.id} の ASIL`} value={g.asil} onChange={(x) => updateSafety((d) => { d.hara.goals[i]!.asil = x.target.value as Asil; })}>{ASILS.map((s) => <option key={s}>{s}</option>)}</select></td>
                  <td>{derived ? <><AsilBadge asil={derived} />{derived !== g.asil && <span className="badge err" role="alert" style={{ marginLeft: 6 }}>✕ 不一致</span>}</> : <span className="muted">事象なし</span>}</td>
                  <td className="num"><input type="number" min={1} aria-label={`${g.id} の FTTI`} value={g.ftti ?? ""} onChange={(x) => updateSafety((d) => { const t = d.hara.goals[i]!; if (x.target.value === "") delete t.ftti; else t.ftti = Math.max(1, Number(x.target.value)); })} /></td>
                  <td><input type="text" aria-label={`${g.id} の安全状態`} value={g.safeState ?? ""} onChange={(x) => updateSafety((d) => { const t = d.hara.goals[i]!; if (x.target.value) t.safeState = x.target.value; else delete t.safeState; })} /></td>
                  <td><button className="btn small danger" aria-label={`${g.id} を削除`} onClick={() => { if (window.confirm(`${g.id} を削除しますか?`)) updateSafety((d) => { d.hara.goals.splice(i, 1); }); }}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hara.events.length > 0 && <div className="muted">事象ごとの ASIL(再計算): {hara.events.map((e) => `${e.id}=${eventAsil(e)}`).join("、")}</div>}
      {issues.map((i, k) => <div key={k} className={`badge ${i.severity === "error" ? "err" : "warn"}`}>{i.severity === "error" ? "✕" : "▲"} {i.message}{i.ref ? `(${i.ref})` : ""}</div>)}
    </div>
  );
}
