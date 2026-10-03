import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { FastifyInstance } from "fastify";
import { RuleBasedProvider, type AiProvider } from "@fusamod/ai";
import { buildApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { ProjectStore } from "../src/projects.js";
import { AnalysisService } from "../src/services.js";
import { SnapshotSysmlService } from "../src/sysml/snapshot-service.js";
import type { SysmlService } from "../src/sysml/types.js";

const here = dirname(fileURLToPath(import.meta.url));
export const DEMO = resolve(here, "../../../projects/ev-powertrain");

export interface Harness {
  app: FastifyInstance;
  store: ProjectStore;
  root: string;
  config: Config;
  close(): Promise<void>;
}

/** デモプロジェクトを一時ディレクトリにコピーして、API を立てる。 */
export async function harness(opts: { env?: Record<string, string>; sysml?: (store: ProjectStore) => SysmlService; ai?: AiProvider } = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "fusamod-test-"));
  await cp(DEMO, join(root, "ev-powertrain"), { recursive: true });
  const config = loadConfig({ FUSAMOD_PROJECTS: root, ...opts.env });
  const store = new ProjectStore(root);
  // 初期の履歴(リビジョン 1)を作る
  const p = await store.read("ev-powertrain");
  await store.saveSafety("ev-powertrain", p.safety, "setup", "初期", undefined);
  const sysml = opts.sysml ? opts.sysml(store) : new SnapshotSysmlService((h) => store.findGraphByModelHash(h));
  const app = await buildApp({ config, store, analysis: new AnalysisService(sysml), ai: opts.ai ?? new RuleBasedProvider() });
  return { app, store, root, config, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}
