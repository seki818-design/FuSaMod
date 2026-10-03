import { describe, expect, it } from "vitest";
import { analyzeProject } from "@fusamod/analysis";
import { RefIndex, RuleBasedProvider, applyOperations, tokenize, type Operation } from "../src/index.js";
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
