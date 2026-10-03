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
  it("誤りのあるモデルでも、他のファイルを壊さず、エラーとして返る(または空の結果)", async () => {
    await expect(convertModel("package X { part a : ", "json")).resolves.toBeDefined();
  }, 300_000);
});
