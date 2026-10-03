import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveNet, expandGraph, type ElementGraph } from "../src/index.js";

const ex = (n: string): ElementGraph => JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../examples/sysml", n), "utf8"));
const P = "TypedDefinitions";

describe("定義と型付き使用の展開(公式実装が出力したグラフで確認)", () => {
  const d = deriveNet(ex("typed-definitions.graph.json"));
  it("part def の中身が、使用ごとに別の構造要素として展開される(最上位は car のみ)", () => {
    const ids = d.net.elements.map((e) => e.id);
    expect(ids).toEqual([
      `${P}::car`,
      `${P}::car::front`,
      `${P}::car::front::rotor`,
      `${P}::car::rear`,
      `${P}::car::rear::rotor`,
    ]);
    expect(d.net.elements.filter((e) => e.parentId === undefined).map((e) => e.id)).toEqual([`${P}::car`]);
    expect(d.net.elements.find((e) => e.id === `${P}::car::front`)!.parentId).toBe(`${P}::car`);
  });
  it("定義内の perform action が、インスタンスごとの機能になり、担当要素と入出力が引き継がれる", () => {
    const f = d.net.functions;
    expect(f.find((x) => x.id === `${P}::car::front::generate`)).toMatchObject({ ownerId: `${P}::car::front` });
    expect(f.find((x) => x.id === `${P}::car::rear::generate`)).toMatchObject({ ownerId: `${P}::car::rear` });
    expect(f.find((x) => x.id === `${P}::car::go`)).toMatchObject({ ownerId: `${P}::car` });
    expect(d.parameters[`${P}::car::front::generate`]).toEqual([{ name: "torque", direction: "out", type: "Real" }]);
    expect(d.candidates.some((c) => c.functionId === `${P}::car::go`)).toBe(true);
  });
  it("定義側を指す satisfy は、複製されたインスタンスへ付け替わる", () => {
    expect(d.requirements.find((r) => r.id === `${P}::torque`)!.satisfiedBy).toEqual([`${P}::car::front`]);
  });
  it("導出に警告はない(定義の使い方が正しいので)", () => {
    expect(d.deriveIssues).toEqual([]);
  });
  it("型を使わないモデルは、展開しても同じ(順序も変わらない)", () => {
    const g = ex("ev-powertrain.graph.json");
    expect(expandGraph(g).graph.elements).toEqual(g.elements);
    expect(expandGraph(g).issues).toEqual([]);
  });
});

const el = (kind: string, qualifiedName: string, owner: string | null, extra: object = {}) => ({ kind, qualifiedName, name: qualifiedName.split("::").pop()!, owner, ...extra });
const graph = (elements: ElementGraph["elements"], extra: Partial<ElementGraph> = {}): ElementGraph => ({ elements, dependencies: [], metadata: [], satisfies: [], performs: [], ...extra });

describe("対応しない構成は黙らずに警告する", () => {
  it("part def だけで使われていない定義は、構造に入れず警告する", () => {
    const d = deriveNet(graph([el("Package", "M", null), el("PartDefinition", "M::A", "M"), el("PartUsage", "M::A::x", "M::A"), el("PartUsage", "M::top", "M")]));
    expect(d.net.elements.map((e) => e.id)).toEqual(["M::top"]); // 定義内の x が最上位になって、システムを乗っ取らない
    expect(d.deriveIssues.map((i) => i.code)).toContain("DEFINITION_NOT_INSTANTIATED");
  });
  it("port / connection / state / allocation は件数つきで警告する", () => {
    const d = deriveNet(graph([el("Package", "M", null), el("PartUsage", "M::a", "M"), el("PortUsage", "M::a::p", "M::a"), el("ConnectionUsage", "M::c", "M"), el("StateUsage", "M::s", "M")]));
    const w = d.deriveIssues.filter((i) => i.code === "UNSUPPORTED_CONSTRUCT");
    expect(w).toHaveLength(3);
    expect(w.map((x) => x.message).join()).toContain("port");
    expect(d.net.elements.map((e) => e.id)).toEqual(["M::a"]);
  });
  it("定義が自分自身を含む循環は、止めて警告する(無限に展開しない)", () => {
    const d = deriveNet(
      graph([el("Package", "M", null), el("PartDefinition", "M::A", "M"), el("PartUsage", "M::A::child", "M::A", { types: ["M::A"] }), el("PartUsage", "M::root", "M", { types: ["M::A"] })]),
    );
    expect(d.deriveIssues.map((i) => i.code)).toContain("RECURSIVE_DEFINITION");
    expect(d.net.elements.length).toBeLessThan(10);
  });
  it("上位の型(:>)の中身も展開され、再定義は警告される", () => {
    const d = deriveNet(
      graph([
        el("Package", "M", null),
        el("PartDefinition", "M::Base", "M"),
        el("PartUsage", "M::Base::b", "M::Base"),
        el("PartDefinition", "M::Sub", "M", { supertypes: ["M::Base"] }),
        el("PartUsage", "M::Sub::s", "M::Sub"),
        el("PartUsage", "M::Sub::r", "M::Sub", { redefines: true }),
        el("PartUsage", "M::root", "M", { types: ["M::Sub"] }),
      ]),
    );
    expect(d.net.elements.map((e) => e.id).sort()).toEqual(["M::root", "M::root::b", "M::root::s"]);
    expect(d.deriveIssues.map((i) => i.code)).toContain("REDEFINITION_IGNORED");
  });
});

describe("satisfy の対象が action のとき", () => {
  it("その action を担当する part への紐づけとして扱う(未紐づけと誤判定しない)", () => {
    const d = deriveNet(
      graph(
        [el("Package", "M", null), el("PartUsage", "M::p", "M"), el("ActionUsage", "M::p::act", "M::p", { parameters: [] }), el("RequirementUsage", "M::r", "M")],
        { satisfies: [{ requirement: "M::r", by: "M::p::act" }] },
      ),
    );
    expect(d.requirements[0]!.satisfiedBy).toEqual(["M::p"]);
    expect(d.deriveIssues.map((i) => i.code)).not.toContain("SATISFY_NOT_PART");
  });
});
