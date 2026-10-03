import { useRef } from "react";
import { analyzeModelNow, setDraftModel, useStore } from "../store.js";

/** SysML v2 のテキスト編集。入力の少し後に、公式実装で解析し、診断を表示する。 */
export function TextEditor() {
  const text = useStore((s) => s.draftModel);
  const diags = useStore((s) => s.diagnostics);
  const ok = useStore((s) => s.modelOk);
  const sysmlError = useStore((s) => s.sysmlError);
  const analyzing = useStore((s) => s.busy.analyzing);
  const mode = useStore((s) => s.health?.sysml);
  const ta = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = text.split("\n").length;

  const jump = (line?: number, col?: number) => {
    const el = ta.current;
    if (!el || !line) return;
    const ls = text.split("\n");
    const pos = ls.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + Math.max(0, (col ?? 1) - 1);
    el.focus();
    el.setSelectionRange(pos, pos);
    el.scrollTop = Math.max(0, (line - 4) * 19.5);
  };
  return (
    <div className="stack" style={{ minHeight: 0, flex: 1 }}>
      {mode !== "java" && <div className="banner" role="note">Java(公式実装)が使えないため、保存済みのモデルだけを解析できます。編集した内容は、保存はできますが解析されません。</div>}
      <div className="editor">
        <div className="gutter" ref={gutter} aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join("\n")}</div>
        <textarea ref={ta} aria-label="SysML v2 のモデル(テキスト)" spellCheck={false} value={text} onChange={(e) => setDraftModel(e.target.value)}
          onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }} />
      </div>
      <div className="row">
        <button className="btn small" onClick={() => void analyzeModelNow()} disabled={analyzing}>今すぐ解析</button>
        <span role="status" className={ok ? "badge ok" : "badge err"}>{analyzing ? "解析中…" : ok ? "✓ エラーなし" : `✕ エラー ${diags.filter((d) => d.severity === "error").length || "あり"}`}</span>
        {sysmlError && <span className="muted">{sysmlError}</span>}
      </div>
      {diags.length > 0 && (
        <ul className="diag" aria-label="解析の診断" style={{ margin: 0, paddingLeft: 16, maxHeight: 110, overflow: "auto" }}>
          {diags.map((d, i) => (
            <li key={i}><button onClick={() => jump(d.line, d.column)} className={d.severity === "error" ? "e" : "w"}>{d.line ? `${d.line}:${d.column ?? 1} ` : ""}{d.message}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
