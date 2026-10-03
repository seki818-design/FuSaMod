import { describe, expect, it } from "vitest";
import { analyzeProject, parseSafetyData, recomputePuzzle } from "../src/index.js";
import { demoGraph, demoSafety, GD, INV, PT, SM, VCU, VEH } from "./helpers.js";

describe("デモプロジェクトの解析", () => {
  const a = analyzeProject(demoGraph(), demoSafety());

  it("エラーは無く、警告は未設定の AP 表と未着手の機能だけ", () => {
    expect(a.issues.filter((i) => i.severity === "error")).toEqual([]);
    const codes = a.issues.map((i) => i.code).sort();
    expect(codes).toEqual(["AP_TABLE_MISSING", "FUNCTION_WITHOUT_FAILURE"]);
    expect(a.issues.find((i) => i.code === "FUNCTION_WITHOUT_FAILURE")!.elementId).toBe(SM);
  });

  it("階層レベルは構造の入れ子の深さで決まる", () => {
    expect(a.levelOf).toMatchObject({ [VEH]: "system", [PT]: "subsystem", [VCU]: "component", [INV]: "component", [GD]: "detail" });
  });

  it("FMEA: 上位の故障モードが下位の故障影響として同じノードで繋がる", () => {
    const pt = a.fmea[PT]!.rows.find((r) => r.failureModeId === "FM-PT-1")!;
    expect(pt.effects.map((e) => e.failureId)).toEqual(["FE-1"]);
    expect(pt.causes.map((c) => c.failureId).sort()).toEqual(["FM-INV-1", "FM-VCU-1"]);
    expect(pt.severity).toBe(10); // 最上位の FE から継承
    const gd = a.fmea[GD]!.rows.find((r) => r.failureModeId === "FM-GD-1")!;
    expect(gd.effects.map((e) => e.failureId)).toEqual(["FM-INV-1"]);
    expect(gd.severity).toBe(10);
    expect(gd.causes.map((c) => c.failureId)).toEqual(["FC-GD-1"]);
    expect(a.summary.maxRpn).toBe(10 * 3 * 5); // FC-VCU-1: S10 × O3 × D5
  });

  it("パズルビュー: 4 階層 × 4 視点。エラーなし、安全分析の未着手が要確認になる", () => {
    const cells = a.puzzle.cells;
    for (const l of ["system", "subsystem", "component", "detail"] as const)
      for (const v of ["requirements", "structure", "behavior", "safety"] as const)
        expect(cells[l][v].status).not.toBe("inconsistent");
    expect(cells.component.behavior.status).toBe("review"); // 監視の機能に故障モードが未定義
    expect(cells.system.safety.status).toBe("review"); // AP 表未設定
    expect(cells.system.structure).toMatchObject({ status: "consistent", count: 1 });
    expect(cells.detail.structure.count).toBe(2);
  });

  it("SCDL: 階層番号(ITEM/E-1/E-1-1)で生成され、検証を通る(ペアの分解 D → B + B を含む)", () => {
    expect(a.scdlElementIds).toMatchObject({ [VEH]: "ITEM", [PT]: "E-1", [VCU]: "E-1-1", [INV]: "E-1-2", [GD]: "E-1-2-1", [SM]: "E-1-4" });
    expect(a.issues.filter((i) => i.source === "scdl")).toEqual([]);
    const pairing = a.scdl.groupPairings[0]!;
    expect(pairing.set).toEqual(["RG-IF-1", "SRG-SM-1"]);
    expect(a.scdl.constraints[0]).toMatchObject({ id: "NFSR-PAIR-1", allocation: "E-1", weight: "B(D)" });
    // 外部の信号源は境界の要求として生成される
    expect(a.scdl.requirements.filter((r) => r.isExternal).map((r) => r.id).sort()).toEqual(["EXT-accelerator", "EXT-inverter-gate"]);
    // エレメントの重み付け: VCU は B(D)、パワートレインは D(FSR-1)
    expect(a.scdl.elements.find((e) => e.id === "E-1-1")!.weight).toBe("B(D)");
    expect(a.scdl.elements.find((e) => e.id === "E-1")!.weight).toBe("D");
  });

  it("トレース: すべての要求が構造要素に紐づく。分解リンクを持つ", () => {
    expect(a.trace.uncovered).toEqual([]);
    expect(a.trace.rows).toHaveLength(4 + 4);
    expect(a.trace.links).toEqual(
      expect.arrayContaining([
        { from: "FSR-1", to: "FSR-1a", kind: "derives" },
        { from: "FSR-1", to: "FSR-1b", kind: "decomposes" },
        { from: "FSR-1b", to: "TSR-1b", kind: "derives" },
      ]),
    );
  });
});

describe("AP 表の扱い", () => {
  const uniform = (ap: "H" | "M" | "L") => [{ s: [1, 10] as [number, number], o: [1, 10] as [number, number], d: [1, 10] as [number, number], ap }];
  it("正当な AP 表があれば AP を算出し、未設定警告が消える", () => {
    const s = { ...demoSafety(), apTable: uniform("L") };
    const a = analyzeProject(demoGraph(), s);
    expect(a.apAvailable).toBe(true);
    expect(a.issues.map((i) => i.code)).not.toContain("AP_TABLE_MISSING");
    expect(a.fmea[PT]!.rows[0]!.causes.every((c) => c.ap === "L")).toBe(true);
  });
  it("不正な AP 表はエラー", () => {
    const s = { ...demoSafety(), apTable: [{ s: [1, 9] as [number, number], o: [1, 10] as [number, number], d: [1, 10] as [number, number], ap: "L" as const }] };
    const a = analyzeProject(demoGraph(), s);
    expect(a.issues.find((i) => i.code === "AP_TABLE_INVALID")?.severity).toBe("error");
    expect(a.apAvailable).toBe(false);
  });
});

describe("誤りの検出(視点と階層に正しく帰属する)", () => {
  const run = (f: (s: ReturnType<typeof demoSafety>) => void) => {
    const s = demoSafety();
    f(s);
    return analyzeProject(demoGraph(), s);
  };
  const errs = (a: ReturnType<typeof analyzeProject>) => a.issues.filter((i) => i.severity === "error");

  it("安全目標の ASIL が HARA と食い違うと、安全視点のシステム階層が不整合", () => {
    const a = run((s) => (s.hara.goals[0]!.asil = "C"));
    expect(errs(a).map((i) => i.code)).toContain("GOAL_ASIL_MISMATCH");
    expect(a.puzzle.cells.system.safety.status).toBe("inconsistent");
  });

  it("許されない ASIL 分解(D → B + A)", () => {
    const a = run((s) => (s.safetyRequirements.find((r) => r.id === "FSR-1b")!.asil = "A"));
    expect(errs(a).map((i) => i.code)).toContain("DECOMP_INVALID");
  });

  it("故障ノードが存在しない機能を指す(モデルを変更した場合)", () => {
    const a = run((s) => (s.failures.find((f) => f.id === "FM-GD-1")!.functionId = "EvPowertrainDemo::gone"));
    const e = errs(a).find((i) => i.code === "UNKNOWN_REF")!;
    expect(e.viewpoint).toBe("safety");
  });

  it("階層を飛び越えた故障リンク", () => {
    const a = run((s) => s.links.push({ id: "LX", causeId: "FC-GD-1", effectId: "FE-1", occurrence: 1, detection: 1 }));
    expect(errs(a).map((i) => i.code)).toContain("LINK_LEVEL");
  });

  it("安全機構の欠落・独立性の制約が無いペアを警告", () => {
    const a = run((s) => {
      s.pairs = [];
    });
    expect(a.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["NO_SAFETY_MECHANISM", "MECHANISM_UNPAIRED"]));
  });

  it("フォールトツリーが存在しない故障ノードを参照", () => {
    const a = run((s) => (s.faultTrees[0]!.nodes[3]!.failureId = "NOPE"));
    expect(errs(a).map((i) => i.code)).toContain("FT_UNKNOWN_FAILURE");
  });

  it("要求が満たされていない・存在しない構造要素へ配置", () => {
    const a = run((s) => (s.safetyRequirements[1]!.allocatedTo = "EvPowertrainDemo::gone"));
    expect(a.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["UNKNOWN_ELEMENT"]));
  });

  it("信号フローの端が未知", () => {
    const a = run((s) => s.signalFlows.push({ id: "SF-X", from: "NOPE", to: ["IF-1"] }));
    expect(errs(a).map((i) => i.code)).toContain("SIGNALFLOW_UNKNOWN");
  });
});

describe("入力の検証(parseSafetyData)", () => {
  it("未知のキー・範囲外・型の誤りを拒否してパスを示す", () => {
    const base = JSON.parse(JSON.stringify(demoSafety()));
    const bad1 = { ...base, extra: 1 };
    const bad2 = JSON.parse(JSON.stringify(base));
    bad2.hara.events[0].severity = 4;
    const bad3 = JSON.parse(JSON.stringify(base));
    bad3.failures[0].id = 5;
    for (const bad of [bad1, bad2, bad3]) {
      const r = parseSafetyData(bad);
      expect(r.ok).toBe(false);
    }
    const r = parseSafetyData(bad2);
    expect(!r.ok && r.errors.join()).toContain("hara.events.0.severity");
    expect(parseSafetyData(null).ok).toBe(false);
    expect(parseSafetyData({ version: 2 }).ok).toBe(false);
  });
  it("巨大な文字列を拒否する", () => {
    const s = JSON.parse(JSON.stringify(demoSafety()));
    s.failures[0].description = "x".repeat(6000);
    expect(parseSafetyData(s).ok).toBe(false);
  });
});

describe("パズルビューの再計算(レイヤー整合性のオン/オフ)", () => {
  it("階層をまたいだ整合性チェックを除くと、その警告だけが消える", () => {
    // 機能を持たない構造要素を足す → consistency の警告(ELEMENT_NO_FUNCTION)が出る
    const g = demoGraph();
    g.elements.push({ kind: "PartUsage", qualifiedName: `${PT}::spare`, name: "spare", owner: PT });
    const a = analyzeProject(g, demoSafety());
    expect(a.issues.some((i) => i.source === "consistency" && i.code === "ELEMENT_NO_FUNCTION")).toBe(true);
    expect(recomputePuzzle(a).cells).toEqual(a.puzzle.cells); // 除外なしなら元と同じ
    const without = recomputePuzzle(a, { excludeSources: ["consistency"] });
    const total = (p: typeof without) => Object.values(p.cells).flatMap((r) => Object.values(r)).reduce((n, c) => n + c.warnings, 0);
    expect(total(without)).toBe(total(a.puzzle) - 1);
    expect(without.cells.component.behavior.count).toBe(a.puzzle.cells.component.behavior.count); // 件数は変わらない
  });
  it("エラーのある階層は、除外しない限り不整合のまま", () => {
    const s = demoSafety();
    s.hara.goals[0]!.asil = "C";
    const a = analyzeProject(demoGraph(), s);
    expect(recomputePuzzle(a, { excludeSources: ["consistency"] }).cells.system.safety.status).toBe("inconsistent");
    expect(recomputePuzzle(a, { excludeSources: ["hara"] }).cells.system.safety.status).not.toBe("inconsistent");
  });
});
