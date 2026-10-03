import { describe, expect, it } from "vitest";
import { analyzeProject, impactOfRequirementChange, parseSafetyData, recomputePuzzle } from "../src/index.js";
import { demoGraph, demoSafety, GD, INV, PT, SM, VCU, VEH } from "./helpers.js";

describe("デモプロジェクトの解析", () => {
  const a = analyzeProject(demoGraph(), demoSafety());

  it("エラーは無く、警告は未設定の AP 表と未着手の機能だけ", () => {
    expect(a.issues.filter((i) => i.severity === "error")).toEqual([]);
    const codes = a.issues.map((i) => i.code).sort();
    expect(codes).toEqual(["AP_TABLE_NOT_OFFICIAL", "FUNCTION_WITHOUT_FAILURE"]);
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

  it("SCDL: 名前に基づく安定した ID(vehicle/powertrain/vcu)で生成され、検証を通る(ペアの分解 D → B + B を含む)", () => {
    expect(a.scdlElementIds).toMatchObject({ [VEH]: "vehicle", [PT]: "vehicle/powertrain", [VCU]: "vehicle/powertrain/vcu", [INV]: "vehicle/powertrain/inverter", [GD]: "vehicle/powertrain/inverter/gateDriver", [SM]: "vehicle/powertrain/safetyMonitor" });
    expect(a.issues.filter((i) => i.source === "scdl")).toEqual([]);
    const pairing = a.scdl.groupPairings[0]!;
    expect(pairing.set).toEqual(["RG-IF-1", "SRG-SM-1"]);
    expect(a.scdl.constraints[0]).toMatchObject({ id: "NFSR-PAIR-1", allocation: "vehicle/powertrain", weight: "B(D)" });
    // 外部の信号源は境界の要求として生成される
    expect(a.scdl.requirements.filter((r) => r.isExternal).map((r) => r.id).sort()).toEqual(["EXT-accelerator", "EXT-inverter-gate"]);
    // エレメントの重み付け: VCU は B(D)、パワートレインは D(FSR-1)
    expect(a.scdl.elements.find((e) => e.id === "vehicle/powertrain/vcu")!.weight).toBe("B(D)");
    expect(a.scdl.elements.find((e) => e.id === "vehicle/powertrain")!.weight).toBe("D");
  });

  it("トレース: すべての要求が構造要素に紐づく。分解リンクを持つ", () => {
    expect(a.trace.uncovered).toEqual([]);
    expect(a.trace.rows).toHaveLength(4 + 5);
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
    const s = { ...demoSafety(), apTable: uniform("L"), apTableSource: "テスト用の正式表(想定)" };
    const a = analyzeProject(demoGraph(), s);
    expect(a.apAvailable).toBe(true);
    expect(a.issues.map((i) => i.code)).not.toContain("AP_TABLE_NOT_OFFICIAL");
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

describe("安全分析の整合性(専門家レビュー指摘の回帰)", () => {
  const run = (mutate: (s: ReturnType<typeof demoSafety>) => void) => {
    const s = structuredClone(demoSafety());
    mutate(s);
    return analyzeProject(demoGraph(), s).issues;
  };
  it("デモはエラー 0(継承・分解・独立性の検査を通る)", () => {
    expect(run(() => {}).filter((i) => i.severity === "error")).toEqual([]);
  });
  it("FSR-1 を D から A に下げると検出される", () => {
    expect(run((s) => { s.safetyRequirements[0]!.asil = "A"; }).map((i) => i.code)).toContain("REQ_BELOW_GOAL_ASIL");
  });
  it("ASIL D の安全目標から要求を全て消すと検出される", () => {
    expect(run((s) => { s.safetyRequirements = []; s.decompositions = []; }).map((i) => i.code)).toContain("GOAL_NO_FSR");
  });
  it("分解先を祖先・子孫の要素に配置すると独立性エラー", () => {
    expect(run((s) => { s.safetyRequirements.find((r) => r.id === "FSR-1a")!.allocatedTo = PT; s.safetyRequirements.find((r) => r.id === "FSR-1b")!.allocatedTo = VCU; }).map((i) => i.code)).toContain("DECOMP_NOT_INDEPENDENT");
  });
  it("分解先の配置先が無いとエラー", () => {
    expect(run((s) => { delete s.safetyRequirements.find((r) => r.id === "FSR-1a")!.allocatedTo; }).map((i) => i.code)).toContain("DECOMP_NOT_ALLOCATED");
  });
  it("存在しない故障ノードを安全機構が対象にするとエラー", () => {
    expect(run((s) => { s.mechanisms[0]!.coversFailureIds = ["FM-NOPE"]; }).map((i) => i.code)).toContain("UNKNOWN_REF");
  });
  it("ASIL の事象に目標が無いのはエラー", () => {
    expect(run((s) => { delete s.hara.events[0]!.safetyGoalId; }).find((i) => i.code === "EVENT_NO_GOAL")?.severity).toBe("error");
  });
  it("AP 表が非公式サンプルなら警告し、出典が無くても警告する", () => {
    expect(run(() => {}).map((i) => i.code)).toContain("AP_TABLE_NOT_OFFICIAL");
    expect(run((s) => { delete s.apTableSource; }).map((i) => i.code)).toContain("AP_TABLE_SOURCE_UNKNOWN");
  });
});

describe("SCDL の ID は安定で、元のモデルへ追跡できる", () => {
  it("兄弟の並び順を入れ替えても、エレメントの ID は変わらない", () => {
    const g = demoGraph();
    const parts = g.elements.filter((e) => e.kind === "PartUsage" && e.owner === PT);
    const swapped = { ...g, elements: [...g.elements.filter((e) => !parts.includes(e)), ...[...parts].reverse()] };
    const a1 = analyzeProject(g, demoSafety());
    const a2 = analyzeProject(swapped, demoSafety());
    expect(a2.scdlElementIds).toEqual(a1.scdlElementIds);
  });
  it("エレメントの modelRef に、元の構造要素(完全修飾名)が入る", () => {
    const a = analyzeProject(demoGraph(), demoSafety());
    expect(a.scdl.elements.find((e) => e.id === "vehicle/powertrain/vcu")!.modelRef).toBe(VCU);
  });
  it("要求の名前は切り詰めない", () => {
    const a = analyzeProject(demoGraph(), demoSafety());
    expect(a.scdl.requirements.find((r) => r.id === "FSR-1")!.name).toBe("過大トルクを FTTI 内に検出し、安全状態(トルク 0)へ遷移する");
  });
});

describe("要求変更の影響分析とトレース", () => {
  const a = analyzeProject(demoGraph(), demoSafety());
  const s = demoSafety();
  it("SysML 要求 → 詳細化した安全要求 → 分解先 → 配置先の要素 → 機能 → FMEA まで波及する", () => {
    const r = impactOfRequirementChange(a, s, "EvPowertrainDemo::'REQ-001'")!;
    expect(r.requirements).toEqual(expect.arrayContaining(["FSR-1", "FSR-1a", "FSR-1b", "TSR-1b"]));
    expect(r.elements).toEqual(expect.arrayContaining([VEH, VCU, SM]));
    expect(r.fmeaElements).toEqual(expect.arrayContaining([VCU, PT]));
    expect(r.intendedFunctions).toContain("IF-1");
    expect(r.mechanisms).toContain("SM-1");
    expect(r.decompositions).toContain("DEC-1");
    expect(r.reasons.join("\n")).toContain("satisfy");
  });
  it("葉の要求を変えても、全体には波及しない(上位は確認のみ。下位と配置先の要素だけが範囲)", () => {
    const r = impactOfRequirementChange(a, s, "TSR-1b")!;
    expect(r.upstream).toEqual(expect.arrayContaining(["FSR-1b", "FSR-1"]));
    expect(r.upstream.some((x) => x.endsWith("'REQ-001'"))).toBe(true);
    expect(r.requirements).toEqual(["FSR-1b"]); // 同じ要素(safetyMonitor)に配置された要求
    expect(r.elements).toEqual([SM]);
    expect(r.elements).not.toContain(VEH);
    expect(r.fmeaElements.length).toBeLessThan(Object.keys(a.fmea).length);
  });
  it("分解先を変えると、分解の相手が『確認』の対象になる", () => {
    const r = impactOfRequirementChange(a, s, "FSR-1a")!;
    expect(r.partners).toEqual(["FSR-1b"]);
    expect(r.elements).not.toContain(SM);
  });
  it("存在しない要求は undefined", () => {
    expect(impactOfRequirementChange(a, s, "NOPE")).toBeUndefined();
  });
  it("トレースに SysML 要求 → 安全要求の『詳細化』リンクが出る", () => {
    expect(a.trace.links).toEqual(expect.arrayContaining([{ from: "EvPowertrainDemo::'REQ-001'", to: "FSR-1", kind: "refines" }]));
  });
  it("詳細化元が存在しない SysML 要求ならエラー", () => {
    const x = structuredClone(demoSafety());
    x.safetyRequirements[0]!.refines = "NOPE";
    expect(analyzeProject(demoGraph(), x).issues.find((i) => i.code === "UNKNOWN_REF" && i.message.includes("SysML 要求"))?.severity).toBe("error");
  });
});

describe("ラウンド 2 の指摘への回帰", () => {
  const run = (mutate: (s: ReturnType<typeof demoSafety>) => void) => {
    const s = structuredClone(demoSafety());
    mutate(s);
    return analyzeProject(demoGraph(), s);
  };
  it("同じ ID の重複(要求・分解・安全機構など)をエラーにする", () => {
    const a = run((s) => { s.safetyRequirements.push({ ...s.safetyRequirements[0]! }); s.mechanisms.push({ ...s.mechanisms[0]! }); s.decompositions.push({ ...s.decompositions[0]! }); });
    expect(a.issues.filter((i) => i.code === "DUP_ID" && i.severity === "error").length).toBeGreaterThanOrEqual(3);
  });
  it("AP 表の状態を持つ(サンプルは非公式)", () => {
    expect(run(() => {}).apStatus).toBe("unofficial");
    expect(run((s) => { s.apTableSource = "AIAG-VDA FMEA ハンドブック 第 1 版"; }).apStatus).toBe("declared");
    expect(run((s) => { delete s.apTableSource; }).apStatus).toBe("unknown");
    expect(run((s) => { delete s.apTable; delete s.apTableSource; }).apStatus).toBe("none");
  });
  it("非公式の AP 表は、CSV の見出しとレポートに明記される", async () => {
    const { fmeaCsv, reportMarkdown } = await import("../src/index.js");
    const a = run(() => {});
    expect(fmeaCsv(a)).toContain("AP(非公式のサンプル表)");
    expect(reportMarkdown(a, "x")).toContain("非公式のサンプル表");
  });
  it("AI の来歴(aiChanges)を持つデータを読み込める", () => {
    const s = structuredClone(demoSafety());
    s.aiChanges = [{ proposalId: "P-1", title: "t", provider: "rule-based", requestedBy: "alice", approvedBy: "bob", at: "2026-01-01T00:00:00Z", operations: 2 }];
    expect(parseSafetyData(JSON.parse(JSON.stringify(s))).ok).toBe(true);
  });
});

describe("SCDL の ID は、根の追加でも変わらない", () => {
  it("最上位の part がもう 1 つ増えても、既存のエレメントの ID は同じ", () => {
    const g = demoGraph();
    const extra = { kind: "PartUsage", qualifiedName: `${VEH.split("::")[0]}::spare`, name: "spare", owner: VEH.split("::")[0]! };
    const a1 = analyzeProject(g, demoSafety());
    const a2 = analyzeProject({ ...g, elements: [...g.elements, extra] }, demoSafety());
    for (const [k, v] of Object.entries(a1.scdlElementIds)) expect(a2.scdlElementIds[k]).toBe(v);
  });
});

describe("診断カバレッジと検出度の整合(FMEA-MSR の一部)", () => {
  it("DC が high の安全機構の対象故障に、悪い検出度(D=8)があると警告", () => {
    const s = structuredClone(demoSafety());
    const fid = s.mechanisms[0]!.coversFailureIds![0]!;
    const l = s.links.find((x) => x.causeId === fid);
    if (l) { l.detection = 8; l.occurrence = l.occurrence ?? 3; }
    const a = analyzeProject(demoGraph(), s);
    expect(l ? a.issues.some((i) => i.code === "MECH_DC_D_MISMATCH") : true).toBe(true);
  });
});
