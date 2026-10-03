import { describe, expect, it } from "vitest";
import {
  determineAsil,
  eventAsil,
  faultTreeFromNet,
  goalAsilFromEvents,
  minimalCutSets,
  singlePointFaults,
  topProbabilityUpperBound,
  validateFaultTree,
  validateHara,
  type Asil,
  type FaultTree,
  type HaraData,
} from "../src/index.js";
import { sampleNet } from "./fixtures.js";

// ISO 26262-3 Table 4(列: C1, C2, C3)
const TABLE: Record<string, Asil[]> = {
  "1,1": ["QM", "QM", "QM"], "1,2": ["QM", "QM", "QM"], "1,3": ["QM", "QM", "A"], "1,4": ["QM", "A", "B"],
  "2,1": ["QM", "QM", "QM"], "2,2": ["QM", "QM", "A"], "2,3": ["QM", "A", "B"], "2,4": ["A", "B", "C"],
  "3,1": ["QM", "QM", "A"], "3,2": ["QM", "A", "B"], "3,3": ["A", "B", "C"], "3,4": ["B", "C", "D"],
};

describe("ASIL 判定(ISO 26262-3 Table 4)", () => {
  for (const [key, row] of Object.entries(TABLE)) {
    const [s, e] = key.split(",").map(Number) as [1 | 2 | 3, 1 | 2 | 3 | 4];
    row.forEach((expected, i) => {
      it(`S${s} E${e} C${i + 1} → ${expected}`, () => {
        expect(determineAsil(s, e, (i + 1) as 1 | 2 | 3)).toBe(expected);
      });
    });
  }
  it("S/E/C のいずれかが 0 なら QM", () => {
    expect(determineAsil(0, 4, 3)).toBe("QM");
    expect(determineAsil(3, 0, 3)).toBe("QM");
    expect(determineAsil(3, 4, 0)).toBe("QM");
  });
});

const hara = (): HaraData => ({
  events: [
    { id: "HE-1", hazard: "意図しない過大トルク", situation: "市街地走行", severity: 3, exposure: 4, controllability: 3, rationale: "x", safetyGoalId: "SG-1" },
    { id: "HE-2", hazard: "駆動トルク喪失", situation: "高速道路", severity: 2, exposure: 3, controllability: 2, rationale: "x", safetyGoalId: "SG-2" },
  ],
  goals: [
    { id: "SG-1", text: "意図しない過大トルクを避ける", asil: "D", ftti: 100, safeState: "トルク 0" },
    { id: "SG-2", text: "駆動トルク喪失を避ける", asil: "A", ftti: 500, safeState: "路肩退避の警告" },
  ],
});

describe("HARA の検証", () => {
  it("整合したデータは指摘なし", () => {
    expect(eventAsil(hara().events[0]!)).toBe("D");
    expect(eventAsil(hara().events[1]!)).toBe("A");
    expect(validateHara(hara())).toEqual([]);
  });
  it("安全目標の ASIL が事象の最大と違うとエラー", () => {
    const h = hara();
    h.goals[0]!.asil = "C";
    expect(validateHara(h).map((i) => i.code)).toContain("GOAL_ASIL_MISMATCH");
    expect(goalAsilFromEvents(h, "SG-1")).toBe("D");
  });
  it("安全目標が無い ASIL 事象・根拠なし・FTTI/安全状態なしを警告", () => {
    const h = hara();
    delete h.events[0]!.safetyGoalId;
    delete h.events[0]!.rationale;
    h.goals[0]!.asil = "D";
    delete h.goals[0]!.ftti;
    delete h.goals[0]!.safeState;
    const codes = validateHara(h).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["EVENT_NO_GOAL", "EVENT_NO_RATIONALE", "GOAL_NO_EVENT", "GOAL_NO_FTTI", "GOAL_NO_SAFE_STATE"]));
  });
  it("範囲外・未知の参照・重複 ID", () => {
    const h = hara();
    h.events[0]!.severity = 4 as never;
    h.events[1]!.safetyGoalId = "NOPE";
    h.goals.push({ ...h.goals[0]! });
    expect(validateHara(h).map((i) => i.code)).toEqual(expect.arrayContaining(["HARA_RANGE", "UNKNOWN_REF", "DUP_ID"]));
  });
});

const tree = (): FaultTree => ({
  id: "FT",
  name: "過大トルク",
  top: "TOP",
  nodes: [
    { id: "TOP", label: "過大トルク", kind: "gate", gate: "and", inputs: ["G1", "G2"] },
    { id: "G1", label: "制御系の故障", kind: "gate", gate: "or", inputs: ["A", "B"] },
    { id: "G2", label: "監視の故障", kind: "gate", gate: "or", inputs: ["C", "A"] },
    { id: "A", label: "共通電源", kind: "basic", probability: 0.01 },
    { id: "B", label: "ゲート駆動", kind: "basic", probability: 0.1 },
    { id: "C", label: "監視ソフト", kind: "basic", probability: 0.2 },
  ],
});

describe("フォールトツリー", () => {
  it("最小カットセットと単一故障(共通原因 A が単一点)", () => {
    const { cutSets, truncated } = minimalCutSets(tree());
    expect(truncated).toBe(false);
    // TOP = (A+B)·(C+A) = A + B·C
    expect(cutSets).toEqual([["A"], ["B", "C"]]);
    expect(singlePointFaults(tree())).toEqual({ faults: ["A"], complete: true, problems: [] });
  });
  it("頂上事象確率の上限", () => {
    // 1 - (1-0.01)(1-0.1*0.2) = 0.0298
    expect(topProbabilityUpperBound(tree())).toBeCloseTo(0.0298, 10);
    const t = tree();
    delete t.nodes.find((n) => n.id === "C")!.probability;
    expect(topProbabilityUpperBound(t)).toBeUndefined();
  });
  it("検証: 整合したツリーは指摘なし", () => {
    expect(validateFaultTree(tree())).toEqual([]);
  });
  it("検証: 循環・未知の参照・入力なしゲート・確率範囲・到達不能", () => {
    const t = tree();
    t.nodes.find((n) => n.id === "G1")!.inputs = ["A", "TOP"];
    t.nodes.push({ id: "G3", label: "", kind: "gate", gate: "or", inputs: [] });
    t.nodes.push({ id: "Z", label: "", kind: "basic", probability: 2 });
    t.nodes.find((n) => n.id === "G2")!.inputs = ["NOPE"];
    const codes = validateFaultTree(t).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["FT_CYCLE", "UNKNOWN_REF", "GATE_NO_INPUT", "PROBABILITY_RANGE", "FT_UNREACHABLE"]));
  });
  it("上限を超える展開は打ち切りを報告する", () => {
    const n = 12;
    const nodes: FaultTree["nodes"] = [{ id: "TOP", label: "", kind: "gate", gate: "and", inputs: [] }];
    for (let i = 0; i < n; i++) {
      nodes.push({ id: `O${i}`, label: "", kind: "gate", gate: "or", inputs: [`a${i}`, `b${i}`, `c${i}`] });
      for (const p of ["a", "b", "c"]) nodes.push({ id: `${p}${i}`, label: "", kind: "basic" });
      nodes[0]!.inputs!.push(`O${i}`);
    }
    expect(minimalCutSets({ id: "T", name: "", top: "TOP", nodes }, { limit: 1000 }).truncated).toBe(true);
  });
});

describe("故障ネットからのフォールトツリー導出", () => {
  it("上位の故障から原因をたどって OR ゲートで構成する", () => {
    const net = sampleNet();
    const t = faultTreeFromNet(net, "x-veh");
    expect(validateFaultTree(t).filter((i) => i.severity === "error")).toEqual([]);
    // 走行不能 ← 駆動トルクが出ない ← トルクが発生しない ← 巻線短絡(根本原因)
    expect(minimalCutSets(t).cutSets).toEqual([["x-wind"]]);
    expect(t.nodes.find((n) => n.id === "x-wind")).toMatchObject({ kind: "basic", failureId: "x-wind" });
    expect(t.nodes.find((n) => n.id === "x-wind")!.undeveloped).toBeUndefined();
  });
  it("原因が無く根本原因でもない故障は未展開として警告する", () => {
    const net = sampleNet();
    net.failures.find((f) => f.id === "x-wind")!.isBasicCause = false;
    const t = faultTreeFromNet(net, "x-veh");
    expect(validateFaultTree(t).map((i) => i.code)).toContain("FT_UNDEVELOPED");
  });
  it("共有された原因は 1 つのノードを再利用し、カットセットは吸収される", () => {
    const net = sampleNet();
    net.failures.push({ id: "x-sensor", description: "センサ故障", functionId: "f-pt" });
    net.links.push({ id: "l4", causeId: "x-sensor", effectId: "x-pt", occurrence: 2, detection: 2 });
    net.links.push({ id: "l5", causeId: "x-wind", effectId: "x-pt", occurrence: 2, detection: 2 });
    const t = faultTreeFromNet(net, "x-veh");
    expect(t.nodes.filter((n) => n.id === "x-wind")).toHaveLength(1);
    expect(minimalCutSets(t).cutSets).toEqual([["x-sensor"], ["x-wind"]]);
  });
});

describe("ISO 26262-3 Table 4(全 80 通り)を、式ではなく表そのもので確認する", () => {
  // 表を文字どおり書き写したもの(実装の式とは独立): S → E → [C1, C2, C3]
  const TABLE: Record<number, Record<number, Asil[]>> = {
    1: { 1: ["QM", "QM", "QM"], 2: ["QM", "QM", "QM"], 3: ["QM", "QM", "A"], 4: ["QM", "A", "B"] },
    2: { 1: ["QM", "QM", "QM"], 2: ["QM", "QM", "A"], 3: ["QM", "A", "B"], 4: ["A", "B", "C"] },
    3: { 1: ["QM", "QM", "A"], 2: ["QM", "A", "B"], 3: ["A", "B", "C"], 4: ["B", "C", "D"] },
  };
  it("S0〜3 × E0〜4 × C0〜3 の 80 通りすべてが表と一致する(0 を含むものは QM)", () => {
    let n = 0;
    for (let s = 0; s <= 3; s++)
      for (let e = 0; e <= 4; e++)
        for (let c = 0; c <= 3; c++) {
          const expected: Asil = s === 0 || e === 0 || c === 0 ? "QM" : TABLE[s]![e]![c - 1]!;
          expect([s, e, c, determineAsil(s as 0, e as 0, c as 0)]).toEqual([s, e, c, expected]);
          n++;
        }
    expect(n).toBe(80);
  });
});

describe("同じ故障ノードを指す基本事象（ラウンド 10）", () => {
  it("2 つの基本事象が同じ failureId を指すとエラー（独立とみなして単一点故障を隠さない）", () => {
    const t = { id: "FT", name: "t", top: "G", nodes: [
      { id: "G", label: "g", kind: "gate" as const, gate: "and" as const, inputs: ["A", "B"] },
      { id: "A", label: "a", kind: "basic" as const, failureId: "F-1", probability: 1e-6 },
      { id: "B", label: "b", kind: "basic" as const, failureId: "F-1", probability: 1e-6 },
    ] };
    expect(validateFaultTree(t).map((i) => `${i.severity}:${i.code}`)).toContain("error:FT_DUPLICATE_FAILURE");
  });
});
