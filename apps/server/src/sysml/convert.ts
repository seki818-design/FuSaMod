import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REPO_ROOT } from "../config.js";
import { stabilizeJsonIds } from "./stable-ids.js";
import { SysmlUnavailableError } from "./types.js";

export type ConvertFormat = "json" | "xmi";

/** 入力(モデル)が原因で変換できなかった。呼び出し側は 422 で返す(一時パスなどの内部情報は含めない)。 */
export class ConvertError extends Error {}
/** 同時に変換できる数を超えた。呼び出し側は 429 で返す。 */
export class ConvertBusyError extends Error {}

const PREFIX = "fusamod-convert-";
/** 変換専用の一時ディレクトリ(利用者ごと、自分だけが読める)。共有の /tmp にある他人の作業を、起動時の掃除で消さないため */
function defaultRoot(): string {
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "u";
  return join(tmpdir(), `fusamod-${uid}`, "convert");
}
const MAX_RUNNING = 2;
const MAX_WAITING = 4;
let running = 0;
const waiting: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (running < MAX_RUNNING) {
    running++;
    return;
  }
  if (waiting.length >= MAX_WAITING) throw new ConvertBusyError("変換の待ちが多すぎます。しばらくしてからやり直してください");
  await new Promise<void>((resolveWait) => waiting.push(resolveWait));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

/** 前回の異常終了で残った一時ディレクトリを掃除する(起動時と、変換の前に呼ぶ)。 */
export async function sweepConvertTemp(maxAgeMs = 10 * 60_000, root: string = defaultRoot()): Promise<void> {
  try {
    for (const n of await readdir(root)) {
      if (!n.startsWith(PREFIX)) continue;
      const p = join(root, n);
      const st = await stat(p).catch(() => undefined);
      if (st && Date.now() - st.mtimeMs > maxAgeMs) await rm(p, { recursive: true, force: true });
    }
  } catch {
    /* 掃除に失敗しても変換は続ける */
  }
}

function run(script: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((done, fail) => {
    // プロセスグループごと止められるように、独立したグループで起動する
    const proc = spawn(script, args, { stdio: ["ignore", "ignore", "pipe"], env, detached: true });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString("utf8")).slice(-2000)));
    const killGroup = () => {
      try {
        if (proc.pid) process.kill(-proc.pid, "SIGKILL");
      } catch {
        /* すでに終了 */
      }
    };
    const timer = setTimeout(() => {
      killGroup();
      fail(new SysmlUnavailableError("変換がタイムアウトしました"));
    }, timeoutMs);
    proc.on("error", (e) => {
      clearTimeout(timer);
      fail(new SysmlUnavailableError(`変換を起動できません(Java 21 が必要です): ${e.message}`));
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      killGroup();
      done({ code, stderr });
    });
  });
}

/**
 * SysML v2 テキストを、公式パイロット実装の変換器で標準の形式に変換する(エクスポートのみ。取り込みは未対応)。
 *  - json: SysML v2 API の JSON 形式(elementId つきの要素の配列)
 *  - xmi : XMI(.sysmlx)
 * 同時に 2 件まで(待ちは 4 件まで。超えると ConvertBusyError)。Java が無い・タイムアウトは SysmlUnavailableError、
 * モデルが原因の失敗は ConvertError。
 */
export async function convertModel(text: string, format: ConvertFormat, opts: { cacheDir?: string; timeoutMs?: number; script?: string; tempRoot?: string } = {}): Promise<string> {
  await acquire();
  const root = opts.tempRoot ?? defaultRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(root, PREFIX));
  try {
    void sweepConvertTemp(10 * 60_000, root);
    const input = join(dir, "model.sysml");
    await writeFile(input, text, "utf8");
    const script = opts.script ?? resolve(REPO_ROOT, "tools/sysml-check/convert.sh");
    const env = { ...process.env, ...(opts.cacheDir ? { SYSML_PILOT_CACHE: opts.cacheDir } : {}) };
    const { code } = await run(script, [format, input], env, opts.timeoutMs ?? 180_000);
    const outFile = join(dir, format === "json" ? "model.json" : "model.sysmlx");
    const out = await readFile(outFile, "utf8").catch(() => undefined);
    // 変換器は、モデルに誤りがあっても部分的な出力や空の出力を返すことがある。成功の条件は「終了コード 0 かつ中身がある」
    if (code !== 0 || !out || out.trim().length < 3 || out.trim() === "[]")
      throw new ConvertError(`このモデルは公式の変換器で ${format === "json" ? "JSON" : "XMI"} に変換できませんでした(モデルの誤り、または変換器が対応していない記述(単位式など)の可能性があります)`);
    // XMI のライブラリ参照は、作業用の相対パス(lib/…)を含むので、ファイル名だけにする
    return format === "json" ? stabilizeJsonIds(out) : out.replace(/href="lib\//g, 'href="');
  } finally {
    await rm(dir, { recursive: true, force: true });
    release();
  }
}
