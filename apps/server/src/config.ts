import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");

export interface Config {
  port: number;
  host: string;
  projectsDir: string;
  /** java: 公式パイロット実装を常駐 / snapshot: 保存済みグラフのみ / auto: Java が使えれば java */
  sysmlMode: "java" | "snapshot" | "auto";
  sysmlCacheDir: string;
  /** "トークン:ユーザー名" をカンマ区切り。空なら認証なし(ローカル利用)。 */
  tokens: { token: string; user: string }[];
  /** 許可する CORS オリジン(空なら CORS 無効) */
  corsOrigin: string | undefined;
  webDist: string | undefined;
  ai: { provider: "rule" | "claude"; model: string; apiKey: string | undefined; maxRefChars: number };
  bodyLimit: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = (env["FUSAMOD_SYSML"] ?? "auto") as Config["sysmlMode"];
  if (!["java", "snapshot", "auto"].includes(mode)) throw new Error(`FUSAMOD_SYSML は java|snapshot|auto: ${mode}`);
  const provider = (env["FUSAMOD_AI_PROVIDER"] ?? "rule") as "rule" | "claude";
  if (!["rule", "claude"].includes(provider)) throw new Error(`FUSAMOD_AI_PROVIDER は rule|claude: ${provider}`);
  const tokens = (env["FUSAMOD_TOKENS"] ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf(":");
      if (i <= 0 || i === x.length - 1) throw new Error("FUSAMOD_TOKENS は トークン:ユーザー名 をカンマ区切りで指定してください");
      return { token: x.slice(0, i), user: x.slice(i + 1) };
    });
  const webDist = resolve(REPO_ROOT, "apps/web/dist");
  return {
    port: Number(env["PORT"] ?? 8787),
    host: env["HOST"] ?? "127.0.0.1",
    projectsDir: resolve(env["FUSAMOD_PROJECTS"] ?? resolve(REPO_ROOT, "projects")),
    sysmlMode: mode,
    sysmlCacheDir: env["FUSAMOD_SYSML_CACHE"] ?? resolve(homedir(), ".cache/fusamod/sysml-pilot-0.62.0"),
    tokens,
    corsOrigin: env["FUSAMOD_CORS_ORIGIN"],
    webDist: existsSync(webDist) ? webDist : undefined,
    ai: {
      provider,
      model: env["FUSAMOD_AI_MODEL"] ?? "claude-sonnet-5-5",
      apiKey: env["ANTHROPIC_API_KEY"],
      maxRefChars: Number(env["FUSAMOD_AI_MAX_REF_CHARS"] ?? 6000),
    },
    bodyLimit: 5 * 1024 * 1024,
  };
}
