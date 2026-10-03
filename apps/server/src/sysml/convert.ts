import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REPO_ROOT } from "../config.js";
import { SysmlUnavailableError } from "./types.js";

export type ConvertFormat = "json" | "xmi";

/**
 * SysML v2 テキストを、公式パイロット実装の変換器で標準の形式に変換する(エクスポートのみ。取り込みは未対応)。
 *  - json: SysML v2 API の JSON 形式(elementId つきの要素の配列)
 *  - xmi : XMI(.sysmlx)
 * Java が無い・変換に失敗した場合は SysmlUnavailableError。
 */
export async function convertModel(text: string, format: ConvertFormat, opts: { cacheDir?: string; timeoutMs?: number } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fusamod-convert-"));
  try {
    const input = join(dir, "model.sysml");
    await writeFile(input, text, "utf8");
    const script = resolve(REPO_ROOT, "tools/sysml-check/convert.sh");
    await new Promise<void>((done, fail) => {
      const proc = spawn(script, [format, input], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, ...(opts.cacheDir ? { SYSML_PILOT_CACHE: opts.cacheDir } : {}) } });
      let err = "";
      proc.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        fail(new SysmlUnavailableError("変換がタイムアウトしました"));
      }, opts.timeoutMs ?? 180_000);
      proc.on("error", (e) => {
        clearTimeout(timer);
        fail(new SysmlUnavailableError(`変換を起動できません(Java 21 が必要です): ${e.message}`));
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) done();
        else fail(new SysmlUnavailableError(`変換に失敗しました(終了コード ${code}): ${err.slice(-500)}`));
      });
    });
    return await readFile(join(dir, format === "json" ? "model.json" : "model.sysmlx"), "utf8");
  } catch (e) {
    if (e instanceof SysmlUnavailableError) throw e;
    throw new SysmlUnavailableError(`変換結果を読めません: ${(e as Error).message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
