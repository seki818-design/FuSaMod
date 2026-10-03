import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scdlFromGraph, validateScdl, type ElementGraph } from "../src/index.js";
import { allStereotypes, redundantArchitecture } from "./fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string): ElementGraph =>
  JSON.parse(readFileSync(resolve(here, "../../../examples/sysml", name), "utf8")) as ElementGraph;

describe("公式パイロット実装が出力した要素グラフ → SCDL モデル", () => {
  it.each([
    ["redundant-architecture.graph.json", redundantArchitecture],
    ["all-stereotypes.graph.json", allStereotypes],
  ])("%s は元のモデルに一致する", (file, fixture) => {
    const { model, issues } = scdlFromGraph(load(file));
    expect(issues).toEqual([]);
    expect(model).toEqual(fixture());
    expect(validateScdl(model)).toEqual([]);
  });
});

describe("要素グラフの異常", () => {
  const graph = () => load("all-stereotypes.graph.json");

  it("参照先が SCDL 要素でないとエラー", () => {
    const g = graph();
    g.dependencies.find((d) => d.name === "I-1")!.supplier = ["AllStereotypes::Nope"];
    expect(() => scdlFromGraph(g)).toThrow(/解決できません/);
  });

  it("種類の違う参照(インタラクションの宛先がエレメント)はエラー", () => {
    const g = graph();
    g.dependencies.find((d) => d.name === "I-1")!.supplier = ["AllStereotypes::Architecture::SYS"];
    expect(() => scdlFromGraph(g)).toThrow(/種類が不正/);
  });

  it("同じ要素への複数のステレオタイプはエラー", () => {
    const g = graph();
    const first = g.metadata.find((m) => m.type === "ScdlElement")!;
    g.metadata.push({ ...first, qualifiedName: first.qualifiedName + "-dup", type: "ScdlRequirement" });
    expect(() => scdlFromGraph(g)).toThrow(/複数の SCDL ステレオタイプ/);
  });

  it("複数エレメントへの配置を指摘する", () => {
    const g = graph();
    g.satisfies.push({ requirement: g.satisfies[0]!.requirement, by: "AllStereotypes::Architecture::SYS::'SYS-C'" });
    expect(scdlFromGraph(g).issues.map((i) => i.code)).toEqual(["ALLOCATION_MULTIPLE"]);
  });

  it("SCDL 以外のメタデータ/satisfy は無視する", () => {
    const g = graph();
    g.metadata.push({ kind: "MetadataUsage", qualifiedName: "X/@Other#1", type: "Other", annotated: ["AllStereotypes::Architecture::SYS"], attributes: {} });
    g.satisfies.push({ requirement: "Other::Req", by: "Other::Part" });
    expect(scdlFromGraph(g).model).toEqual(allStereotypes());
  });
});
