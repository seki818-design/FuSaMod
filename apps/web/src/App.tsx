import { useEffect } from "react";
import { AiPanel } from "./components/AiPanel.js";
import { AnalysisTabs } from "./components/AnalysisTabs.js";
import { LoginDialog, Toasts } from "./components/Chrome.js";
import { Explorer } from "./components/Explorer.js";
import { PuzzleView } from "./components/PuzzleView.js";
import { TopBar } from "./components/TopBar.js";
import { ViewSpace } from "./components/ViewSpace.js";
import { init, isDirty, save, setTheme, useStore, getState } from "./store.js";

export function App() {
  const loading = useStore((s) => s.busy.loading);
  const ready = useStore((s) => s.ready);
  const hasProject = useStore((s) => s.projectId !== undefined);
  const max = useStore((s) => s.analysisMax);
  const readOnly = useStore((s) => s.me?.role === "viewer");
  useEffect(() => {
    let theme: "dark" | "light" = "dark";
    try {
      const t = localStorage.getItem("fusamod.theme");
      if (t === "light" || t === "dark") theme = t; // 保存した設定があれば従う。既定はダーク
    } catch { /* 既定 */ }
    setTheme(theme);
    void init();
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (isDirty(getState())) void save();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty(getState())) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);
  return (
    <div className="app" data-readonly={readOnly ? "true" : undefined}>
      <a className="skip" href="#main">本文へ移動</a>
      <TopBar />
      <main id="main" className="main" aria-busy={loading}>
        {!ready ? <div className="empty" role="status">読み込み中…</div> : !hasProject ? <div className="empty">プロジェクトがありません。右上の「＋ 新規」で作成してください。</div> : (
          <>
            <Explorer />
            <div className={`center ${max ? "max" : ""}`}>{!max && <ViewSpace />}<AnalysisTabs /></div>
            <div className="right"><AiPanel /><PuzzleView /></div>
          </>
        )}
      </main>
      <Toasts />
      <LoginDialog />
    </div>
  );
}
