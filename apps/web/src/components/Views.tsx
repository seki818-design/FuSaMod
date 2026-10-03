import { useState } from "react";
import { impactOfRequirementChange, levelLabel, parseSafetyData, VIEWPOINTS } from "@fusamod/analysis";
import { LEVELS } from "@fusamod/analysis";
import { clearIssueFocus, exportFile, openTab, replaceSafety, restoreRevision, select, useStore, type TabKey } from "../store.js";
import { AsilBadge, SeverityBadge, last } from "../ui.js";

export function TraceView() {
  const a = useStore((s) => s.analysis);
  const safety = useStore((s) => s.draftSafety);
  const sel = useStore((s) => s.selectedElementId);
  const [impactId, setImpactId] = useState<string | undefined>();
  if (!a) return <div className="empty">トレースを表示できません</div>;
  const t = a.trace;
  const impact = impactId && safety ? impactOfRequirementChange(a, safety, impactId) : undefined;
  const nm = (id: string) => a.net.elements.find((e) => e.id === id)?.name ?? id;
  return (
    <div className="stack" style={{ minHeight: 0 }}>
      <div className="row">
        <button className="btn small" onClick={() => void exportFile("trace.csv")}>CSV 出力</button>
        <span className="muted">satisfy = SysML の satisfy / allocate = 安全要求の配置。{t.uncovered.length > 0 && <span className="badge warn" style={{ marginLeft: 8 }}>▲ 構造要素に紐づかない要求 {t.uncovered.length} 件</span>}</span>
      </div>
      <div style={{ overflow: "auto" }} tabIndex={0} role="region" aria-label="トレースマトリクス(スクロールできます)">
        <table className="grid" aria-label="トレースマトリクス">
          <thead><tr><th>要求</th><th>ASIL</th>{t.elements.map((e) => <th key={e.id} className="num" title={`${e.name}(${levelLabel(e.level)})`} style={{ writingMode: "vertical-rl", maxHeight: 110, ...(sel === e.id ? { background: "var(--accent-bg)" } : {}) }}>{e.name}</th>)}</tr></thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.id} className={t.uncovered.includes(r.id) ? "sel" : ""}>
                <td title={r.text}>{r.label}{t.uncovered.includes(r.id) && <span className="badge warn" style={{ marginLeft: 6 }}>未紐づけ</span>} <button className="btn small" onClick={() => setImpactId(impactId === r.id ? undefined : r.id)} aria-pressed={impactId === r.id} aria-label={`${r.label} を変更したときの影響分析`}>影響</button></td>
                <td>{r.asil ? <AsilBadge asil={r.asil} origin={r.originAsil} /> : "—"}</td>
                {t.elements.map((e) => { const c = t.cells.find((x) => x.requirementId === r.id && x.elementId === e.id); return <td key={e.id} className="num" title={c?.relation}>{c ? (c.relation === "satisfy" ? "●" : "◆") : ""}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted">● satisfy(SysML) / ◆ allocate(安全要求)</div>
      {impact && (
        <div className="banner" role="region" aria-label="要求変更の影響分析">
          <strong>{impact.requirementId.split("::").pop()} を変更したときに影響しうる範囲</strong>(機械的にたどった結果です。影響の有無は人が判断してください)
          <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
            <li>関連する要求: {impact.requirements.map((x) => x.split("::").pop()).join("、") || "なし"}</li>
            <li>構造要素: {impact.elements.map(nm).join("、") || "なし"}</li>
            <li>機能 {impact.functions.length} 件 / 故障ノード {impact.failures.length} 件</li>
            <li>見直す FMEA: {impact.fmeaElements.map(nm).join("、") || "なし"}</li>
            <li>意図機能: {impact.intendedFunctions.join("、") || "なし"} / 安全機構: {impact.mechanisms.join("、") || "なし"} / ペア: {impact.pairs.join("、") || "なし"} / 分解: {impact.decompositions.join("、") || "なし"}</li>
          </ul>
          <details><summary>経路</summary><ul style={{ margin: "4px 0", paddingLeft: 20 }}>{impact.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></details>
        </div>
      )}
      {t.links.length > 0 && <div><strong>要求の導出</strong><ul style={{ margin: "4px 0", paddingLeft: 20 }}>{t.links.map((l, i) => <li key={i}>{l.from} → {l.to}({l.kind === "derives" ? "導出" : l.kind === "refines" ? "詳細化" : "ASIL 分解"})</li>)}</ul></div>}
    </div>
  );
}

const VP_TAB: Record<string, TabKey> = { requirements: "trace", structure: "fmea", behavior: "fmea", safety: "fmea" };

export function IssuesView() {
  const a = useStore((s) => s.analysis);
  const focus = useStore((s) => s.focusIssue);
  const [sev, setSev] = useState("all");
  if (!a) return <div className="empty">問題を表示できません</div>;
  const list = a.issues.filter((i) => (sev === "all" || i.severity === sev) && (!focus?.viewpoint || i.viewpoint === focus.viewpoint) && (!focus?.level || (i.elementId !== undefined ? a.levelOf[i.elementId] : a.levelOf[a.net.elements.find((e) => !e.parentId)?.id ?? ""]) === focus.level));
  return (
    <div className="stack" style={{ minHeight: 0 }}>
      <div className="row">
        <label className="row"><span className="muted">重大度</span><select aria-label="重大度で絞り込み" value={sev} onChange={(e) => setSev(e.target.value)}><option value="all">すべて</option><option value="error">エラー</option><option value="warning">警告</option></select></label>
        {focus && <span className="badge accent">絞り込み: {focus.level ? LEVELS.find((l) => l.key === focus.level)?.label : "全階層"} × {focus.viewpoint ? VIEWPOINTS.find((v) => v.key === focus.viewpoint)?.label : "全視点"} <button className="btn small" onClick={clearIssueFocus} aria-label="絞り込みを解除">✕</button></span>}
        <button className="btn small" onClick={() => void exportFile("issues.csv")}>CSV 出力</button>
        <span role="status">{list.length} 件</span>
      </div>
      <div style={{ overflow: "auto" }} tabIndex={0} role="region" aria-label="問題の一覧(スクロールできます)">
        <table className="grid" aria-label="問題の一覧">
          <thead><tr><th>重大度</th><th>視点</th><th>階層</th><th>内容</th><th>対象</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={5} className="muted">該当する問題はありません</td></tr>}
            {list.map((i, k) => (
              <tr key={k}>
                <td><SeverityBadge s={i.severity} /></td>
                <td>{VIEWPOINTS.find((v) => v.key === i.viewpoint)?.label}</td>
                <td>{i.elementId !== undefined ? levelLabel(a.levelOf[i.elementId] ?? "system") : "—"}</td>
                <td>{i.message} <span className="muted">({i.code})</span></td>
                <td>{i.elementId !== undefined ? <button className="btn small" onClick={() => { select(i.elementId); openTab(VP_TAB[i.viewpoint] ?? "fmea"); }}>{a.net.elements.find((e) => e.id === i.elementId)?.name}</button> : last(i.ref ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HistoryView() {
  const h = useStore((s) => s.history);
  const rev = useStore((s) => s.server?.revision);
  const chain = useStore((s) => s.auditChain);
  if (h.length === 0) return <div className="empty">履歴がありません</div>;
  const KIND = { model: "モデル", safety: "安全データ", restore: "復元", create: "作成" } as const;
  return (
    <div style={{ overflow: "auto" }} tabIndex={0} role="region" aria-label="履歴(スクロールできます)">
      {chain && (
        <div className="row" role="status" style={{ margin: "4px 0" }}>
          <span className={`badge ${chain.ok ? "ok" : "err"}`} title="監査ログの各行は直前の行のハッシュを持ち、途中の行の改ざん・削除を検出できます(末尾の削除は検出できません)">
            監査ログ {chain.ok ? `整合(${chain.lines} 件)` : `不整合(${chain.brokenAtLine} 行目)`}
          </span>
        </div>
      )}
      <table className="grid" aria-label="履歴">
        <thead><tr><th className="num">rev</th><th>日時</th><th>操作者</th><th>種別</th><th>メッセージ</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>
          {h.map((x) => (
            <tr key={x.revision} className={x.revision === rev ? "sel" : ""}>
              <td className="num">{x.revision}</td><td>{new Date(x.ts).toLocaleString("ja-JP")}</td><td>{x.actor}</td><td>{KIND[x.kind]}</td><td>{x.message}</td>
              <td>{x.revision === rev ? <span className="badge accent">現在</span> : <button className="btn small" onClick={() => { if (window.confirm(`リビジョン ${x.revision} に戻します(現在の内容も履歴に残ります)。よろしいですか?`)) void restoreRevision(x.revision); }}>この版に戻す</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 安全分析データ(JSON)を直接編集する。全項目を編集できる。スキーマで検証してから反映する。 */
export function DataView() {
  const safety = useStore((s) => s.draftSafety);
  const [text, setText] = useState<string | undefined>();
  const [errors, setErrors] = useState<string[]>([]);
  if (!safety) return <div className="empty">データを表示できません</div>;
  const shown = text ?? JSON.stringify(safety, null, 2);
  const apply = () => {
    let raw: unknown;
    try {
      raw = JSON.parse(shown);
    } catch (e) {
      setErrors([`JSON として解釈できません: ${(e as Error).message}`]);
      return;
    }
    const r = parseSafetyData(raw);
    if (!r.ok) return setErrors(r.errors);
    setErrors([]);
    replaceSafety(r.data);
    setText(undefined);
  };
  return (
    <div className="stack" style={{ minHeight: 0, flex: 1 }}>
      <div className="row">
        <button className="btn small primary" onClick={apply} disabled={text === undefined}>検証して反映</button>
        <button className="btn small" onClick={() => { setText(undefined); setErrors([]); }} disabled={text === undefined}>編集を取り消す</button>
        <span className="muted">AP 表は <code>apTable</code>(s・o・d の範囲と H/M/L)に設定します。反映後、右上の「保存」で確定します。</span>
      </div>
      <textarea aria-label="安全分析データ(JSON)" spellCheck={false} value={shown} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minHeight: 200, fontFamily: "var(--mono)", fontSize: 12.5, whiteSpace: "pre" }} />
      {errors.length > 0 && <ul role="alert" style={{ margin: 0, paddingLeft: 18, color: "var(--err)" }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </div>
  );
}
