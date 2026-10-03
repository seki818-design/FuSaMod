// 各パッケージのカバレッジを計測し、docs/quality/evidence/coverage.md に集計する。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const targets = [
  { name: "@fusamod/safety-core", dir: "packages/safety-core", include: "src/**" },
  { name: "@fusamod/sysml-graph", dir: "packages/sysml-graph", include: "src/**" },
  { name: "@fusamod/scdl", dir: "packages/scdl", include: "src/**" },
  { name: "@fusamod/analysis", dir: "packages/analysis", include: "src/**" },
  { name: "@fusamod/ai", dir: "packages/ai", include: "src/**" },
  { name: "@fusamod/server", dir: "apps/server", include: "src/**", exclude: "src/main.ts" },
  { name: "@fusamod/web(ロジック層)", dir: "apps/web", include: "src/lib/**" },
];
const rows = [];
let failed = false;
for (const t of targets) {
  const args = ["--filter", t.name.replace(/\(.*$/, ""), "exec", "vitest", "run", "--coverage", "--coverage.provider=v8", "--coverage.reporter=json-summary", `--coverage.include=${t.include}`, ...(t.exclude ? [`--coverage.exclude=${t.exclude}`] : [])];
  try {
    execFileSync("pnpm", args, { cwd: root, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, FORCE_COLOR: "0" } });
  } catch {
    failed = true;
    console.error(`テストに失敗: ${t.name}`);
  }
  const f = resolve(root, t.dir, "coverage/coverage-summary.json");
  if (!existsSync(f)) continue;
  const total = JSON.parse(readFileSync(f, "utf8")).total;
  rows.push({ name: t.name, lines: total.lines, branches: total.branches, functions: total.functions, statements: total.statements });
}
const pct = (x) => `${x.pct}%(${x.covered}/${x.total})`;
const md = [
  "# カバレッジ(単体・結合テスト)",
  "",
  `計測日: ${new Date().toISOString().slice(0, 10)} / 計測: \`pnpm coverage\`(vitest + v8)`,
  "",
  "| パッケージ | 行 | 分岐 | 関数 |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${r.name} | ${pct(r.lines)} | ${pct(r.branches)} | ${pct(r.functions)} |`),
  "",
  "- ウェブの画面コンポーネント(React)は、単体テストのカバレッジではなく、Playwright の E2E(20 件)で確認している。",
  "- `apps/server/src/main.ts`(起動処理)は計測の対象外。公式 SysML 実装との結合は `pnpm test:integration` で確認する。",
  "",
].join("\n");
writeFileSync(resolve(root, "docs/quality/evidence/coverage.md"), md);
console.log(md);
const min = Math.min(...rows.map((r) => r.lines.pct));
console.log(`最小の行カバレッジ: ${min}%`);
const THRESHOLD = 80;
if (min < THRESHOLD) {
  console.error(`行カバレッジが基準(${THRESHOLD}%)を下回っています`);
  failed = true;
}
process.exit(failed ? 1 : 0);
