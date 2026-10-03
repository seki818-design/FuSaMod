import { useMemo, useState } from "react";
import { faultTreeFromNet, minimalCutSets, topProbabilityUpperBound, validateFaultTree, type FaultTree } from "@fusamod/safety-core";
import { layoutFaultTree } from "../lib/fta-layout.js";
import { updateSafety, useStore } from "../store.js";
import { fit, nextId } from "../ui.js";

type Calc = { issues: ReturnType<typeof validateFaultTree>; cuts?: ReturnType<typeof minimalCutSets>; prob?: number };

/** 表示するフォールトツリー(保存済み、または故障ネットから導出)と、その計算結果。 */
function useFaultTree() {
  const a = useStore((s) => s.analysis);
  const safety = useStore((s) => s.draftSafety);
  const [pick, setPick] = useState<string>("");
  const saved = useMemo(() => safety?.faultTrees ?? [], [safety]);
  const tops = useMemo(() => (a ? a.net.failures.filter((f) => !a.net.links.some((l) => l.causeId === f.id)) : []), [a]);
  const choice = pick || (saved[0] ? `saved:${saved[0].id}` : tops[0] ? `net:${tops[0].id}` : "");
  const tree: FaultTree | undefined = useMemo(() => {
    if (!a || !choice) return undefined;
    return choice.startsWith("saved:") ? saved.find((t) => t.id === choice.slice(6)) : faultTreeFromNet(a.net, choice.slice(4));
  }, [a, choice, saved]);
  const calc: Calc | undefined = useMemo(() => {
    if (!tree) return undefined;
    const issues = validateFaultTree(tree);
    if (issues.some((i) => i.severity === "error" && i.code !== "FT_UNDEVELOPED")) return { issues };
    return { issues, cuts: minimalCutSets(tree), prob: topProbabilityUpperBound(tree) };
  }, [tree]);
  return { ready: !!a && !!safety, saved, tops, choice, setPick, tree, calc, isSaved: choice.startsWith("saved:") };
}

function Summary({ calc, singles }: { calc: Calc | undefined; singles: Set<string> }) {
  const incomplete = !!calc?.cuts && (calc.cuts.truncated || calc.cuts.problems.length > 0);
  return (
    <div className="row" role="status">
      <span className="badge undet">最小カットセット {calc?.cuts?.cutSets.length ?? "—"}</span>
      {incomplete ? (
        <span className="badge warn" title="結果が不完全なため、単一故障の有無は判定できません">単一故障 判定不可</span>
      ) : (
        <span className={`badge ${singles.size ? "err" : "ok"}`}>単一故障 {calc?.cuts ? singles.size : "—"}</span>
      )}
      {calc?.prob !== undefined && <span className="badge accent" title="独立を仮定した上限(Esary-Proschan)">頂上事象確率の上限 {calc.prob.toExponential(2)} /h</span>}
      {calc?.cuts?.truncated && <span className="badge warn">展開を打ち切りました(結果は不完全)</span>}
      {calc?.cuts?.problems.map((p) => <span key={p} className="badge err">{p}</span>)}
    </div>
  );
}

function CutSets({ tree, calc }: { tree: FaultTree; calc: Calc | undefined }) {
  const label = (id: string) => tree.nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <strong>最小カットセット</strong>
      <ol style={{ margin: "4px 0", paddingLeft: 20 }}>
        {(calc?.cuts?.cutSets ?? []).slice(0, 30).map((c, i) => (
          <li key={i}>{c.map(label).join(" × ")}{c.length === 1 && <span className="badge err" style={{ marginLeft: 6 }}>単一故障</span>}</li>
        ))}
      </ol>
    </div>
  );
}

function Probabilities({ tree }: { tree: FaultTree }) {
  const setProb = (nodeId: string, v: string) =>
    updateSafety((d) => {
      const n = d.faultTrees.find((t) => t.id === tree.id)?.nodes.find((x) => x.id === nodeId);
      if (!n) return;
      if (v === "") delete n.probability; else n.probability = Math.min(1, Math.max(0, Number(v)));
    });
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <strong>基本事象の発生確率(/h)</strong>
      {tree.nodes.filter((n) => n.kind === "basic").map((n) => (
        <label key={n.id} className="row"><span style={{ flex: 1 }}>{n.label}</span><input type="number" step="any" min={0} max={1} aria-label={`${n.label} の確率`} value={n.probability ?? ""} onChange={(e) => setProb(n.id, e.target.value)} style={{ width: 110 }} /></label>
      ))}
      <div className="muted">デモの値は説明用の仮のものです。</div>
    </div>
  );
}

/** フォールトツリー。故障ネットから導出するか、保存したツリー(AND/OR・確率つき)を表示する。単一故障は赤で示す。 */
export function FtaView() {
  const { ready, saved, tops, choice, setPick, tree, calc, isSaved } = useFaultTree();
  if (!ready) return <div className="empty">FTA を表示できません</div>;
  if (!tree) return <div className="empty">頂上事象にできる故障ノードがありません。先に FMEA で故障ノードを作成してください。</div>;
  const singles = new Set((calc?.cuts?.cutSets ?? []).filter((c) => c.length === 1).map((c) => c[0]!));
  return (
    <div className="stack" style={{ minHeight: 0 }}>
      <div className="row">
        <label className="row"><span className="muted">頂上事象</span>
          <select aria-label="フォールトツリーの選択" value={choice} onChange={(e) => setPick(e.target.value)}>
            {saved.map((t) => <option key={t.id} value={`saved:${t.id}`}>保存済み: {t.name}</option>)}
            {tops.map((f) => <option key={f.id} value={`net:${f.id}`}>故障ネットから導出: {f.description}</option>)}
          </select>
        </label>
        {!isSaved && <button className="btn small" onClick={() => updateSafety((d) => { d.faultTrees.push({ ...tree, id: nextId("FT", d.faultTrees.map((t) => t.id)), name: `${tree.name}(導出)` }); })}>このツリーを保存</button>}
        <span className="muted">OR = いずれか / AND = すべて。</span>
      </div>
      <Summary calc={calc} singles={singles} />
      <FtaDiagram tree={tree} drawing={layoutFaultTree(tree)} singles={singles} />
      <div className="row" style={{ alignItems: "flex-start" }}>
        <CutSets tree={tree} calc={calc} />
        {isSaved && <Probabilities tree={tree} />}
      </div>
      {calc?.issues.filter((i) => i.code !== "FT_UNDEVELOPED").map((i, k) => <div key={k} className={i.severity === "error" ? "badge err" : "badge warn"}>{i.message}</div>)}
      {calc?.issues.some((i) => i.code === "FT_UNDEVELOPED") && <div className="muted">未展開の事象があります(原因が未分析)。FMEA で原因を追加してください。</div>}
    </div>
  );
}

function FtaDiagram({ tree, drawing, singles }: { tree: FaultTree; drawing: ReturnType<typeof layoutFaultTree>; singles: Set<string> }) {
  return (
    <div className="diagram" role="region" style={{ minHeight: 170 }} tabIndex={0} aria-label="フォールトツリー">
        <svg width={drawing.width} height={drawing.height} role="group" aria-label={`フォールトツリー: ${tree.name}`}>
          {drawing.edges.map((e, i) => {
            const f = drawing.boxes.find((b) => b.id === e.from)!, t = drawing.boxes.find((b) => b.id === e.to)!;
            return <path key={i} d={`M${f.x + f.w / 2},${f.y + f.h} L${t.x + t.w / 2},${t.y}`} stroke="var(--muted)" strokeWidth={1.5} fill="none" />;
          })}
          {drawing.boxes.map((b) => (
            <g key={b.id} role="img" aria-label={`${b.node.kind === "gate" ? (b.node.gate === "and" ? "AND ゲート" : "OR ゲート") : "基本事象"}: ${b.node.label}${singles.has(b.id) ? "(単一故障)" : ""}`}>
              <rect className={b.node.kind === "gate" ? "fta-gate" : `fta-box ${singles.has(b.id) ? "fta-single" : ""}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={b.node.kind === "gate" ? 22 : 6} />
              <text x={b.x + 8} y={b.y + 18} fontSize={11} style={{ fill: "var(--accent-text)" }}>{b.node.kind === "gate" ? (b.node.gate === "and" ? "AND" : "OR") : b.node.undeveloped ? "未展開" : "基本事象"}{b.node.probability !== undefined ? `  p=${b.node.probability}` : ""}</text>
              <text x={b.x + 8} y={b.y + 36} fontSize={12}><title>{b.node.label}</title>{fit(b.node.label, 22)}</text>
            </g>
          ))}
        </svg>
      </div>
  );
}
