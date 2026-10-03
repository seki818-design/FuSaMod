import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** リポジトリのルート(pnpm-workspace.yaml のある場所)。ビルド後(dist/)でもソース実行でも同じ場所を指す。 */
function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}
export const REPO_ROOT = findRoot();

export type Role = "editor" | "viewer";
export const MIN_TOKEN_LENGTH = 16;
const FORMAT = "FUSAMOD_TOKENS は ユーザー名[/editor|viewer]:トークン をカンマ区切りで指定してください";

/** FUSAMOD_TOKENS の解析。トークンは 16 文字以上・重複不可、ユーザー名の重複不可。 */
export function parseTokens(raw: string): Config["tokens"] {
  const out: Config["tokens"] = [];
  for (const x of raw.split(",").map((v) => v.trim()).filter(Boolean)) {
    const i = x.indexOf(":");
    if (i <= 0 || i === x.length - 1) throw new Error(FORMAT);
    const [user, role = "editor", extra] = x.slice(0, i).split("/");
    const token = x.slice(i + 1);
    if (!user || extra !== undefined || (role !== "editor" && role !== "viewer")) throw new Error(FORMAT);
    if (token.length < MIN_TOKEN_LENGTH) throw new Error(`トークンは ${MIN_TOKEN_LENGTH} 文字以上にしてください(ユーザー: ${user})。例: openssl rand -hex 24`);
    if (out.some((t) => t.token === token)) throw new Error("FUSAMOD_TOKENS に同じトークンが複数あります");
    if (out.some((t) => t.user === user)) throw new Error(`FUSAMOD_TOKENS のユーザー名が重複しています: ${user}`);
    out.push({ user, role: role as Role, token });
  }
  return out;
}

export interface Config {
  port: number;
  host: string;
  projectsDir: string;
  /** java: 公式パイロット実装を常駐 / snapshot: 保存済みグラフのみ / auto: Java が使えれば java */
  sysmlMode: "java" | "snapshot" | "auto";
  sysmlCacheDir: string;
  /** "ユーザー名[/役割]:トークン" をカンマ区切り。空なら認証なし(ローカル利用)。役割は editor(既定)か viewer(読み取り専用)。 */
  tokens: { token: string; user: string; role: Role }[];
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
  const tokens = parseTokens(env["FUSAMOD_TOKENS"] ?? "");
  const webDist = resolve(env["FUSAMOD_WEB_DIST"] ?? resolve(REPO_ROOT, "apps/web/dist"));
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
