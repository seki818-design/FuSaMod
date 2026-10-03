import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expandGraph } from "../src/index.js";

const g = JSON.parse(readFileSync(resolve(__dirname, "../../../examples/sysml/def-owned-requirements.graph.json"), "utf8"));

describe("part def が所有する requirement と、その中の satisfy(N7)", () => {
  const r = expandGraph(g);
  const sat = (req: string) => r.graph.satisfies.filter((s) => s.requirement === req).map((s) => s.by).sort();
  it("使用(インスタンス)ごとに要求が複製され、暗黙の subject はその part 自身が満たす", () => {
    for (const c of ["c1", "c2", "c3"]) expect(sat(`DefOwnedReq::${c}::inCar`)).toEqual([`DefOwnedReq::${c}`]);
  });
  it("定義の中の part を by に指す satisfy は、同じインスタンスの複製 1 つだけに付く", () => {
    for (const c of ["c1", "c2", "c3"]) expect(sat(`DefOwnedReq::${c}::inCar2`)).toEqual([`DefOwnedReq::${c}::front`]);
  });
  it("使用側から型の中身を相対の経路(front.brake)で指せる", () => {
    expect(sat("DefOwnedReq::c3::extra")).toEqual(["DefOwnedReq::c3::front::brake"]);
  });
  it("「使われていない定義」「すべてのインスタンスに紐づけた」の誤った警告を出さない", () => {
    const codes = r.issues.map((i) => i.code);
    expect(codes).not.toContain("SATISFY_NO_INSTANCE");
    expect(codes).not.toContain("SATISFY_AMBIGUOUS");
    expect(codes).not.toContain("SATISFY_UNRESOLVED");
  });
});

describe("exhibit state（ラウンド 10）", () => {
  it("状態の一種として警告され、機能（action）には導出されない", () => {
    const eg = JSON.parse(readFileSync(resolve(__dirname, "../../../examples/sysml/exhibit-state.graph.json"), "utf8"));
    const r = expandGraph(eg);
    expect(r.issues.some((i) => i.code === "UNSUPPORTED_CONSTRUCT" && i.message.includes("exhibit state"))).toBe(true);
    expect(r.graph.elements.some((e) => e.qualifiedName.endsWith("::st2"))).toBe(false);
    expect((r.graph.performs ?? []).length).toBe(0);
  });
});
