import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConvertBusyError, ConvertError, convertModel } from "../src/sysml/convert.js";
import { JavaSysmlService } from "../src/sysml/java-service.js";
import { SysmlUnavailableError } from "../src/sysml/types.js";

const script = resolve(import.meta.dirname, "fakes/fake-convert.sh");
const server = resolve(import.meta.dirname, "fakes/fake-sysml-server.mjs");
chmodSync(script, 0o755);
// テストごとに専用の一時ディレクトリを使う(OS 共通の tmp にある他の実行・他のプロセスの残りに影響されない)
let root = "";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "fusamod-test-conv-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
const tmpLeft = () => readdirSync(root).filter((n) => n.startsWith("fusamod-convert-"));
const withMode = async <T>(mode: string, f: () => Promise<T>): Promise<T> => {
  const old = process.env["FAKE_MODE"];
  process.env["FAKE_MODE"] = mode;
  try {
    return await f();
  } finally {
    if (old === undefined) delete process.env["FAKE_MODE"];
    else process.env["FAKE_MODE"] = old;
  }
};

describe("convertModel(代役のスクリプトで、Java なしに挙動を確認)", () => {
  it("成功: JSON / XMI の中身を返し、一時ディレクトリを残さない", async () => {
    expect(await convertModel("package P {}", "json", { script, tempRoot: root })).toContain("PartUsage");
    expect((await convertModel("package P {}", "xmi", { script, tempRoot: root })).startsWith("<?xml")).toBe(true);
    expect(tmpLeft()).toEqual([]);
  });
  it("空の出力・終了コード非 0 は ConvertError(内部のパスを含まない)", async () => {
    await expect(withMode("empty", () => convertModel("x", "json", { script, tempRoot: root }))).rejects.toBeInstanceOf(ConvertError);
    const err = await withMode("fail", () => convertModel("x", "json", { script, tempRoot: root })).catch((e) => e);
    expect(err).toBeInstanceOf(ConvertError);
    expect(String(err.message)).not.toContain("secret");
    expect(String(err.message)).not.toContain("fusamod-convert-");
    expect(tmpLeft()).toEqual([]);
  });
  it("タイムアウトは SysmlUnavailableError。子プロセスも残さず、一時ディレクトリを消す", async () => {
    const t0 = Date.now();
    await expect(withMode("spawn-child", () => convertModel("x", "json", { script, timeoutMs: 800, tempRoot: root }))).rejects.toBeInstanceOf(SysmlUnavailableError);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(tmpLeft()).toEqual([]);
  });
  it("起動できない(スクリプトが無い)ときは SysmlUnavailableError", async () => {
    await expect(convertModel("x", "json", { script: "/nonexistent/convert.sh", tempRoot: root })).rejects.toBeInstanceOf(SysmlUnavailableError);
  });
  it("同時実行の上限(実行 2 + 待ち 4): 7 件目以降は ConvertBusyError", async () => {
    const rs = await withMode("slow", () => Promise.allSettled(Array.from({ length: 9 }, () => convertModel("x", "json", { script, timeoutMs: 700, tempRoot: root }))));
    const busy = rs.filter((r) => r.status === "rejected" && r.reason instanceof ConvertBusyError).length;
    expect(busy).toBe(3); // 2 実行 + 4 待ち = 6 件が受理され、残り 3 件が断られる
    expect(tmpLeft()).toEqual([]);
  }, 60_000);
});

describe("JavaSysmlService(代役のサーバーで、プロトコルと回復を確認)", () => {
  let svc: JavaSysmlService | undefined;
  afterEach(async () => {
    await svc?.close();
    svc = undefined;
  });
  const make = (mode: string, o: { requestTimeoutMs?: number; startTimeoutMs?: number } = {}) =>
    (svc = new JavaSysmlService({ command: process.execPath, args: [server], env: { FAKE_MODE: mode }, startTimeoutMs: o.startTimeoutMs ?? 5000, requestTimeoutMs: o.requestTimeoutMs ?? 5000 }));

  it("解析でき、誤りのあるモデルは診断を返し、同時に呼んでも直列に処理される", async () => {
    const s = make("ok");
    const [a, b, c] = await Promise.all([s.analyze("package P {}"), s.analyze("BAD"), s.analyze("package P { part a; }")]);
    expect([a.ok, b.ok, c.ok]).toEqual([true, false, true]);
    expect(b.diagnostics[0]!.message).toBe("bad");
    expect(a.graph!.elements[0]!.name).toBe("a");
  });
  it("起動前に終了したら SysmlUnavailableError。次のリクエストで再起動を試みる", async () => {
    const s = make("crash-on-start");
    await expect(s.analyze("x")).rejects.toBeInstanceOf(SysmlUnavailableError);
    await expect(s.analyze("x")).rejects.toBeInstanceOf(SysmlUnavailableError);
  });
  it("応答しないときはタイムアウトし、プロセスを捨てて、次のリクエストでエラーを返す(固まらない)", async () => {
    const s = make("hang", { requestTimeoutMs: 400 });
    await expect(s.analyze("x")).rejects.toThrow(/タイムアウト/);
  });
  it("タイムアウト後・プロセス死亡後の次のリクエストで、サーバーが落ちない(EPIPE を握りつぶさず、エラーか再起動で返す)", async () => {
    const s = make("hang", { requestTimeoutMs: 300 });
    await expect(s.analyze("x")).rejects.toThrow();
    await expect(s.analyze("y")).rejects.toThrow(); // 死んだプロセスに書き込まない。ハングせず、例外で返る
    const d = make("die-after-reply");
    await d.analyze("a");
    await new Promise((r) => setTimeout(r, 2)); // 終了直前・直後を狙う
    const r = await d.analyze("b").then(() => "ok", () => "error");
    expect(["ok", "error"]).toContain(r);
  });
  it("タイムアウトは SysmlTimeoutError(モデルの誤りと区別できる)", async () => {
    const { SysmlTimeoutError } = await import("../src/sysml/types.js");
    const s = make("hang", { requestTimeoutMs: 200 });
    await expect(s.analyze("x")).rejects.toBeInstanceOf(SysmlTimeoutError);
  });
  it("タイムアウトで捨てたプロセスの終了イベントが、新しいプロセスを巻き込まない(孤児 JVM を作らない)", async () => {
    const pids: number[] = [];
    svc = new JavaSysmlService({ command: process.execPath, args: [server], env: { FAKE_MODE: "hang-on-HANG" }, requestTimeoutMs: 400, log: (m) => { const x = /^PID (\d+)/.exec(m); if (x) pids.push(Number(x[1])); } });
    await expect(svc.analyze("HANG")).rejects.toThrow(/タイムアウト/);
    for (let i = 0; i < 4; i++) expect((await svc.analyze(`package P${i} {}`)).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    const alive = pids.filter((p) => { try { process.kill(p, 0); return true; } catch { return false; } });
    expect(pids.length).toBe(2); // 最初の 1 つ(捨てた)+ 再起動した 1 つだけ
    expect(alive).toHaveLength(1);
  });
  it("不正な出力の行は無視して続ける", async () => {
    const s = make("bad-line");
    expect((await s.analyze("package P {}")).ok).toBe(true);
  });
  it("停止後は SysmlUnavailableError", async () => {
    const s = make("ok");
    await s.analyze("package P {}");
    await s.close();
    await expect(s.analyze("x")).rejects.toBeInstanceOf(SysmlUnavailableError);
  });
});
