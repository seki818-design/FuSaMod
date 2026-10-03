import { describe, expect, it } from "vitest";
import { faultTreeFromNet } from "@fusamod/safety-core";
import { buildFmeaView } from "@fusamod/safety-core";
import { contains, layoutNested, overlaps, type NestedNode } from "../src/lib/layout.js";
import { structureTree } from "../src/lib/structure.js";
import { clipToBox, layoutScdl } from "../src/lib/scdl-layout.js";
import { layoutFaultTree } from "../src/lib/fta-layout.js";
import { layoutNet } from "../src/lib/net-layout.js";
import { analysis, safety } from "./helpers.js";

const leaf = (id: string): NestedNode => ({ id, label: id, children: [] });
const tree = (id: string, kids: NestedNode[]): NestedNode => ({ id, label: id, children: kids });

describe("入れ子レイアウト", () => {
  it("子は親の内側に収まり、兄弟どうしは重ならない", () => {
    const { boxes } = layoutNested([tree("a", [leaf("a1"), leaf("a2"), tree("a3", [leaf("a31"), leaf("a32"), leaf("a33"), leaf("a34")]), leaf("a4"), leaf("a5")]), leaf("b")]);
    const byId = new Map(boxes.map((b) => [b.id, b]));
    for (const b of boxes) if (b.parentId) expect(contains(byId.get(b.parentId)!, b)).toBe(true);
    for (const x of boxes) for (const y of boxes) if (x.id < y.id && x.parentId === y.parentId) expect(overlaps(x, y)).toBe(false);
    expect(boxes.filter((b) => b.depth === 0).map((b) => b.id)).toEqual(["a", "b"]);
  });
  it("葉の数が多くても全体のサイズが有限で、座標が負にならない", () => {
    const { boxes, width, height } = layoutNested([tree("r", Array.from({ length: 30 }, (_, i) => leaf(`k${i}`)))]);
    expect(boxes).toHaveLength(31);
    expect(Math.min(...boxes.map((b) => b.x), ...boxes.map((b) => b.y))).toBeGreaterThanOrEqual(0);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeLessThan(5000);
  });
  it("空の入力", () => {
    expect(layoutNested([])).toMatchObject({ boxes: [], height: expect.any(Number) });
  });
});

describe("構造図(デモプロジェクト)", () => {
  const a = analysis();
  it("構造ネットの全要素が箱になり、階層が入れ子に表れる", () => {
    const { boxes } = layoutNested(structureTree(a));
    expect(boxes).toHaveLength(a.net.elements.length);
    const byId = new Map(boxes.map((b) => [b.id, b]));
    for (const e of a.net.elements) if (e.parentId) expect(contains(byId.get(e.parentId)!, byId.get(e.id)!)).toBe(true);
    const motor = boxes.find((b) => b.label.startsWith("motor"))!;
    expect(motor.label).toContain("コンポーネント");
    expect(motor.lines).toEqual(["ƒ generate torque"]);
    expect(boxes.find((b) => b.label.startsWith("vcu"))!.label).toContain("ASIL B(D)");
  });
});

describe("SCDL 図(デモプロジェクト)", () => {
  const a = analysis();
  const d = layoutScdl(a.scdl);
  it("要求の箱は、配置先のエレメントの内側にあり、どの 2 つも重ならない", () => {
    const els = new Map(d.elements.map((e) => [e.id, e]));
    for (const r of d.requirements) {
      const model = a.scdl.requirements.find((x) => x.id === r.id)!;
      if (model.allocation) expect(contains(els.get(model.allocation)!, r)).toBe(true);
    }
    for (const x of d.requirements) for (const y of d.requirements) if (x.id < y.id) expect(overlaps(x, y)).toBe(false);
    // エレメントは入れ子(親の内側)
    for (const e of a.scdl.elements) if (e.parent) expect(contains(els.get(e.parent)!, els.get(e.id)!)).toBe(true);
  });
  it("外部との矢印・要求間の矢印・グループ・ペアリング・制約条件が揃う", () => {
    expect(d.arrows.map((x) => x.kind).sort()).toEqual(["boundary-in", "boundary-out", "interaction"]);
    expect(d.groups.map((g) => g.id).sort()).toEqual(["RG-IF-1", "SRG-SM-1"]);
    expect(d.groups.every((g) => g.links.length > 0)).toBe(true);
    expect(d.pairings).toHaveLength(1);
    expect(d.constraints[0]!.weight).toBe("B(D)");
    expect(d.constraintLinks).toHaveLength(1);
    // グループの楕円どうしは重ならない
    const [g1, g2] = d.groups;
    expect(Math.abs(g1!.cx - g2!.cx)).toBeGreaterThanOrEqual(g1!.rx + g2!.rx);
    expect(d.width).toBeGreaterThan(0);
    expect(d.height).toBeGreaterThan(0);
  });
  it("矢印の端は、要求の箱の境界上にある", () => {
    const rb = new Map(d.requirements.map((r) => [r.id, r]));
    const onBorder = (b: { x: number; y: number; w: number; h: number }, p: [number, number]) => {
      const eps = 0.01;
      const inX = p[0] >= b.x - eps && p[0] <= b.x + b.w + eps;
      const inY = p[1] >= b.y - eps && p[1] <= b.y + b.h + eps;
      return inX && inY && (Math.abs(p[0] - b.x) < eps || Math.abs(p[0] - b.x - b.w) < eps || Math.abs(p[1] - b.y) < eps || Math.abs(p[1] - b.y - b.h) < eps);
    };
    const inter = d.arrows.find((x) => x.kind === "interaction")!;
    const [src, tgt] = inter.id.split(">")[0]! === "SF-2" ? ["IF-1", "SM-1"] : [];
    expect(onBorder(rb.get(src!)!, inter.points[0]!)).toBe(true);
    expect(onBorder(rb.get(tgt!)!, inter.points[1]!)).toBe(true);
  });
  it("clipToBox: 中心から外へ向かう線は境界で止まる", () => {
    const b = { id: "x", label: "", lines: [], x: 0, y: 0, w: 100, h: 50, depth: 0, leaf: true };
    expect(clipToBox(b, [200, 25])).toEqual([100, 25]);
    expect(clipToBox(b, [50, -100])).toEqual([50, 0]);
    expect(clipToBox(b, [50, 25])).toEqual([50, 25]);
  });
});

describe("フォールトツリーの図", () => {
  const a = analysis();
  it("頂上が最上段で、子は下の段にあり、同じ段のノードは重ならない", () => {
    const ft = faultTreeFromNet(a.net, "FE-1");
    const d = layoutFaultTree(ft);
    const top = d.boxes.find((b) => b.id === ft.top)!;
    expect(top.y).toBe(Math.min(...d.boxes.map((b) => b.y)));
    for (const e of d.edges) expect(d.boxes.find((b) => b.id === e.to)!.y).toBeGreaterThan(d.boxes.find((b) => b.id === e.from)!.y);
    for (const x of d.boxes) for (const y of d.boxes) if (x.id < y.id && x.y === y.y) expect(x.x + x.w <= y.x || y.x + y.w <= x.x).toBe(true);
    expect(d.boxes.length).toBe(ft.nodes.length);
  });
  it("保存済みのツリー(AND/OR)", () => {
    const d = layoutFaultTree(safety().faultTrees[0]!);
    expect(d.boxes).toHaveLength(7);
    expect(d.boxes.find((b) => b.id === "TOP")!.node.gate).toBe("and");
  });
  it("循環があっても停止する", () => {
    const d = layoutFaultTree({ id: "t", name: "", top: "A", nodes: [{ id: "A", label: "", kind: "gate", gate: "or", inputs: ["B"] }, { id: "B", label: "", kind: "gate", gate: "or", inputs: ["A"] }] });
    expect(d.boxes.length).toBeGreaterThan(0);
  });
});

describe("ネットビュー", () => {
  const a = analysis();
  it("原因 → 故障モード → 影響が、左から右へ並ぶ", () => {
    const PT = "EvPowertrainDemo::vehicle::powertrain";
    const d = layoutNet(buildFmeaView(a.net, PT).rows, PT);
    const col = (c: string) => d.nodes.filter((n) => n.column === c);
    expect(col("mode").map((n) => n.id).sort()).toEqual(["FM-PT-1", "FM-PT-2"]);
    expect(col("cause").map((n) => n.id).sort()).toEqual(["FM-INV-1", "FM-INV-2", "FM-MOT-1", "FM-VCU-1", "FM-VCU-2"]);
    expect(col("effect").map((n) => n.id).sort()).toEqual(["FE-1", "FE-2"]);
    expect(Math.max(...col("cause").map((n) => n.x))).toBeLessThan(Math.min(...col("mode").map((n) => n.x)));
    expect(d.edges).toContainEqual({ from: "FM-VCU-1", to: "FM-PT-1" });
    expect(d.edges).toContainEqual({ from: "FM-PT-1", to: "FE-1" });
  });
});
