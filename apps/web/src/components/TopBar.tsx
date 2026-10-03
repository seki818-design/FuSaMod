import { useState } from "react";
import { createProject, discard, exportFile, getState, isDirty, save, selectProject, setTheme, useStore } from "../store.js";

const EXPORTS: { value: string; label: string; query?: string }[] = [
  { value: "fmea.csv", label: "FMEA(CSV)" },
  { value: "trace.csv", label: "トレース(CSV)" },
  { value: "issues.csv", label: "指摘(CSV)" },
  { value: "report.md", label: "レポート(Markdown)" },
  { value: "scdl.sysml", label: "SCDL ビュー(SysML v2)" },
  { value: "model.sysml", label: "モデル(SysML v2)" },
  { value: "analysis.json", label: "解析結果(JSON)" },
];

export function TopBar() {
  const s = useStore((x) => x);
  const dirty = isDirty(s);
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");
  const [exp, setExp] = useState("fmea.csv");
  const valid = /^[a-z0-9][a-z0-9-]{0,63}$/.test(newId);
  return (
    <header className="topbar" role="banner">
      <div className="brand">
        <span aria-hidden="true">◆</span> FuSaMod <small>システムモデリングと機能安全分析</small>
      </div>
      <label className="row">
        <span className="sr-only">プロジェクト</span>
        <select aria-label="プロジェクト" value={s.projectId ?? ""} onChange={(e) => void selectProject(e.target.value)}>
          {s.projects.length === 0 && <option value="">(なし)</option>}
          {s.projects.map((p) => (
            <option key={p.id} value={p.id}>{p.id}</option>
          ))}
        </select>
      </label>
      {adding ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) {
              void createProject(newId);
              setAdding(false);
              setNewId("");
            }
          }}
        >
          <input type="text" aria-label="新しいプロジェクトの ID" placeholder="英小文字・数字・ハイフン" value={newId} onChange={(e) => setNewId(e.target.value)} aria-invalid={newId !== "" && !valid} />
          <button className="btn small primary" disabled={!valid}>作成</button>
          <button type="button" className="btn small" onClick={() => setAdding(false)}>取消</button>
        </form>
      ) : (
        <button className="btn small" onClick={() => setAdding(true)} aria-label="プロジェクトを追加">＋ 新規</button>
      )}
      {s.server && <span className="badge accent" title="保存済みのリビジョン">rev {s.server.revision}</span>}
      {dirty && <span className="badge warn" role="status">● 未保存の変更</span>}
      {s.busy.analyzing && <span className="muted" role="status">解析中…</span>}
      <div className="grow" />
      <span className={`badge ${s.health?.sysml === "java" ? "ok" : "warn"}`} title="SysML v2 の解析方式">
        SysML: {s.health?.sysml === "java" ? "公式実装" : "保存済みのみ"}
      </span>
      <span className="badge undet" title="AI の提供元">AI: {s.health?.ai ?? "-"}</span>
      {s.me?.role === "viewer" && <span className="badge warn" title="この利用者は読み取り専用です(保存・AI の提案・復元はできません)">読み取り専用</span>}
      <button className="btn primary" onClick={() => void save()} disabled={!dirty || s.busy.saving || s.me?.role === "viewer"} title={s.me?.role === "viewer" ? "読み取り専用のため保存できません" : "Ctrl+S"}>
        {s.busy.saving ? "保存中…" : "保存"}
      </button>
      <button className="btn" onClick={() => discard()} disabled={!dirty}>変更を破棄</button>
      <label className="row">
        <span className="sr-only">出力する形式</span>
        <select aria-label="出力する形式" value={exp} onChange={(e) => setExp(e.target.value)}>
          {EXPORTS.map((x) => (
            <option key={x.value} value={x.value}>{x.label}</option>
          ))}
        </select>
        <button className="btn" onClick={() => void exportFile(exp)} disabled={!s.projectId}>出力</button>
      </label>
      <button className="btn" onClick={() => setTheme(getState().theme === "dark" ? "light" : "dark")} aria-label="テーマを切り替え" title="ダーク/ライト">
        {s.theme === "dark" ? "☀" : "☾"}
      </button>
    </header>
  );
}
