import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeProject, parseSafetyData } from "@fusamod/analysis";
import { JavaSysmlService } from "../src/sysml/java-service.js";
import { DEMO } from "./helpers.js";

// 公式パイロット実装(Java 21 以上が必要。初回は約 120MB を取得)を実際に起動する統合テスト。
// 実行: FUSAMOD_IT=1 pnpm --filter @fusamod/server test
describe.skipIf(!process.env["FUSAMOD_IT"])("JavaSysmlService(公式実装・統合)", () => {
  const svc = new JavaSysmlService({ startTimeoutMs: 240_000, requestTimeoutMs: 60_000, log: () => {} });
  afterAll(() => svc.close());
  const model = readFileSync(resolve(DEMO, "model.sysml"), "utf8");

  it("モデルを解析し、保存済みのグラフと同じ結果(要素・機能の構成)になる", async () => {
    const r = await svc.analyze(model);
    expect(r.ok).toBe(true);
    const saved = JSON.parse(readFileSync(resolve(DEMO, "model.graph.json"), "utf8"));
    const strip = (g: { elements: unknown[] }) => JSON.stringify(g.elements);
    expect(strip(r.graph!)).toBe(strip(saved));
    const s = parseSafetyData(JSON.parse(readFileSync(resolve(DEMO, "safety.json"), "utf8")));
    expect(s.ok && analyzeProject(r.graph!, s.data).summary.errors).toBe(0);
  }, 300_000);

  it("同じモデルを繰り返し解析でき、誤りのあるモデルは診断を返して、その後も使える", async () => {
    expect((await svc.analyze(model)).ok).toBe(true);
    const bad = await svc.analyze("package X { part a : Missing; }");
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.some((d) => d.message.includes("Missing"))).toBe(true);
    expect(bad.graph).toBeUndefined();
    const again = await svc.analyze(model);
    expect(again.ok).toBe(true);
  });

  it("同時に呼んでも直列に処理される", async () => {
    const rs = await Promise.all([svc.analyze(model), svc.analyze("package Y { part b; }"), svc.analyze(model)]);
    expect(rs.map((r) => r.ok)).toEqual([true, true, true]);
    expect(rs[1]!.graph!.elements.some((e) => e.name === "b")).toBe(true);
  });
});

import { convertModel } from "../src/sysml/convert.js";

describe.skipIf(!process.env["FUSAMOD_IT"])("標準形式への変換(公式実装・統合)", () => {
  const model = readFileSync(resolve(DEMO, "model.sysml"), "utf8");
  it("SysML v2 API の JSON 形式に変換できる(要素に elementId と @type がある)", async () => {
    const out = JSON.parse(await convertModel(model, "json"));
    expect(Array.isArray(out)).toBe(true);
    const types = new Set(out.map((x: { payload: { "@type": string } }) => x.payload["@type"]));
    expect(types.has("PartUsage")).toBe(true);
    expect(types.has("RequirementUsage")).toBe(true);
    expect(out.every((x: { payload: { elementId: string } }) => typeof x.payload.elementId === "string")).toBe(true);
  }, 300_000);
  it("XMI に変換できる", async () => {
    const xmi = await convertModel(model, "xmi");
    expect(xmi.startsWith("<?xml")).toBe(true);
    expect(xmi).toContain("PartUsage");
  }, 300_000);
  it("単位式・SCDL ステレオタイプを含むモデル(all-stereotypes.sysml)も、標準ライブラリを渡して JSON/XMI に変換できる", async () => {
    const units = readFileSync(resolve(DEMO, "../../examples/sysml/all-stereotypes.sysml"), "utf8");
    const json = JSON.parse(await convertModel(units, "json")) as { payload: { "@type": string } }[];
    expect(json.length).toBeGreaterThan(100);
    expect((await convertModel(units, "xmi")).startsWith("<?xml")).toBe(true);
  }, 300_000);
  it("XMI の標準ライブラリ参照は、ファイル名 + 安定な ID(作業用のパスを含まない)", async () => {
    const xmi = await convertModel(model, "xmi");
    expect(xmi).toMatch(/href="ScalarValues\.kermlx#[0-9a-f-]{36}"/);
    expect(xmi).not.toContain("lib/");
    expect(xmi).not.toContain("fusamod-");
  }, 300_000);
  it("同時実行の上限: 多数を同時に投げても、待ちを超えたものは ConvertBusyError で断られ、一時ディレクトリは残らない", async () => {
    const { ConvertBusyError } = await import("../src/sysml/convert.js");
    const { mkdtempSync, readdirSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "fusamod-it-conv-")); // この試験専用(他の実行の残りに影響されない)
    const rs = await Promise.allSettled(Array.from({ length: 10 }, () => convertModel(model, "json", { tempRoot: root })));
    expect(rs.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(6);
    expect(rs.filter((r) => r.status === "rejected" && r.reason instanceof ConvertBusyError).length).toBeGreaterThanOrEqual(4);
    expect(readdirSync(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  }, 600_000);
});

describe.skipIf(!process.env["FUSAMOD_IT"])("標準 JSON の elementId の安定化(公式実装・統合)", () => {
  it("同じモデルを 2 回変換すると、elementId の集合が一致する(完全に対称な要素の割り当てだけが入れ替わりうる)", async () => {
    const model = readFileSync(resolve(DEMO, "model.sysml"), "utf8");
    const ids = async () => (JSON.parse(await convertModel(model, "json")) as { payload: { elementId: string } }[]).map((r) => r.payload.elementId).sort();
    const [a, b] = [await ids(), await ids()];
    expect(a.length).toBeGreaterThan(100);
    expect(a).toEqual(b);
  }, 600_000);
  it("同じモデルを 2 回変換すると、出力がバイト単位で一致する", async () => {
    const model = readFileSync(resolve(DEMO, "model.sysml"), "utf8");
    expect(await convertModel(model, "json")).toBe(await convertModel(model, "json"));
  }, 600_000);
  it("モデルを小さく編集しても、既存の要素(関係要素を含む)の ID の大半は変わらない", async () => {
    const model = readFileSync(resolve(DEMO, "model.sysml"), "utf8");
    const ids = async (m: string) => new Set((JSON.parse(await convertModel(m, "json")) as { payload: { elementId: string } }[]).map((r) => r.payload.elementId));
    const before = await ids(model);
    const edited = model.replace(/package\s+(\w+)\s*\{/, (x) => `${x}\n  part def Zzz0 { }\n`);
    const after = await ids(edited);
    const kept = [...before].filter((i) => after.has(i)).length;
    expect(kept / before.size).toBeGreaterThan(0.95);
  }, 600_000);
  it("同梱の例すべてで、2 回の出力がバイト単位で一致する", async () => {
    const { readdirSync } = await import("node:fs");
    const dir = resolve(DEMO, "../../examples/sysml");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sysml"))) {
      const text = readFileSync(resolve(dir, f), "utf8");
      expect(await convertModel(text, "json"), f).toBe(await convertModel(text, "json"));
    }
  }, 900_000);
  it("満たす関係(satisfy)の ID は、無関係な編集の前後で、同じ要求を指し続ける", async () => {
    const model = readFileSync(resolve(DEMO, "model.sysml"), "utf8");
    type R = { payload: { elementId: string; "@type": string; ownedRelationship?: { "@id": string }[]; target?: { "@id": string }[]; declaredName?: string } };
    const map = async (m: string) => {
      const list = JSON.parse(await convertModel(m, "json")) as R[];
      const by = new Map(list.map((r) => [r.payload.elementId, r.payload]));
      const out = new Map<string, string>();
      for (const p of by.values()) {
        if (p["@type"] !== "SatisfyRequirementUsage") continue;
        const tgt = (p.ownedRelationship ?? []).map((c) => by.get(c["@id"])).flatMap((q) => q?.target ?? []).map((t) => by.get(t["@id"])?.declaredName);
        out.set(p.elementId, tgt.join(","));
      }
      return out;
    };
    const before = await map(model);
    const after = await map(model.replace(/\}\s*$/, "  part zzz;\n}\n"));
    expect(before.size).toBeGreaterThan(0);
    for (const [id, req] of before) expect(after.get(id)).toBe(req);
  }, 600_000);
  it("トップレベル（パッケージの外）に要素を足しても、既存の要素の ID の大半は変わらない（N11 の回帰）", async () => {
    const text = readFileSync(resolve(DEMO, "../../examples/sysml/instance-paths.sysml"), "utf8");
    const ids = async (m: string) => new Set((JSON.parse(await convertModel(m, "json")) as { payload: { elementId: string } }[]).map((r) => r.payload.elementId));
    const before = await ids(text);
    const after = await ids(`${text}\npart zzz;\n`);
    expect([...before].filter((i) => after.has(i)).length / before.size).toBeGreaterThan(0.9);
  }, 600_000);
  it("コメントに「SCDL」と書いただけでは、SCDL ライブラリを取り込まない（N12 の回帰）", async () => {
    const plain = JSON.parse(await convertModel("package C { part p; }", "json")) as unknown[];
    const withComment = JSON.parse(await convertModel("// ここは SCDL の説明のみ。単位は 3 [RFC] のように書く\npackage C { part p; }", "json")) as unknown[];
    expect(withComment.length).toBe(plain.length);
  }, 600_000);
  it("文字列内の // や行コメント内の /* があっても、本物の import SCDL と @Scdl* は取り込まれる（N15 の回帰）", async () => {
    const text = '// generated from docs/*.md\npackage S5 {\n  part src { attribute u = "http://example.org/b"; }\n  private import SCDL::*;   /* end */\n  part p { @ScdlElement { title = "p"; } }\n}\n';
    const list = JSON.parse(await convertModel(text, "json")) as { payload: { "@type": string } }[];
    expect(list.some((r) => r.payload["@type"] === "MetadataDefinition")).toBe(true); // SCDL の定義が入っている
  }, 600_000);
});

describe.skipIf(!process.env["FUSAMOD_IT"])("公式実装の用意（Node だけで、取得・展開・コンパイル）", () => {
  it("空のキャッシュから用意でき、補助クラスと標準ライブラリが揃う（bash・unzip・zstd 不要）", async () => {
    const { ensurePilot } = await import("../src/sysml/pilot.js");
    const { existsSync, mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cache = mkdtempSync(join(tmpdir(), "fusamod-it-pilot-"));
    try {
      const root = resolve(DEMO, "../..");
      const [a, b] = await Promise.all([ensurePilot({ cacheDir: cache, root }), ensurePilot({ cacheDir: cache, root })]); // 同時に呼んでも、準備は 1 回
      expect(a.jar).toBe(b.jar);
      expect(existsSync(a.jar)).toBe(true);
      expect(existsSync(join(a.library, "Kernel Libraries", "Kernel Data Type Library", "ScalarValues.kerml"))).toBe(true);
      for (const c of ["PilotCheck", "SysmlExtract", "SysmlServer"]) expect(existsSync(join(a.cache, `${c}.class`))).toBe(true);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  }, 600_000);
});
