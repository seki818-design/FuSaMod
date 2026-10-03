// 大規模データでの性能計測。結果を docs/quality/evidence/performance.md に出力し、予算を超えたら失敗する。
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeProject, recomputePuzzle, fmeaCsv, type SafetyData, emptySafetyData } from "../../packages/analysis/src/index.ts";
import { deriveNet, type ElementGraph, type GraphElement } from "../../packages/sysml-graph/src/index.ts";
import { layoutNested } from "../../apps/web/src/lib/layout.ts";
import { structureTree } from "../../apps/web/src/lib/structure.ts";
import { layoutScdl } from "../../apps/web/src/lib/scdl-layout.ts";

/** n 個の part を持つ、分岐 4 の木のモデルと、各部品に 1 つの機能・2 つの故障ノードを持つ安全データを作る。 */
function synth(n: number): { graph: ElementGraph; safety: SafetyData } {
  const elements: GraphElement[] = [{ kind: "PartUsage", qualifiedName: "S::p0", name: "p0", owner: "S" }];
  const actions: GraphElement[] = [];
  for (let i = 1; i < n; i++) {
    const parent = Math.floor((i - 1) / 4);
    elements.push({ kind: "PartUsage", qualifiedName: `S::p${i}`, name: `p${i}`, owner: `S::p${parent}` });
  }
  for (let i = 0; i < n; i++) actions.push({ kind: "ActionUsage", qualifiedName: `S::p${i}::f`, name: "f", owner: `S::p${i}`, parameters: [{ name: "out", direction: "out", type: "Real" }] });
  const safety = emptySafetyData();
  for (let i = 0; i < n; i++) {
    safety.failures.push({ id: `FM${i}`, description: `p${i} の故障モード`, functionId: `S::p${i}::f`, ...(i === 0 ? { severity: 9 } : {}) });
    if (i > 0) safety.links.push({ id: `L${i}`, causeId: `FM${i}`, effectId: `FM${Math.floor((i - 1) / 4)}`, occurrence: 3, detection: 4 });
  }
  return { graph: { elements: [...elements, ...actions], dependencies: [], metadata: [], satisfies: [], performs: [] }, safety };
}

function time<T>(f: () => T, runs = 3): { ms: number; value: T } {
  let best = Infinity;
  let value!: T;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    value = f();
    best = Math.min(best, performance.now() - t);
  }
  return { ms: best, value };
}

const sizes = [100, 1000, 5000];
const budgets: Record<number, { analyze: number; layout: number }> = { 100: { analyze: 150, layout: 100 }, 1000: { analyze: 1500, layout: 800 }, 5000: { analyze: 12000, layout: 4000 } };
const rows: string[] = [];
let over = false;
for (const n of sizes) {
  const { graph, safety } = synth(n);
  const d = time(() => deriveNet(graph), 2);
  const a = time(() => analyzeProject(graph, safety), 2);
  const analysis = a.value;
  const p = time(() => recomputePuzzle(analysis, { excludeSources: ["consistency"] }), 5);
  const l = time(() => layoutNested(structureTree(analysis)), 2);
  const c = time(() => fmeaCsv(analysis), 2);
  const sc = time(() => layoutScdl(analysis.scdl), 2);
  const json = JSON.stringify(analysis).length;
  const ok = a.ms <= budgets[n]!.analyze && l.ms <= budgets[n]!.layout;
  if (!ok) over = true;
  rows.push(`| ${n} | ${d.ms.toFixed(0)} | ${a.ms.toFixed(0)} | ${p.ms.toFixed(1)} | ${l.ms.toFixed(0)} | ${sc.ms.toFixed(0)} | ${c.ms.toFixed(0)} | ${(json / 1e6).toFixed(1)} | ${ok ? "✓" : "✕ 予算超過"} |`);
}
const md = [
  "# 性能(合成データ)",
  "",
  `計測日: ${new Date().toISOString().slice(0, 10)} / 計測: \`pnpm bench\`(Node ${process.version}、各 2〜5 回の最良値)`,
  "",
  "合成データ: 分岐 4 の木の構造要素 N 個。各要素に 1 つの機能と 1 つの故障モード(親の故障モードへリンク)。",
  "",
  "| 構造要素 N | 導出(ms) | 一括解析(ms) | パズル再計算(ms) | 構造図レイアウト(ms) | SCDL レイアウト(ms) | FMEA CSV(ms) | 解析結果 JSON(MB) | 予算 |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows,
  "",
  "予算(一括解析 / レイアウト): N=100 → 150 / 100 ms、N=1000 → 1.5 / 0.8 s、N=5000 → 12 / 4 s。実用上の典型的なプロジェクト(数十〜数百要素)では、編集のたびにブラウザ内で再解析しても体感の遅延は無い。",
  "",
  "SysML の解析(公式実装): 起動 約 6〜8 秒(1 回のみ)、その後の 1 回の解析は 0.2〜1 秒(`FUSAMOD_IT=1 pnpm test:integration` で確認)。",
  "",
].join("\n");
// 追跡ファイルを書き換えるのは --write のときだけ（通常の実行で作業ツリーを汚さない）
if (process.argv.includes("--write")) writeFileSync(resolve(import.meta.dirname, "../../docs/quality/evidence/performance.md"), md);
console.log(md);
process.exit(over ? 1 : 0);
