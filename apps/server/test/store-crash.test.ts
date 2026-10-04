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
  it("100 回保存しても、すべて成功し、履歴が全件残り、1 回の保存が極端に遅くならない(負荷に左右されない上限 3 秒)", { timeout: 120_000 }, async () => {
    const s = await mk();
    let worst = 0;
    for (let i = 0; i < 100; i++) {
      const t = performance.now();
      await s.saveModel("p1", `package P { part a${i}; }`, "tester", "m", i + 1);
      worst = Math.max(worst, performance.now() - t);
    }
    expect(worst).toBeLessThan(3000);
    expect((await s.history("p1")).length).toBe(101);
    expect((await s.latestMeta("p1"))?.revision).toBe(101);
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
    expect(m.revision).toBe(2); // 壊れた版 2 は隔離され、その番号から続く
    expect(readdirSync(join(dir, "p1", ".history")).some((n) => n.startsWith(".corrupt-000002-"))).toBe(true);
    expect((await s.readAudit("p1", 50)).some((e) => e.action === "history.quarantine")).toBe(true);
    expect((await s.read("p1")).notice).toContain("隔離");
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

describe("改行コード（Windows の CRLF）", () => {
  it("CRLF のモデルは LF にそろえて読み込まれ、保存済みのグラフ（LF の文字位置）と食い違わない", async () => {
    const root = mkdtempSync(join(tmpdir(), "fusamod-crlf-"));
    try {
      const store = new ProjectStore(root);
      await store.create("crlf", "package P {\n    part a;\n}\n", "tester");
      const file = join(root, "crlf", "model.sysml");
      writeFileSync(file, "package P {\r\n    part a;\r\n}\r\n"); // Windows の git checkout を模す
      const p = await store.read("crlf");
      expect(p.model).toBe("package P {\n    part a;\n}\n");
      expect(p.notice).toBeUndefined(); // 改行コードの違いだけでは「履歴と一致しない」警告を出さない
      const saved = await store.saveModel("crlf", "package P {\r\n    part b;\r\n}\r\n", "tester", "保存", p.revision);
      expect(saved.revision).toBeGreaterThan(p.revision);
      expect((await store.read("crlf")).model).toBe("package P {\n    part b;\n}\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
