import { describe, expect, it } from "vitest";
import { analyzeProject } from "@fusamod/analysis";
import { RefIndex, RuleBasedProvider, applyOperations, riskChanges, tokenize, type Operation } from "../src/index.js";
import { ctx, graph, refs, safety } from "./helpers.js";

describe("操作の適用(原子的・検証つき)", () => {
  const add = (id: string): Operation => ({ op: "addFailure", failure: { id, description: "x", functionId: "f" } });
  it("追加と評価値の設定ができ、入力は変更されない", () => {
    const s = safety();
    const before = JSON.stringify(s);
    const r = applyOperations(s, [add("NEW-1"), { op: "setLinkRatings", linkId: "L01", occurrence: 5 }, { op: "setSeverity", failureId: "FE-1", severity: 9 }]);
    expect(r.ok).toBe(true);
    expect(r.data.failures.some((f) => f.id === "NEW-1")).toBe(true);
    expect(r.data.links.find((l) => l.id === "L01")!.occurrence).toBe(5);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("ID の重複や存在しない対象があれば、全体を適用しない", () => {
    const s = safety();
    const r = applyOperations(s, [add("NEW-2"), add("FE-1"), { op: "setLinkRatings", linkId: "NOPE", occurrence: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain("操作 2(addFailure)");
    expect(r.data).toBe(s);
  });
  it("適用後にスキーマに合わなければ拒否する", () => {
    const r = applyOperations(safety(), [{ op: "addFailure", failure: { id: "BAD", description: "x".repeat(6000), functionId: "f" } }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("適用後のデータが不正");
  });
});

describe("参照資料の検索(根拠つき)", () => {
  const idx = refs();
  it("関連する記述を、資料名と行番号つきで返す", () => {
    const hits = idx.search("独立監視マイコンの電源は?");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.chunk.source).toBe("システム設計方針.md");
    expect(hits[0]!.chunk.text).toContain("別の電源");
    expect(hits[0]!.chunk.lines[0]).toBeGreaterThan(0);
  });
  it("無関係な質問には何も返さない", () => {
    expect(idx.search("今日の天気は晴れですか")).toEqual([]);
    expect(new RefIndex([]).search("電源")).toEqual([]);
  });
  it("日本語は 2 文字の連続で、英数字は語で分ける", () => {
    expect(tokenize("FTTI 100ms 安全状態")).toEqual(["ftti", "100ms", "安全", "全状", "状態"]);
  });
});

describe("ルールベースの支援", () => {
  const p = new RuleBasedProvider();

  it("故障モードが未定義の機能に、故障モード候補を提案する(承認前。安全機構の機能にはリンクを付けない)", async () => {
    const c = ctx("safetyMonitor の FMEA を実施して");
    const r = await p.propose(c);
    expect(r.proposals).toHaveLength(1);
    const ops = r.proposals[0]!.operations;
    expect(ops.filter((o) => o.op === "addFailure")).toHaveLength(2);
    expect(ops.some((o) => o.op === "addLink")).toBe(false);
    expect(r.proposals[0]!.rationale).toContain("評価値");
    expect(r.reply).toContain("未確定");
    // 適用後も、エラーは増えない
    const applied = applyOperations(c.safety, ops);
    expect(applied.ok).toBe(true);
    const after = analyzeProject(graph(), applied.data);
    expect(after.summary.errors).toBe(0);
    expect(after.issues.map((i) => i.code)).not.toContain("FUNCTION_WITHOUT_FAILURE");
    // 提案は叩き台なので、原因・影響が未定義であることは引き続き警告される
    expect(after.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["NO_EFFECT", "NO_CAUSE"]));
  });

  it("上位機能に同種の故障モードがあれば、リンクを提案する", async () => {
    const s = safety();
    // モータの機能の故障モードを取り除いた状態
    s.failures = s.failures.filter((f) => !["FM-MOT-1", "FC-MOT-1"].includes(f.id));
    s.links = s.links.filter((l) => !["L17", "L18"].includes(l.id));
    const r = await p.propose(ctx("motor の FMEA", s));
    const ops = r.proposals[0]!.operations;
    const links = ops.filter((o): o is Extract<Operation, { op: "addLink" }> => o.op === "addLink");
    expect(links.map((l) => l.link.effectId).sort()).toEqual(["FM-PT-1", "FM-PT-2"]); // 過大→FM-PT-1、喪失→FM-PT-2
    expect(applyOperations(s, ops).ok).toBe(true);
  });

  it("すべて定義済みなら提案しない", async () => {
    const s = safety();
    const r = await p.propose(ctx("motor の FMEA", s));
    expect(r.proposals).toEqual([]);
    expect(r.reply).toContain("すでに");
  });

  it("変更影響: 故障 ID から、影響を受ける FMEA を示す", async () => {
    const r = await p.propose(ctx("FM-PT-1 の影響分析"));
    expect(r.reply).toContain("影響を受ける FMEA");
    expect(r.reply).toContain("vcu");
    expect(r.reply).toContain("vehicle");
  });

  it("要約・レビュー", async () => {
    expect((await p.propose(ctx("図の要約"))).reply).toContain("構造と機能");
    const rv = await p.propose(ctx("安全の観点でレビュー"));
    expect(rv.reply).toContain("警告");
    expect(rv.reply).toContain("専門家の確認の代わりにはなりません");
  });

  it("ASIL 分解の説明と HARA の ASIL 判定", async () => {
    const d = await p.propose(ctx("ASIL D の分解を教えて"));
    expect(d.reply).toContain("B(D)+B(D)");
    expect(d.reply).toContain("独立");
    expect((await p.propose(ctx("S3 E4 C3 の ASIL は?"))).reply).toContain("ASIL は D");
    expect((await p.propose(ctx("S2 E3 C2 だと?"))).reply).toContain("ASIL は A");
  });

  it("参照資料に根拠があれば出典つきで答え、無ければ答えない", async () => {
    const ok = await p.propose(ctx("安全状態は何ですか"));
    expect(ok.citations.length).toBeGreaterThan(0);
    expect(ok.citations[0]!.source).toMatch(/\.md$/);
    const ng = await p.propose(ctx("社員食堂のメニューは"));
    expect(ng.citations).toEqual([]);
    expect(ng.reply).toContain("根拠のない推測では回答しません");
  });
});

describe("riskChanges: リスクを下げうる変更の分類(ラウンド 5)", () => {
  const base = () => structuredClone(safety());
  it("分解の追加・管理策の記述の削除・評価の新規設定・HARA の低下・確率の低下・削除を、リスク低下として分類する", () => {
    const before = base();
    const after = base();
    after.decompositions.push({ id: "DEC-X", parentRequirementId: after.safetyRequirements[0]!.id, childRequirementIds: [after.safetyRequirements[1]!.id, after.safetyRequirements[2]!.id] } as never);
    after.hara.events[0]!.severity = 1;
    after.hara.goals[0]!.asil = "A";
    after.failures.pop();
    const l = after.links[0]!; l.preventionControl = "";
    const kinds = riskChanges(before, after).filter((c) => c.lowersRisk).map((c) => c.field);
    expect(kinds).toEqual(expect.arrayContaining(["分解(追加)", "S", "goalAsil", "削除(故障ノード)"]));
  });
  it("リスクを上げる変更は、差分には出るがリスク低下ではない", () => {
    const before = base();
    const after = base();
    after.hara.events[0]!.severity = 3;
    const f = after.failures.find((x) => x.severity !== undefined)!; f.severity = 10;
    const c = riskChanges(before, after);
    expect(c.every((x) => !x.lowersRisk)).toBe(true);
  });
});

describe("riskChanges: 追加の分類(ラウンド 6)", () => {
  const base = () => structuredClone(safety());
  const lowered = (mutate: (s: ReturnType<typeof base>) => void) => {
    const a = base(); const b = base(); mutate(b);
    return riskChanges(a, b).filter((c) => c.lowersRisk).map((c) => c.field);
  };
  it("安全要求の ASIL を QM に降格", () => expect(lowered((s) => { s.safetyRequirements[0]!.asil = "QM"; })).toContain("asil"));
  it("安全機構の ASIL・安全状態の削除・診断カバレッジの向上の主張", () => {
    expect(lowered((s) => { s.mechanisms[0]!.asil = "QM"; })).toContain("asil");
    expect(lowered((s) => { delete s.mechanisms[0]!.safeState; })).toContain("safeState");
    expect(lowered((s) => { s.mechanisms[0]!.diagnosticCoverage = "high"; s.mechanisms[0]!.coversFailureIds!.push("FM-NEW"); })).toEqual(expect.arrayContaining(["coversFailureIds"]));
  });
  it("対象の故障を減らす/診断カバレッジを下げるのは、リスクを上げる方向(低下ではない)", () => {
    expect(lowered((s) => { s.mechanisms[0]!.coversFailureIds = []; })).not.toContain("coversFailureIds");
  });
  it("AP 表を全部 L にすると、H の件数の減少としてリスク低下", () => {
    const a = base(); const b = base();
    b.apTable = [{ s: [1, 10], o: [1, 10], d: [1, 10], ap: "L" }];
    expect(riskChanges(a, b).some((c) => c.id === "apTable" && c.lowersRisk)).toBe(true);
  });
  it("FTA: OR → AND、入力の削除、基本事象の付け替えをリスク低下として分類", () => {
    const a = base();
    a.faultTrees = [{ id: "FT", name: "t", top: "G", nodes: [{ id: "G", label: "g", kind: "gate", gate: "or", inputs: ["a", "b"] }, { id: "a", label: "a", kind: "basic", failureId: "F1" }, { id: "b", label: "b", kind: "basic" }] }];
    const b = structuredClone(a);
    b.faultTrees[0]!.nodes[0] = { id: "G", label: "g", kind: "gate", gate: "and", inputs: ["a"] };
    b.faultTrees[0]!.nodes[1] = { id: "a", label: "a", kind: "basic", failureId: "F2" };
    const f = riskChanges(a, b).filter((c) => c.lowersRisk).map((c) => c.field);
    expect(f).toEqual(expect.arrayContaining(["gate", "inputs", "failureId"]));
  });
});

describe("riskChanges: ハードウェア故障モード", () => {
  it("診断カバレッジの向上・故障率の低下・削除は、メトリクスを良く見せる変更としてリスク低下", () => {
    const a = structuredClone(safety());
    const b = structuredClone(a);
    b.hardwareFailureModes![0]!.dcSpfRf = 0.999;
    b.hardwareFailureModes![1]!.fit = 1;
    b.hardwareFailureModes!.pop();
    const f = riskChanges(a, b).filter((c) => c.lowersRisk).map((c) => c.field);
    expect(f).toEqual(expect.arrayContaining(["dcSpfRf", "fit", "削除(ハードウェア故障モード)"]));
  });
});

describe("riskChanges: ハードウェア・独立性(ラウンド 8)", () => {
  const base = () => structuredClone(safety());
  const lowers = (b: ReturnType<typeof base>, a: ReturnType<typeof base>) => riskChanges(b, a).filter((c) => c.lowersRisk).map((c) => `${c.id}.${c.field}`);
  it("DC を主張するモードの追加、高 DC モードの故障率の増加、未設定からの DC・安全な故障の設定はリスク低下の主張", () => {
    const before = base();
    const after = base();
    after.hardwareFailureModes!.push({ id: "HW-9", name: "追加", fit: 500, type: "single", dcSpfRf: 0.99 });
    after.hardwareFailureModes![0]!.fit = 100; // HW-1: dc 0.9 → 分母が増えて SPFM が改善
    after.hardwareFailureModes![0]!.safeFraction = 0.5;
    const got = lowers(before, after);
    expect(got).toEqual(expect.arrayContaining(["HW-9.追加(ハードウェア故障モード)", "HW-1.fit", "HW-1.safeFraction"]));
  });
  it("DC を持たないモードの追加はリスク低下ではない。対象の安全目標を絞る・独立性の記述を消すのはリスク低下", () => {
    const before = base();
    const after = base();
    after.hardwareFailureModes!.push({ id: "HW-9", name: "追加", fit: 5, type: "single" });
    expect(lowers(before, after)).toEqual([]);
    after.hardwareFailureModes![0]!.goalIds = [];
    after.hardwareFailureModes![1]!.goalIds = ["SG-2"];
    after.pairs[0]!.independence = "";
    expect(lowers(before, after)).toEqual(expect.arrayContaining(["HW-2.goalIds", "PAIR-1.independence"]));
  });
});

describe("riskChanges: 要求の付け替えによる ASIL の迂回(ラウンド 8)", () => {
  it("意図機能の紐づけを、ASIL の低い安全目標の要求へ付け替えるのは、ASIL を下げる迂回としてリスク低下になる", () => {
    const before = structuredClone(safety());
    const after = structuredClone(before);
    const f = after.intendedFunctions[0]!;
    // 新しい要求(安全目標 SG-2 = ASIL A)を作り、意図機能をそちらへ付け替える
    after.safetyRequirements.push({ id: "FSR-LOW", text: "低い目標の要求", asil: "A", safetyGoalId: "SG-2" } as never);
    f.requirementIds = ["FSR-LOW"];
    const c = riskChanges(before, after).find((x) => x.field === "requirementIds(意図機能)");
    expect(c?.lowersRisk).toBe(true);
  });
});
