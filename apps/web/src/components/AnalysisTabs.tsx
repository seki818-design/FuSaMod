import { ConceptView } from "./ConceptView.js";
import { FmeaSheet } from "./FmeaSheet.js";
import { FtaView } from "./FtaView.js";
import { HaraView } from "./HaraView.js";
import { NetView } from "./NetView.js";
import { ScdlView } from "./ScdlView.js";
import { DataView, HistoryView, IssuesView, TraceView } from "./Views.js";
import { openTab, toggleAnalysisMax, useStore, type TabKey } from "../store.js";

const TABS: { key: TabKey; label: string }[] = [
  { key: "fmea", label: "FMEA シート" }, { key: "net", label: "エラーネット" }, { key: "fta", label: "FTA" }, { key: "hara", label: "ハザード分析" },
  { key: "concept", label: "安全コンセプト" }, { key: "scdl", label: "SCDL" }, { key: "trace", label: "要件トレース" }, { key: "issues", label: "問題" },
  { key: "history", label: "履歴" }, { key: "data", label: "データ" },
];

export function AnalysisTabs() {
  const tab = useStore((s) => s.tab);
  const issues = useStore((s) => (s.analysis ? s.analysis.summary.errors + s.analysis.summary.warnings : 0));
  const max = useStore((s) => s.analysisMax);
  const errors = useStore((s) => s.analysis?.summary.errors ?? 0);
  const body = { fmea: <FmeaSheet />, net: <NetView />, fta: <FtaView />, hara: <HaraView />, concept: <ConceptView />, scdl: <ScdlView />, trace: <TraceView />, issues: <IssuesView />, history: <HistoryView />, data: <DataView /> }[tab];
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const n = (i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    openTab(TABS[n]!.key);
    (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
  };
  return (
    <section className="panel" aria-label="分析">
      <div className="tabs">
        <div role="tablist" aria-label="分析の種類" style={{ display: "flex", gap: 2 }}>
        {TABS.map((t, i) => (
          <button key={t.key} role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls="analysis-body" tabIndex={tab === t.key ? 0 : -1} className="tab" onClick={() => openTab(t.key)} onKeyDown={(e) => onKey(e, i)}>
            {t.label}{t.key === "issues" && issues > 0 ? ` (${issues})` : ""}{t.key === "issues" && errors > 0 ? " ✕" : ""}
          </button>
        ))}
        </div>
        <span style={{ flex: 1 }} />
        <button className="tab" onClick={toggleAnalysisMax} aria-pressed={max} aria-label={max ? "分析パネルを元の大きさに戻す" : "分析パネルを最大化"} title={max ? "元の大きさに戻す" : "最大化"}>{max ? "⤡" : "⤢"}</button>
      </div>
      <div className="body" id="analysis-body" role="tabpanel" aria-labelledby={`tab-${tab}`} style={{ display: "flex", flexDirection: "column" }}>{body}</div>
    </section>
  );
}
