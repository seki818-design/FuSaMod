import { VIEWPOINTS } from "@fusamod/analysis";
import { focusIssues, highlightElements, puzzleOf, setLayerConsistency, setPuzzleOnlyProblems, useStore } from "../store.js";
import { STATUS } from "../ui.js";

/** パズルビュー: 要求・構造・振る舞い・安全の 4 視点 × システム階層の整合。色だけでなく、記号と文字でも状態を示す。 */
export function PuzzleView() {
  const s = useStore((x) => x);
  const puzzle = puzzleOf(s);
  const only = s.puzzleOnlyProblems;
  return (
    <section className="panel" aria-label="パズルビュー">
      <header>
        <h2>パズルビュー</h2>
        <div className="grow" />
        <label className="row" style={{ fontSize: 12 }}><input type="checkbox" checked={s.layerConsistency} onChange={(e) => setLayerConsistency(e.target.checked)} />レイヤー整合性</label>
        <label className="row" style={{ fontSize: 12 }}><input type="checkbox" checked={only} onChange={(e) => setPuzzleOnlyProblems(e.target.checked)} />不整合のみ表示</label>
      </header>
      <div className="body">
        {!puzzle ? <div className="empty">モデルを解析できると表示します</div> : (
          <>
            <table className="puzzle" aria-label="視点と階層の整合">
              <thead><tr><th><span className="sr-only">階層</span></th>{VIEWPOINTS.map((v) => <th key={v.key} scope="col"><abbr title={v.en} style={{ textDecoration: "none" }}>{v.label}</abbr></th>)}</tr></thead>
              <tbody>
                {puzzle.levels.map((l) => (
                  <tr key={l.key}>
                    <th scope="row" className="lv">{l.label}<br /><span className="muted" style={{ fontWeight: 400 }}>{l.elementIds.length} 要素</span></th>
                    {VIEWPOINTS.map((v) => {
                      const c = puzzle.cells[l.key][v.key];
                      const st = STATUS[c.status];
                      const dim = only && c.status !== "inconsistent" && c.status !== "review";
                      return (
                        <td key={v.key}>
                          <button className={`pz ${st.cls} ${dim ? "dim" : ""}`} disabled={c.status === "none"} onClick={() => {
                              // 該当の要素を、ビュースペースの図でハイライトする(その視点で指摘のある要素は強調)。問題一覧も絞り込む
                              const withIssue = new Set((s.analysis?.issues ?? []).filter((i) => i.viewpoint === v.key && i.elementId && l.elementIds.includes(i.elementId)).map((i) => i.elementId!));
                              highlightElements(l.elementIds, [...withIssue], `${l.label}・${v.label}`);
                              focusIssues(l.key, v.key);
                            }}
                            aria-label={`${l.label}・${v.label}: ${st.label}、件数 ${c.count}、エラー ${c.errors}、警告 ${c.warnings}`}>
                            <b>{c.status === "none" ? "—" : c.count}</b>
                            <small>{st.icon} {st.label}{c.errors + c.warnings > 0 ? `(${c.errors + c.warnings})` : ""}</small>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="legend" aria-label="凡例" style={{ marginTop: 6 }}>
              <span>✓ 整合</span><span>▲ 要確認(警告あり)</span><span>✕ 不整合(エラーあり)</span><span>? 未確定(件数 0)</span><span>数字 = 件数 / ( ) = 指摘の数</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
