/**
 * 公式 SysML v2 パイロット実装（Java）の取得・展開・補助クラスのコンパイル。Node だけで動く（Windows でも bash なしで動かすため）。
 * 取得元: conda-forge の jupyter-sysml-kernel（SHA-256 を検証）。展開先は tools/sysml-check/lib.sh と同じ構成なので、キャッシュを共有できる。
 *   <cache>/kernel/share/jupyter/kernels/sysml/{jupyter-sysml-kernel-<版>-all.jar, sysml.library/}
 *   <cache>/{PilotCheck,SysmlExtract,SysmlServer}.class
 * 必要なもの: Java 21 以上の JDK（java と javac）、Node.js 22.15 以上（zstd の展開に使う）。
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import * as zlib from "node:zlib";

export const PILOT_VERSION = "0.62.0";
const BUILD = "pyhd8ed1ab_0";
const SHA256 = "67997bf79f88acb3d9617e3ca33e2a17f8562a00bc1500ae3b15f4f113c11cd6";
const FILE = `jupyter-sysml-kernel-${PILOT_VERSION}-${BUILD}.conda`;
const URL = `https://conda.anaconda.org/conda-forge/noarch/${FILE}`;
const KERNEL = "share/jupyter/kernels/sysml";
const HELPERS = ["PilotCheck", "SysmlExtract", "SysmlServer"];

export class PilotSetupError extends Error {}

export interface Pilot {
  cache: string;
  jar: string;
  /** 標準ライブラリ（sysml.library）のディレクトリ */
  library: string;
  /** 補助クラス + 公式の jar のクラスパス */
  classpath: string;
  /** SCDL ステレオタイプ定義（SCDL.sysml） */
  scdl: string;
}

export const JAVA_UTF8 = ["-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-Dfile.encoding=UTF-8"];

function pilotPaths(cache: string, root: string): Pilot {
  const kdir = join(cache, "kernel", KERNEL);
  const jar = join(kdir, `jupyter-sysml-kernel-${PILOT_VERSION}-all.jar`);
  return { cache, jar, library: join(kdir, "sysml.library"), classpath: [cache, jar].join(pathDelimiter()), scdl: join(root, "libs/sysml/scdl/SCDL.sysml") };
}
const pathDelimiter = () => (process.platform === "win32" ? ";" : ":");

/** コマンドを実行して、終了コードと標準エラーを返す（出力は捨てる）。 */
function run(cmd: string, args: string[], cwd?: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((done) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], ...(cwd ? { cwd } : {}), windowsHide: true });
    let stderr = "";
    p.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString("utf8")).slice(-2000)));
    p.on("error", (e) => done({ code: -1, stderr: e.message }));
    p.on("close", (code) => done({ code, stderr }));
  });
}

async function download(dest: string, log: (m: string) => void): Promise<void> {
  log(`パイロット実装を取得します: ${URL}（約 120MB。初回のみ、数分かかります）`);
  // curl は、プロキシの環境変数や証明書の設定に従う。無ければ fetch
  const viaCurl = await run("curl", ["-fsSL", "-o", dest, URL]);
  if (viaCurl.code === 0) return;
  const res = await fetch(URL);
  if (!res.ok || !res.body) throw new PilotSetupError(`パイロット実装を取得できません（HTTP ${res.status}）。ネットワークやプロキシの設定を確認してください`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

const sha256File = (file: string) =>
  new Promise<string>((ok, ng) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d)).on("error", ng).on("end", () => ok(h.digest("hex")));
  });

/** .conda（zip）から、pkg-*.tar.zst の中身（圧縮データ）を取り出す。 */
export function zipEntry(zip: Buffer, match: (name: string) => boolean): Buffer {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 70_000); i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new PilotSetupError("取得したファイルが zip として読めません");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) break;
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (match(name)) {
      const lNameLen = zip.readUInt16LE(local + 26);
      const lExtraLen = zip.readUInt16LE(local + 28);
      const data = zip.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new PilotSetupError("取得したファイルに、必要なパッケージが含まれていません");
}

const octal = (b: Buffer) => parseInt(b.toString("ascii").replace(/\0.*$/s, "").trim() || "0", 8);
const cstr = (b: Buffer) => b.toString("utf8").replace(/\0.*$/s, "");

type Body = { sink: "meta" | "file" | "skip"; meta?: string; out?: string; size: number; got: number; remaining: number; chunks: Buffer[] };

/** tar のストリームを読みながら、want(パス) が出力先を返したファイルだけを書き出す（pax / GNU の長い名前に対応。メモリには 1 ファイル分だけ載せる）。 */
export async function untar(stream: AsyncIterable<Buffer>, want: (path: string) => string | undefined, log: (m: string) => void = () => {}): Promise<number> {
  let buf: Buffer = Buffer.alloc(0);
  let written = 0;
  let longName: string | undefined;
  let pax: Record<string, string> = {};
  let body: Body | undefined;

  const finish = async (b: Body) => {
    const data = Buffer.concat(b.chunks);
    if (b.sink === "file" && b.out) {
      await mkdir(dirname(b.out), { recursive: true });
      await writeFile(b.out, data);
      written++;
    } else if (b.sink === "meta") {
      const text = data.toString("utf8");
      if (b.meta === "L") longName = text.replace(/\0.*$/s, "");
      else if (b.meta === "x") for (const m of text.matchAll(/\d+ ([^=]+)=([^\n]*)\n/g)) pax[m[1]!] = m[2]!;
    }
  };

  const startEntry = (h: Buffer): Body | undefined => {
    const size = octal(h.subarray(124, 136));
    const type = String.fromCharCode(h[156] || 48);
    const pad = (512 - (size % 512)) % 512;
    const mk = (sink: Body["sink"], extra: Partial<Body> = {}): Body => ({ sink, size, got: 0, remaining: size + pad, chunks: [], ...extra });
    if (type === "x" || type === "L" || type === "g") return mk("meta", { meta: type });
    const prefix = cstr(h.subarray(345, 500));
    const raw = pax["path"] ?? longName ?? (prefix ? `${prefix}/${cstr(h.subarray(0, 100))}` : cstr(h.subarray(0, 100)));
    pax = {};
    longName = undefined;
    const out = type === "0" ? want(raw.replace(/^\.\//, "")) : undefined;
    return out !== undefined ? mk("file", { out }) : mk("skip");
  };

  for await (const chunk of stream) {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    for (;;) {
      if (!body) {
        if (buf.length < 512) break;
        const h = buf.subarray(0, 512);
        buf = buf.subarray(512);
        if (h.every((x) => x === 0)) continue;
        body = startEntry(h);
        if (body && body.remaining === 0) {
          await finish(body);
          body = undefined;
        }
        continue;
      }
      const take = Math.min(body.remaining, buf.length);
      if (take === 0) break;
      if (body.sink !== "skip" && body.got < body.size) {
        const real = Math.min(take, body.size - body.got);
        body.chunks.push(Buffer.from(buf.subarray(0, real)));
        body.got += real;
      }
      body.remaining -= take;
      buf = buf.subarray(take);
      if (body.remaining === 0) {
        await finish(body);
        body = undefined;
      }
    }
  }
  log(`${written} ファイルを展開しました`);
  return written;
}

/** パイロット実装を用意する（既にあれば何もしない）。同時に呼ばれても、準備は 1 回だけ。 */
const inflight = new Map<string, Promise<Pilot>>();
export function ensurePilot(opts: { cacheDir: string; root: string; log?: (m: string) => void }): Promise<Pilot> {
  const key = resolve(opts.cacheDir);
  let p = inflight.get(key);
  if (!p) {
    p = setup(key, opts.root, opts.log ?? (() => {})).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

async function setup(cache: string, root: string, log: (m: string) => void): Promise<Pilot> {
  const pilot = pilotPaths(cache, root);
  await mkdir(cache, { recursive: true });
  const lock = `${cache}.lock`;
  await acquire(lock);
  try {
    if (!existsSync(pilot.jar)) await install(pilot, log);
    await compileHelpers(pilot, root, log);
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
  return pilot;
}

/** 別のプロセスが準備中なら、終わるまで待つ（ディレクトリ作成が排他になる）。古いロック（異常終了の残り）は 15 分で破る。 */
async function acquire(lock: string): Promise<void> {
  for (let i = 0; i < 1800; i++) {
    try {
      await mkdir(lock);
      return;
    } catch {
      const st = await stat(lock).catch(() => undefined);
      if (st && Date.now() - st.mtimeMs > 15 * 60_000) await rm(lock, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new PilotSetupError("別のプロセスがパイロット実装を準備中のまま終わりません。キャッシュ（.lock）を確認してください");
}

async function install(pilot: Pilot, log: (m: string) => void): Promise<void> {
  if (typeof (zlib as unknown as { createZstdDecompress?: unknown }).createZstdDecompress !== "function")
    throw new PilotSetupError(`この Node.js（${process.version}）は zstd の展開に対応していません。Node.js 22.15 以上にしてください`);
  const file = join(pilot.cache, FILE);
  await download(file, log);
  if ((await sha256File(file)) !== SHA256) {
    await rm(file, { force: true });
    throw new PilotSetupError("取得したパイロット実装の SHA-256 が一致しません（破損、または改ざんの可能性）。もう一度試してください");
  }
  const zst = zipEntry(await readFile(file), (n) => n.startsWith("pkg-") && n.endsWith(".tar.zst"));
  const stream = Readable.from([zst]).pipe((zlib as unknown as { createZstdDecompress: () => NodeJS.ReadWriteStream }).createZstdDecompress());
  const kernelDir = join(pilot.cache, "kernel");
  await rm(kernelDir, { recursive: true, force: true });
  const base = `${KERNEL}/`;
  await untar(stream as unknown as AsyncIterable<Buffer>, (path) => {
    if (!path.startsWith(base)) return undefined;
    const rel = path.slice(base.length);
    if (!(rel.startsWith("sysml.library/") || rel === `jupyter-sysml-kernel-${PILOT_VERSION}-all.jar`)) return undefined;
    const out = join(kernelDir, ...path.split("/"));
    return out.startsWith(kernelDir + sep) ? out : undefined; // ../ を含むパスは受け付けない
  }, log);
  await rm(file, { force: true });
  if (!existsSync(pilot.jar)) throw new PilotSetupError("展開しましたが、公式の jar が見つかりません");
}

async function compileHelpers(pilot: Pilot, root: string, log: (m: string) => void): Promise<void> {
  const src = join(root, "tools/sysml-check");
  for (const c of HELPERS) {
    const cls = join(pilot.cache, `${c}.class`);
    const java = join(src, `${c}.java`);
    const stale = !existsSync(cls) || (await stat(java)).mtimeMs > (await stat(cls)).mtimeMs;
    if (!stale) continue;
    log(`補助クラスをコンパイルします: ${c}`);
    const r = await run("javac", ["-cp", pilot.classpath, "-d", pilot.cache, java]);
    if (r.code !== 0) throw new PilotSetupError(`javac に失敗しました（JDK 21 以上が必要です。JRE だけでは足りません）: ${r.stderr.trim().split("\n").slice(-3).join(" ")}`);
  }
}

// ----- 変換（JSON / XMI）に渡す追加入力の判断 -----

/** コメント・文字列・引用名を除いたテキスト（import や @Scdl の判定に使う。1 回の走査で、文字列内の // や /* を誤って扱わない）。 */
export function codeOnly(text: string): string {
  return text.replace(/("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\/\*[\s\S]*?\*\/)|(\/\/[^\n]*)/g, (_m, dq: string | undefined, sq: string | undefined) => (dq !== undefined ? '""' : sq !== undefined ? "''" : ""));
}

/** 変換に追加で渡すライブラリ: 単位系（ISQ/SI など、または 数値[単位]）と、SCDL ステレオタイプ（import SCDL / @Scdl*）。 */
export function libraryPlan(text: string): { units: boolean; scdl: boolean } {
  const code = codeOnly(text);
  const units = /\b(ISQ[A-Za-z]*|SI|SIPrefixes|MeasurementReferences|Quantities|USCustomaryUnits|Time|[A-Za-z]*Calculations)\b *::|[0-9)] *\[ *[A-Za-z]/.test(code);
  const scdl = (/\bSCDL *::|\bimport +SCDL\b|@Scdl/.test(code)) && !/^[ \t]*(library[ \t]+)?package[ \t]+SCDL\b/m.test(text);
  return { units, scdl };
}

/** 変換の入力を作業ディレクトリに用意する: ライブラリは空白のないコピーにして追加入力に、SCDL の定義はモデルの先頭に取り込む。 */
export async function prepareConvertInputs(pilot: Pilot, modelFile: string): Promise<string[]> {
  const text = await readFile(modelFile, "utf8");
  const plan = libraryPlan(text);
  const lib = join(dirname(modelFile), "lib");
  await mkdir(lib, { recursive: true });
  const extra: string[] = [];
  const scalar = join(pilot.library, "Kernel Libraries", "Kernel Data Type Library", "ScalarValues.kerml");
  await copyFile(scalar, join(lib, "ScalarValues.kerml"));
  extra.push(join(lib, "ScalarValues.kerml"));
  if (plan.units) {
    const dir = join(pilot.library, "Domain Libraries", "Quantities and Units");
    for (const f of (await readdir(dir)).filter((n) => n.endsWith(".sysml"))) {
      await copyFile(join(dir, f), join(lib, f));
      extra.push(join(lib, f));
    }
  }
  if (plan.scdl) await writeFile(modelFile, (await readFile(pilot.scdl, "utf8")) + text, "utf8");
  return extra;
}
