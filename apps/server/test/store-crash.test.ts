import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptySafetyData } from "@fusamod/analysis";
import { ProjectStore } from "../src/projects.js";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const mk = async () => {
  dir = mkdtempSync(join(tmpdir(), "fusamod-store-"));
  const s = new ProjectStore(dir);
  await s.create("p1", "package P { part a; }", "tester");
  return s;
};

describe("保存の原子性と回復(途中で落ちても履歴と現在の状態が食い違わない)", () => {
  it("履歴を確定した後、現在のファイルを書く前に落ちた場合、確定済みの内容が読まれる", async () => {
    const s = await mk();
    const base = (await s.read("p1")).revision;
    // 保存の途中: 履歴 000002 だけ確定し、現在のファイルは古いまま
    const rd = join(dir, "p1", ".history", "000002");
    mkdirSync(rd);
    const model = "package P { part committed; }";
    const safety = JSON.stringify(emptySafetyData(), null, 2) + "\n";
    const { createHash } = await import("node:crypto");
    const sha = (x: string) => createHash("sha256").update(x).digest("hex");
    writeFileSync(join(rd, "model.sysml"), model);
    writeFileSync(join(rd, "safety.json"), safety);
    writeFileSync(join(rd, "meta.json"), JSON.stringify({ revision: base + 1, ts: new Date().toISOString(), actor: "x", message: "m", kind: "model", modelSha256: sha(model), safetySha256: sha(safety) }));
    const r = await s.read("p1");
    expect(r.model).toBe(model);
    expect(r.revision).toBe(base + 1);
    // 次の保存で現在のファイルも揃う
    await s.saveSafety("p1", emptySafetyData(), "tester", "続き", base + 1);
    expect(readFileSync(join(dir, "p1", "model.sysml"), "utf8")).toBe(model);
  });
  it("履歴の確定前に落ちた一時ディレクトリは無視され、次の保存で掃除される", async () => {
    const s = await mk();
    mkdirSync(join(dir, "p1", ".history", ".tmp-dead"));
    expect((await s.history("p1")).map((h) => h.revision)).toEqual([1]);
    await s.saveModel("p1", "package P { part b; }", "tester", "m", 1);
    expect(readdirSync(join(dir, "p1", ".history")).some((n) => n.startsWith(".tmp-"))).toBe(false);
  });
  it("壊れた最新の履歴があっても、その前のリビジョンから続けられる", async () => {
    const s = await mk();
    await s.saveModel("p1", "package P { part b; }", "tester", "m", 1);
    writeFileSync(join(dir, "p1", ".history", "000002", "meta.json"), "{broken");
    expect((await s.latestMeta("p1"))?.revision).toBe(1);
  });
  it("保存の所要時間が履歴の増加で悪化しない(100 回保存しても、最後の 10 回が最初の 10 回の 5 倍以内)", async () => {
    const s = await mk();
    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t = performance.now();
      await s.saveModel("p1", `package P { part a${i}; }`, "tester", "m", i + 1);
      times.push(performance.now() - t);
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(times.slice(-10))).toBeLessThan(avg(times.slice(0, 10)) * 5 + 20);
  });
});

describe("監査ログのハッシュ連鎖", () => {
  it("正常なら検証に通り、途中の行の改ざん・削除を検出する", async () => {
    const s = await mk();
    await s.saveModel("p1", "package P { part b; }", "alice", "m", 1);
    await s.saveModel("p1", "package P { part c; }", "alice", "m", 2);
    expect(await s.verifyAudit("p1")).toMatchObject({ ok: true, lines: 3 });
    const f = join(dir, "p1", "audit.jsonl");
    const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
    writeFileSync(f, [lines[0], lines[1]!.replace("alice", "mallory"), lines[2]].join("\n") + "\n");
    expect(await s.verifyAudit("p1")).toMatchObject({ ok: false, brokenAtLine: 3 });
    writeFileSync(f, [lines[0], lines[2]].join("\n") + "\n");
    expect((await s.verifyAudit("p1")).ok).toBe(false);
  });
  it("同時に書いても連鎖が崩れない", async () => {
    const s = await mk();
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.audit("p1", { actor: "a", action: `x${i}` })));
    expect(await s.verifyAudit("p1")).toMatchObject({ ok: true, lines: 21 });
  });
});

describe("履歴の回復と初回の保存", () => {
  it("最新の meta.json が壊れていても、次の保存が衝突せずに続けられる", async () => {
    const s = await mk();
    await s.saveModel("p1", "package P { part b; }", "tester", "m", 1);
    writeFileSync(join(dir, "p1", ".history", "000002", "meta.json"), "{broken");
    const m = await s.saveModel("p1", "package P { part c; }", "tester", "m", 1);
    expect(m.revision).toBe(3);
  });
  it("履歴の無いプロジェクトは、最初の保存の前の内容が版 1 として残る", async () => {
    dir = mkdtempSync(join(tmpdir(), "fusamod-store-"));
    mkdirSync(join(dir, "legacy"));
    writeFileSync(join(dir, "legacy", "model.sysml"), "package Legacy { part orig; }");
    const s = new ProjectStore(dir);
    const m = await s.saveModel("legacy", "package Legacy { part edited; }", "tester", "編集", undefined);
    expect(m.revision).toBe(2);
    expect((await s.revision("legacy", 1)).model).toContain("orig");
    expect((await s.history("legacy")).map((h) => h.revision)).toEqual([2, 1]);
  });
  it("履歴の自動削除は監査ログに記録される", async () => {
    process.env["FUSAMOD_HISTORY_KEEP"] = "10";
    vi.resetModules();
    const { ProjectStore: PS } = await import("../src/projects.js");
    dir = mkdtempSync(join(tmpdir(), "fusamod-store-"));
    const s = new PS(dir);
    await s.create("p1", "package P {}", "t");
    for (let i = 0; i < 12; i++) await s.saveModel("p1", `package P { part a${i}; }`, "t", "m", i + 1);
    delete process.env["FUSAMOD_HISTORY_KEEP"];
    expect((await s.readAudit("p1", 500)).some((e) => e.action === "history.prune")).toBe(true);
    expect((await s.verifyAudit("p1")).ok).toBe(true);
  });
  it("PORT が不正なら起動時に拒否", async () => {
    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig({ PORT: "99999" })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
  });
});

describe("回復の通知と壊れた提案ファイル", () => {
  it("現在のファイルが履歴と食い違うとき、読み込みは履歴の内容と『注意』を返す", async () => {
    const s = await mk();
    await s.saveModel("p1", "package P { part saved; }", "t", "m", 1);
    writeFileSync(join(dir, "p1", "model.sysml"), "package P { part handedited; }");
    const r = await s.read("p1");
    expect(r.model).toContain("saved");
    expect(r.notice).toContain("履歴");
  });
  it("壊れた履歴があれば、注意に出る", async () => {
    const s = await mk();
    await s.saveModel("p1", "package P { part saved; }", "t", "m", 1);
    writeFileSync(join(dir, "p1", ".history", "000002", "meta.json"), "{broken");
    expect((await s.read("p1")).notice).toContain("壊れた履歴");
  });
  it("proposals.json が壊れていても、退避して空から続けられる(500 にならない)", async () => {
    const s = await mk();
    writeFileSync(join(dir, "p1", "proposals.json"), "{broken");
    expect(await s.readProposals("p1")).toEqual([]);
    expect(readdirSync(join(dir, "p1")).some((n) => n.startsWith("proposals.json.corrupt-"))).toBe(true);
    expect((await s.readAudit("p1", 50)).some((e) => e.action === "proposals.corrupt")).toBe(true);
  });
});
