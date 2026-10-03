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
  it("上位の型(:>)の中身も展開され、定義内の再定義も(別の名前の使用として)反映される", () => {
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
    expect(d.net.elements.map((e) => e.id).sort()).toEqual(["M::root", "M::root::b", "M::root::r", "M::root::s"]);
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

describe("satisfy の経路・特殊化・再定義・ref(公式実装の出力で確認)", () => {
  const T = "T2";
  // 元のモデルは examples/sysml/instance-paths.sysml
  const d = deriveNet(ex("instance-paths.graph.json"));
  const sat = (r: string) => d.requirements.find((x) => x.id === `${T}::${r}`)!.satisfiedBy;
  it("car1.front への satisfy は car1 の front だけに紐づく(car2 や他の複製には付かない)", () => {
    expect(sat("r1")).toContain(`${T}::car1::front`);
    expect(sat("r1")).not.toContain(`${T}::car2::front`);
    expect(sat("r1")).toContain(`${T}::sat1`); // by を省略した satisfy は、囲んでいる part が満たす
  });
  it("連鎖 car2.front.rotor は、その経路の 1 要素だけ", () => {
    expect(sat("r2")).toEqual([`${T}::car2::front::rotor`]);
  });
  it("usage 側の再定義(:>> ax)は、定義側の中身を引き継ぎ、追加した子も持つ", () => {
    const ids = d.net.elements.map((e) => e.id);
    expect(ids).toContain(`${T}::car1::ax`);
    expect(ids).toContain(`${T}::car1::ax::w1`);
    expect(ids).toContain(`${T}::car2::ax`);
  });
  it("特殊化(sub1 :> base)は、base の子も持つ", () => {
    const ids = d.net.elements.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([`${T}::sub1::b1`, `${T}::sub1::d1`]));
  });
  it("ref part は構造の子に入れず、警告する", () => {
    expect(d.net.elements.map((e) => e.id)).not.toContain(`${T}::holder::r`);
    expect(d.deriveIssues.some((i) => i.code === "UNSUPPORTED_CONSTRUCT" && i.message.includes("ref"))).toBe(true);
  });
  it("入れ子の requirement の親子が残る", () => {
    expect(d.requirements.find((x) => x.id === `${T}::outer::inner`)!.parentId).toBe(`${T}::outer`);
  });
  it("経路を特定できない satisfy は、紐づけずに警告する", () => {
    const g = ex("instance-paths.graph.json");
    const bad = { ...g, satisfies: [{ requirement: `${T}::r1`, by: `${T}::Car::front`, byChain: [`${T}::car1`, `${T}::Car::nonexistent`] }] };
    const r = deriveNet(bad);
    expect(r.deriveIssues.map((i) => i.code)).toContain("SATISFY_UNRESOLVED");
    expect(r.requirements.find((x) => x.id === `${T}::r1`)!.satisfiedBy).toEqual([]);
  });
});

describe("定義の入れ子・ref・多重度・名前のない再定義(公式実装の出力で確認)", () => {
  const d = deriveNet(ex("nested-definitions.graph.json"));
  const ids = d.net.elements.map((e) => e.id);
  it("定義内の入れ子の part の中の型付き使用も展開される", () => {
    expect(ids).toEqual(expect.arrayContaining(["T3::car1::aux::pack", "T3::car1::aux::pack::bms", "T3::car1::aux::pack::cells", "T3::car1::aux::pack::cells::elec"]));
  });
  it("定義内の ref part は、複製の子にも入れず警告する", () => {
    expect(ids.some((i) => i.endsWith("::charger"))).toBe(false);
    expect(d.deriveIssues.some((i) => i.code === "UNSUPPORTED_CONSTRUCT" && i.message.includes("charger"))).toBe(true);
  });
  it("多重度の上限が 1 を超えると、1 つとして扱うことを警告する", () => {
    expect(d.deriveIssues.some((i) => i.code === "MULTIPLICITY_IGNORED" && i.message.includes("cells"))).toBe(true);
  });
  it("名前のない再定義(part :>> main)は、再定義している特徴の名前になり、中身も引き継ぐ", () => {
    expect(ids).toEqual(expect.arrayContaining(["T3::car1::main", "T3::car1::main::extra", "T3::car1::main::bms", "T3::car1::main::cells"]));
    expect(d.net.elements.find((e) => e.id === "T3::car1::main")!.name).toBe("main");
  });
  it("入れ子の requirement は、親の satisfy を引き継ぐ(未紐づけと誤判定しない)", () => {
    expect(d.requirements.find((r) => r.id === "T3::r1::sub")!.satisfiedBy).toEqual(["T3::car1::main"]);
  });
});

describe("定義の中の再定義・最上位の多重度・requirement def(公式実装の出力で確認)", () => {
  const T = "DefRedefinition";
  const d = deriveNet(ex("definition-redefinition.graph.json"));
  const ids = d.net.elements.map((e) => e.id);
  it("定義の中の再定義(:>> cells)が、すべてのインスタンスに同じように反映される", () => {
    for (const v of ["v", "v2"]) {
      expect(ids).toEqual(expect.arrayContaining([`${T}::${v}::cells`, `${T}::${v}::cells::extra`, `${T}::${v}::bms`]));
    }
    expect(d.deriveIssues.some((i) => i.code === "REDEFINITION_IGNORED")).toBe(false);
  });
  it("最上位の多重度(wheels : Cell [4])も警告する", () => {
    expect(d.deriveIssues.some((i) => i.code === "MULTIPLICITY_IGNORED" && i.message.includes("wheels"))).toBe(true);
  });
  it("requirement def の本文と入れ子の要求が、型付きの requirement に展開される(幽霊要求を作らない)", () => {
    const ids = d.requirements.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([`${T}::ra`, `${T}::ra::subA`]));
    expect(ids.some((i) => i.startsWith(`${T}::Rd`))).toBe(false);
    expect(d.requirements.find((r) => r.id === `${T}::ra`)!.text).toBe("定義の本文");
    expect(d.requirements.find((r) => r.id === `${T}::ra::subA`)!.parentId).toBe(`${T}::ra`);
  });
  it("完全修飾名の無い要素があっても落ちず、警告する", () => {
    const g = ex("definition-redefinition.graph.json");
    const r = deriveNet({ ...g, elements: [...g.elements, { kind: "PartUsage", name: "broken", owner: null } as never] });
    expect(r.deriveIssues.some((i) => i.code === "INVALID_ELEMENT")).toBe(true);
  });
});
