import { execFileSync } from "node:child_process";
import { ClaudeProvider, RuleBasedProvider, type AiProvider } from "@fusamod/ai";
import { buildApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { ProjectStore } from "./projects.js";
import { AnalysisService, FallbackSysmlService } from "./services.js";
import { JavaSysmlService } from "./sysml/java-service.js";
import { SnapshotSysmlService } from "./sysml/snapshot-service.js";

const config = loadConfig();
const store = new ProjectStore(config.projectsDir);
const log = (m: string) => console.error(`[fusamod] ${m}`);

function javaAvailable(): boolean {
  try {
    execFileSync("java", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function makeSysml(c: Config) {
  const snapshot = new SnapshotSysmlService((h) => store.findGraphByModelHash(h));
  if (c.sysmlMode === "snapshot") return snapshot;
  const java = new JavaSysmlService({ log, env: { SYSML_PILOT_CACHE: c.sysmlCacheDir } });
  if (c.sysmlMode === "java") return java;
  if (!javaAvailable()) {
    log("Java が見つかりません。保存済みのモデルのみ解析できます(スナップショット方式)");
    return snapshot;
  }
  return new FallbackSysmlService(java, snapshot, log);
}

function makeAi(c: Config): AiProvider {
  if (c.ai.provider === "claude") {
    log(`AI: Claude(${c.ai.model})を使います。プロジェクトの要約が外部サービスに送信されます`);
    return new ClaudeProvider({ ...(c.ai.apiKey ? { apiKey: c.ai.apiKey } : {}), model: c.ai.model, maxContextChars: c.ai.maxRefChars });
  }
  return new RuleBasedProvider();
}

const sysml = makeSysml(config);
const app = await buildApp({
  config,
  store,
  analysis: new AnalysisService(sysml, log),
  ai: makeAi(config),
  logger: { level: "info", redact: ["req.headers.authorization"] },
});

const shutdown = async () => {
  await app.close();
  await sysml.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
log(`http://${config.host}:${config.port}(プロジェクト: ${config.projectsDir}、SysML: ${config.sysmlMode}、AI: ${config.ai.provider})`);
if (!["127.0.0.1", "::1", "localhost"].includes(config.host) && config.tokens.length === 0) log("警告: 認証なしで外部に公開されています。FUSAMOD_TOKENS を設定してください");
