// E2E 用: デモプロジェクトを一時ディレクトリにコピーして、サーバーを起動する(Java 無しでも動くスナップショット方式)。
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const dir = mkdtempSync(join(tmpdir(), "fusamod-e2e-"));
cpSync(join(repo, "projects/ev-powertrain"), join(dir, "ev-powertrain"), { recursive: true });
const child = spawn("pnpm", ["--filter", "@fusamod/server", "exec", "tsx", "src/main.ts"], {
  cwd: repo,
  stdio: "inherit",
  env: { ...process.env, PORT: process.env.E2E_PORT ?? "8799", FUSAMOD_PROJECTS: dir, FUSAMOD_SYSML: process.env.E2E_SYSML ?? "snapshot", FUSAMOD_AI_PROVIDER: "rule" },
});
const stop = () => { child.kill("SIGTERM"); try { rmSync(dir, { recursive: true, force: true }); } catch { /* 無視 */ } };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (c) => { stop(); process.exit(c ?? 0); });
