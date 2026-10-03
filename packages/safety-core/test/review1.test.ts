import { describe, expect, it } from "vitest";
import {
  determineAsil,
  minimalCutSets,
  singlePointFaults,
  topProbabilityUpperBound,
  validateElementAsil,
  validateAsilInheritance,
  validateDecompositions,
  validateHara,
  faultTreeFromNet,
  type Asil,
  type Decomposition,
  type FaultTree,
  type SafetyRequirement,
} from "../src/index.js";

const req = (id: string, asil: Asil, extra: Partial<SafetyRequirement> = {}): SafetyRequirement => ({ id, text: id, level: "fsr", asil, ...extra });
const codes = (xs: { code: string }[]) => xs.map((x) => x.code).sort();

describe("determineAsil の入力検証", () => {
  it("NaN・範囲外・小数は例外(QM を返して見逃さない)", () => {
    expect(() => determineAsil(NaN as 1, 1, 1)).toThrow(RangeError);
    expect(() => determineAsil(4 as 3, 1, 1)).toThrow(RangeError);
    expect(() => determineAsil(1, 5 as 4, 1)).toThrow(RangeError);
    expect(() => determineAsil(1.5 as 1, 1, 1)).toThrow(RangeError);
  });
  it("validateHara は範囲外でも例外を投げず HARA_RANGE を報告する", () => {
    const issues = validateHara({ events: [{ id: "E", hazard: "h", situation: "s", severity: NaN as 1, exposure: 9 as 4, controllability: 1 }], goals: [] });
    expect(codes(issues)).toContain("HARA_RANGE");
  });
  it("ASIL の付いた事象に安全目標が無いのはエラー", () => {
    const issues = validateHara({ events: [{ id: "E", hazard: "h", situation: "s", severity: 3, exposure: 4, controllability: 3, rationale: "r" }], goals: [] });
    expect(issues.find((i) => i.code === "EVENT_NO_GOAL")?.severity).toBe("error");
  });
});

describe("ASIL の継承規則", () => {
  const goals = [{ id: "SG-1", asil: "D" as Asil }];
  const dec: Decomposition = { id: "DEC", parentRequirementId: "F1", childRequirementIds: ["F1a", "F1b"], independenceEvidence: "DFA-PT-001(独立電源)" };
  it("正しい継承と分解は指摘なし", () => {
    const reqs = [req("F1", "D", { safetyGoalId: "SG-1" }), req("F1a", "B", { originAsil: "D", parentId: "F1" }), req("F1b", "B", { originAsil: "D", parentId: "F1" })];
    expect(validateAsilInheritance(reqs, [dec], goals)).toEqual([]);
  });
  it("FSR を D から A に黙って下げるとエラー", () => {
    const issues = validateAsilInheritance([req("F1", "A", { safetyGoalId: "SG-1" })], [], goals);
    expect(codes(issues)).toContain("REQ_BELOW_GOAL_ASIL");
  });
  it("安全目標レベルの要求が目標と異なる ASIL ならエラー", () => {
    const issues = validateAsilInheritance([req("S1", "QM", { level: "safety-goal", safetyGoalId: "SG-1" })], [], goals);
    expect(codes(issues)).toEqual(expect.arrayContaining(["SG_REQ_ASIL_MISMATCH", "REQ_BELOW_GOAL_ASIL"]));
  });
  it("子が親より低い ASIL(分解によらない)はエラー", () => {
    const issues = validateAsilInheritance([req("F1", "C", { safetyGoalId: "SG-1" }), req("F2", "A", { parentId: "F1" })], [], goals);
    expect(codes(issues)).toContain("REQ_ASIL_DOWNGRADE");
  });
  it("元 ASIL を名乗るが分解に属さない要求は偽装としてエラー", () => {
    const issues = validateAsilInheritance([req("F1", "D", { safetyGoalId: "SG-1" }), req("X", "A", { originAsil: "D", parentId: "F1" })], [], goals);
    expect(codes(issues)).toContain("DECOMP_ORPHAN");
  });
  it("ASIL 付きの安全目標に要求が 1 つも無ければエラー", () => {
    expect(codes(validateAsilInheritance([], [], goals))).toEqual(["GOAL_NO_FSR"]);
    expect(validateAsilInheritance([], [], [{ id: "SG-9", asil: "QM" }])).toEqual([]);
  });
  it("存在しない安全目標への参照はエラー", () => {
    expect(codes(validateAsilInheritance([req("F1", "D", { safetyGoalId: "NOPE" })], [], goals))).toContain("UNKNOWN_REF");
  });
});

describe("デコンポジションの重複と根拠", () => {
  const reqs = [req("P", "D"), req("A", "B", { originAsil: "D", parentId: "P" }), req("B", "B", { originAsil: "D", parentId: "P" }), req("C", "B", { originAsil: "D", parentId: "P" })];
  it("空白だけの根拠は未登録、短すぎる根拠は警告", () => {
    const d = (e: string): Decomposition => ({ id: "d", parentRequirementId: "P", childRequirementIds: ["A", "B"], independenceEvidence: e });
    expect(codes(validateDecompositions(reqs, [d(" ")]))).toEqual(["DECOMP_NO_EVIDENCE"]);
    expect(codes(validateDecompositions(reqs, [d("x")]))).toEqual(["DECOMP_EVIDENCE_WEAK"]);
    expect(codes(validateDecompositions(reqs, [d("aaaaaaaaaa")]))).toEqual(["DECOMP_EVIDENCE_WEAK"]);
  });
  it("同じ要求の二重分解・分解先の再利用はエラー", () => {
    const e = "DFA-PT-001(独立電源)";
    const issues = validateDecompositions(reqs, [
      { id: "d1", parentRequirementId: "P", childRequirementIds: ["A", "B"], independenceEvidence: e },
      { id: "d2", parentRequirementId: "P", childRequirementIds: ["B", "C"], independenceEvidence: e },
    ]);
    expect(codes(issues)).toEqual(expect.arrayContaining(["DECOMP_DUPLICATE_PARENT", "DECOMP_CHILD_REUSED"]));
  });
});

const gate = (id: string, g: "and" | "or", inputs: string[]) => ({ id, label: id, kind: "gate" as const, gate: g, inputs });
const basic = (id: string) => ({ id, label: id, kind: "basic" as const });

describe("FTA の堅牢性(空の結果を安全と誤読させない)", () => {
  it("循環は problems に出て、完全でない", () => {
    const t: FaultTree = { id: "t", name: "t", top: "T", nodes: [gate("T", "or", ["G", "a"]), gate("G", "and", ["T", "b"]), basic("a"), basic("b")] };
    const r = singlePointFaults(t);
    expect(r.complete).toBe(false);
    expect(r.problems.join()).toContain("循環");
  });
  it("AND に未知の入力があっても空にせず problems に出す", () => {
    const t: FaultTree = { id: "t", name: "t", top: "T", nodes: [gate("T", "and", ["a", "ghost"]), basic("a")] };
    const r = minimalCutSets(t);
    expect(r.problems.join()).toContain("ghost");
    expect(r.cutSets).toEqual([]);
  });
  it("入力の無いゲートは problems", () => {
    const t: FaultTree = { id: "t", name: "t", top: "T", nodes: [gate("T", "or", [])] };
    expect(minimalCutSets(t).problems.length).toBeGreaterThan(0);
  });
  it("深い鎖でもスタックオーバーフローしない", () => {
    const n = 50000;
    const nodes: FaultTree["nodes"] = [basic("b")];
    let prev = "b";
    for (let i = 0; i < n; i++) { nodes.push(gate(`g${i}`, "or", [prev])); prev = `g${i}`; }
    const r = singlePointFaults({ id: "t", name: "t", top: prev, nodes });
    expect(r).toEqual({ faults: ["b"], complete: true, problems: [] });
  });
  it("大量のカットセットは時間・件数の上限で打ち切られ、完全でないと示される", () => {
    // 12 個の OR(各 4 入力)の AND = 4^12 のカットセット
    const nodes: FaultTree["nodes"] = [];
    const ors: string[] = [];
    for (let i = 0; i < 12; i++) {
      const ins = [0, 1, 2, 3].map((j) => `b${i}_${j}`);
      ins.forEach((b) => nodes.push(basic(b)));
      nodes.push(gate(`o${i}`, "or", ins));
      ors.push(`o${i}`);
    }
    nodes.push(gate("T", "and", ors));
    const t0 = Date.now();
    const r = minimalCutSets({ id: "t", name: "t", top: "T", nodes } as FaultTree, { limit: 5000 });
    expect(r.truncated).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(singlePointFaults({ id: "t", name: "t", top: "T", nodes } as FaultTree).complete).toBe(false);
  });
  it("吸収則が正しく、かつ大きな入力でも速い", () => {
    const nodes: FaultTree["nodes"] = [basic("a"), basic("b"), basic("c")];
    nodes.push(gate("ab", "and", ["a", "b"]), gate("T", "or", ["a", "ab", "c"]));
    expect(minimalCutSets({ id: "t", name: "t", top: "T", nodes } as FaultTree).cutSets).toEqual([["a"], ["c"]]);
    const many: FaultTree["nodes"] = [];
    const ins: string[] = [];
    for (let i = 0; i < 3000; i++) { many.push(basic(`x${i}`), basic(`y${i}`), gate(`p${i}`, "and", [`x${i}`, `y${i}`])); ins.push(`p${i}`); }
    many.push(gate("T", "or", ins));
    const t0 = Date.now();
    expect(minimalCutSets({ id: "t", name: "t", top: "T", nodes: many }).cutSets.length).toBe(3000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("故障ネットに循環があっても、未展開の基本事象として残り、単一点故障 0 件が安全に見えない", () => {
    const net = {
      elements: [{ id: "E", name: "E" }],
      functions: [{ id: "F", ownerId: "E", name: "F" }],
      failures: [
        { id: "FM1", functionId: "F", description: "1" },
        { id: "FM2", functionId: "F", description: "2" },
      ],
      links: [
        { id: "L1", causeId: "FM2", effectId: "FM1" },
        { id: "L2", causeId: "FM1", effectId: "FM2" },
      ],
    };
    const t = faultTreeFromNet(net as never, "FM1");
    expect(t.nodes.some((n) => n.undeveloped)).toBe(true);
    expect(singlePointFaults(t).faults.length).toBeGreaterThan(0);
  });
});

describe("循環・導出・ID(ラウンド 2 の指摘)", () => {
  const e = "DFA-PT-001(独立電源)";
  it("自分自身への分解と、分解の循環はエラー", () => {
    const reqs = [req("P", "D"), req("A", "B", { originAsil: "D", parentId: "P" }), req("B", "B", { originAsil: "D", parentId: "P" })];
    expect(codes(validateDecompositions(reqs, [{ id: "d", parentRequirementId: "P", childRequirementIds: ["P", "A"], independenceEvidence: e }]))).toContain("DECOMP_CYCLE");
    const cyc = validateDecompositions(reqs, [
      { id: "d1", parentRequirementId: "P", childRequirementIds: ["A", "B"], independenceEvidence: e },
      { id: "d2", parentRequirementId: "A", childRequirementIds: ["P", "B"], independenceEvidence: e },
    ]);
    expect(codes(cyc)).toContain("DECOMP_CYCLE");
  });
  it("分解先が分解元から導出(parentId)されていなければエラー", () => {
    const reqs = [req("P", "D"), req("A", "B", { originAsil: "D" }), req("B", "B", { originAsil: "D", parentId: "P" })];
    expect(codes(validateDecompositions(reqs, [{ id: "d", parentRequirementId: "P", childRequirementIds: ["A", "B"], independenceEvidence: e }]))).toContain("DECOMP_CHILD_NOT_DERIVED");
  });
  it("要求の親子の循環・自己親はエラー", () => {
    const issues = validateAsilInheritance([req("X", "B", { parentId: "Y" }), req("Y", "B", { parentId: "X" }), req("Z", "B", { parentId: "Z" })], [], []);
    expect(codes(issues).filter((c) => c === "REQ_PARENT_CYCLE").length).toBe(3);
  });
  it("菱形に共有された原因があっても、FTA の導出は線形時間(30 段)", () => {
    const failures = [{ id: "F0", functionId: "fn", description: "base", isBasicCause: true }];
    const links: { id: string; causeId: string; effectId: string }[] = [];
    for (let i = 1; i <= 30; i++) {
      failures.push({ id: `A${i}`, functionId: "fn", description: "a" } as never, { id: `B${i}`, functionId: "fn", description: "b" } as never);
      const prev = i === 1 ? ["F0", "F0"] : [`A${i - 1}`, `B${i - 1}`];
      links.push({ id: `LA${i}`, causeId: prev[0]!, effectId: `A${i}` }, { id: `LB${i}`, causeId: prev[1]!, effectId: `B${i}` });
    }
    failures.push({ id: "TOP", functionId: "fn", description: "top" } as never);
    links.push({ id: "LT1", causeId: "A30", effectId: "TOP" }, { id: "LT2", causeId: "B30", effectId: "TOP" });
    const net = { elements: [{ id: "E", name: "E" }], functions: [{ id: "fn", ownerId: "E", name: "fn" }], failures, links } as never;
    const t0 = Date.now();
    const t = faultTreeFromNet(net, "TOP");
    expect(Date.now() - t0).toBeLessThan(500);
    expect(t.nodes.length).toBeLessThan(200);
  });
});

describe("元 ASIL の表記を盾にした引き下げ(ラウンド 3 の指摘)", () => {
  const goals = [{ id: "SG-1", asil: "D" as Asil }];
  const e = "DFA-PT-001(独立電源)";
  const base = [req("F1", "D", { safetyGoalId: "SG-1" }), req("F1a", "B", { originAsil: "D", parentId: "F1" }), req("F1b", "B", { originAsil: "D", parentId: "F1" })];
  const dec: Decomposition = { id: "DEC", parentRequirementId: "F1", childRequirementIds: ["F1a", "F1b"], independenceEvidence: e };
  it("分解先の子孫に QM(D) / A(D) を付けても、実際の ASIL が下がっていればエラー", () => {
    for (const a of ["QM", "A"] as Asil[]) {
      const issues = validateAsilInheritance([...base, req("T1", a, { originAsil: "D", parentId: "F1a" })], [dec], goals);
      expect(codes(issues)).toContain("REQ_ASIL_DOWNGRADE");
    }
  });
  it("分解先の子孫が、実際の ASIL を保ち、同じ元 ASIL の表記を引き継ぐのは正当", () => {
    expect(validateAsilInheritance([...base, req("T1", "B", { originAsil: "D", parentId: "F1a" })], [dec], goals)).toEqual([]);
  });
  it("子孫が、親と異なる元 ASIL を名乗るとエラー", () => {
    expect(codes(validateAsilInheritance([...base, req("T1", "B", { originAsil: "C", parentId: "F1a" })], [dec], goals))).toContain("DECOMP_ORPHAN");
  });
  it("分解に属さない D(D) の子に QM(D) は、偽装としてエラー", () => {
    const issues = validateAsilInheritance([req("F1", "D", { safetyGoalId: "SG-1" }), req("X", "QM", { originAsil: "D", parentId: "F1" })], [], goals);
    expect(codes(issues)).toEqual(expect.arrayContaining(["DECOMP_ORPHAN", "REQ_ASIL_DOWNGRADE"]));
  });
  it("分解表にない QM + QM への分解は、分解先でもエラー", () => {
    const reqs = [req("F1", "D", { safetyGoalId: "SG-1" }), req("A", "QM", { originAsil: "D", parentId: "F1" }), req("B", "QM", { originAsil: "D", parentId: "F1" })];
    expect(codes(validateDecompositions(reqs, [{ id: "d", parentRequirementId: "F1", childRequirementIds: ["A", "B"], independenceEvidence: e }]))).toContain("DECOMP_INVALID");
  });
});

describe("形だけの独立性の根拠 / 確率の上限(ラウンド 3)", () => {
  const e = (t: string) => validateDecompositions(
    [req("P", "D"), req("A", "B", { originAsil: "D", parentId: "P" }), req("B", "B", { originAsil: "D", parentId: "P" })],
    [{ id: "d", parentRequirementId: "P", childRequirementIds: ["A", "B"], independenceEvidence: t }],
  ).map((i) => i.code);
  it.each(["abcdabcd", "TODO TODO", "12345678", "aaaaaaaa", "TBD", "x"])("『%s』は形だけの根拠として警告", (t) => {
    expect(e(t)).toContain("DECOMP_EVIDENCE_WEAK");
  });
  it("文書番号つきの根拠は通る", () => {
    expect(e("DFA-PT-001(独立電源・独立クロック)")).toEqual([]);
  });
  it("未展開の事象や範囲外の確率があるとき、確率の上限は出さない", () => {
    const t: FaultTree = { id: "t", name: "t", top: "G", nodes: [{ id: "G", label: "g", kind: "gate", gate: "or", inputs: ["a", "b"] }, { id: "a", label: "a", kind: "basic", probability: 0.1 }, { id: "b", label: "b", kind: "basic", probability: 0.2, undeveloped: true }] };
    expect(topProbabilityUpperBound(t)).toBeUndefined();
    t.nodes[2] = { id: "b", label: "b", kind: "basic", probability: 0.2 };
    expect(topProbabilityUpperBound(t)).toBeCloseTo(0.28, 5);
    t.nodes[2] = { id: "b", label: "b", kind: "basic", probability: 2 };
    expect(topProbabilityUpperBound(t)).toBeUndefined();
  });
});

describe("意図機能・安全機構の ASIL(ラウンド 4 の指摘)", () => {
  const reqs = [req("F1", "D", { safetyGoalId: "SG-1" }), req("F1a", "B", { originAsil: "D", parentId: "F1" })];
  const fn = (o: Partial<import("../src/index.js").IntendedFunction> = {}) => ({ id: "IF-1", name: "f", elementId: "E", asil: "B" as Asil, originAsil: "D" as Asil, requirementIds: ["F1a"], ...o });
  it("正当な B(D) の意図機能は指摘なし", () => {
    expect(validateElementAsil([fn()], [], reqs)).toEqual([]);
  });
  it("紐づく要求より低い ASIL(QM)にするとエラー", () => {
    expect(codes(validateElementAsil([fn({ asil: "QM" })], [], reqs))).toContain("ELEMENT_ASIL_BELOW_REQ");
    expect(codes(validateElementAsil([], [{ id: "SM-1", name: "m", elementId: "E", asil: "A", originAsil: "D", requirementIds: ["F1a"] }], reqs))).toContain("ELEMENT_ASIL_BELOW_REQ");
  });
  it("要求に紐づかない元 ASIL の表記(偽装)はエラー", () => {
    expect(codes(validateElementAsil([fn({ requirementIds: [], id: "IF-9" })], [], reqs))).toContain("DECOMP_ORPHAN");
    expect(codes(validateElementAsil([fn({ originAsil: "C" })], [], reqs))).toContain("DECOMP_ORPHAN");
  });
  it("要求に紐づかない QM の意図機能は確認を促す(警告)", () => {
    const i = validateElementAsil([{ id: "IF-2", name: "f", elementId: "E", asil: "QM" }], [], reqs);
    expect(i.map((x) => [x.code, x.severity])).toEqual([["ELEMENT_QM_UNLINKED", "warning"]]);
  });
});

describe("形だけの根拠の追加例", () => {
  const e = (t: string) => validateDecompositions(
    [req("P", "D"), req("A", "B", { originAsil: "D", parentId: "P" }), req("B", "B", { originAsil: "D", parentId: "P" })],
    [{ id: "d", parentRequirementId: "P", childRequirementIds: ["A", "B"], independenceEvidence: t }],
  ).map((i) => i.code);
  it.each(["asdfghjk", "DFA-XXX-000", "DFA TBD 1234", "ダミーの根拠 001"])("『%s』は警告", (t) => expect(e(t)).toContain("DECOMP_EVIDENCE_WEAK"));
});
