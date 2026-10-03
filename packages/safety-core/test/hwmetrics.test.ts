import { describe, expect, it } from "vitest";
import { computeHwMetrics, validateHwModes, type HardwareFailureMode } from "../src/index.js";

const m = (o: Partial<HardwareFailureMode> & { id: string }): HardwareFailureMode => ({ name: o.id, fit: 100, type: "single", ...o });

describe("SPFM / LFM(ISO 26262-5 の定義に従う算出。手計算と一致)", () => {
  // A: single 100 FIT, DC 0.99 → 残存 1 / B: single 50 FIT, DC なし → 50 / C: multiple 200 FIT, 潜在 DC 0.9 → 20
  const modes = [m({ id: "A", fit: 100, dcSpfRf: 0.99 }), m({ id: "B", fit: 50 }), m({ id: "C", fit: 200, type: "multiple", dcLatent: 0.9 })];
  it("合計 350 FIT、単一点+残存 51、潜在 20 → SPFM = 1 − 51/350、LFM = 1 − 20/(350 − 51)", () => {
    const r = computeHwMetrics(modes);
    expect(r.totalFit).toBe(350);
    expect(r.singleResidualFit).toBeCloseTo(51, 9);
    expect(r.latentFit).toBeCloseTo(20, 9);
    expect(r.spfm).toBeCloseTo(1 - 51 / 350, 9);
    expect(r.lfm).toBeCloseTo(1 - 20 / 299, 9);
  });
  it("安全な故障の割合は、分母にも分子にも入れない", () => {
    const r = computeHwMetrics([m({ id: "A", fit: 100, safeFraction: 0.5 })]);
    expect(r.totalFit).toBe(50);
    expect(r.singleResidualFit).toBe(50);
    expect(r.spfm).toBe(0);
  });
  it("安全機構が完全(DC=1)なら SPFM=1。故障率 0 なら undefined", () => {
    expect(computeHwMetrics([m({ id: "A", dcSpfRf: 1 })]).spfm).toBe(1);
    expect(computeHwMetrics([]).spfm).toBeUndefined();
    expect(computeHwMetrics([m({ id: "A", fit: 0 })]).spfm).toBeUndefined();
  });
  it("目標値: ASIL B 90/60、C 97/80、D 99/90 に対して判定する(最大の ASIL)", () => {
    const codes = (asils: ("A" | "B" | "C" | "D" | "QM")[]) => validateHwModes(modes, asils).filter((i) => i.severity === "error").map((i) => i.code);
    expect(codes(["QM", "A"])).toEqual([]); // 目標値なし
    expect(codes(["B"])).toEqual(["HW_SPFM_BELOW_TARGET"]); // SPFM 85.4% < 90%、LFM 93.3% ≥ 60%
    expect(codes(["B", "D"])).toEqual(["HW_SPFM_BELOW_TARGET"]); // D: LFM 93.3% ≥ 90%
    const ok = [m({ id: "A", dcSpfRf: 0.995 }), m({ id: "C", type: "multiple", dcLatent: 0.95 })];
    expect(validateHwModes(ok, ["D"]).filter((i) => i.severity === "error")).toEqual([]);
  });
  it("DC を主張するのに機構・根拠が無ければ警告。機構の区分の上限を超えるとエラー", () => {
    const mech = [{ id: "SM", diagnosticCoverage: "medium" as const, asil: "B" as const, paired: true }];
    const w = validateHwModes([m({ id: "A", dcSpfRf: 0.9 })], ["QM"], {}).map((i) => i.code);
    expect(w).toEqual(["HW_DC_NO_MECHANISM", "HW_NO_RATIONALE"]);
    const over = validateHwModes([m({ id: "A", dcSpfRf: 0.95, mechanismId: "SM", rationale: "FMEDA 2024-05 表 3" })], ["QM"], { mechanisms: mech });
    expect(over.map((i) => `${i.severity}:${i.code}`)).toEqual(["error:HW_DC_EXCEEDS_MECHANISM"]);
    const ok = validateHwModes([m({ id: "A", dcSpfRf: 0.9, mechanismId: "SM", rationale: "FMEDA 2024-05 表 3" })], ["QM"], { mechanisms: mech });
    expect(ok).toEqual([]);
  });
  it("安全目標ごとに評価する: goalIds で、その目標に関係する故障モードだけを使う", () => {
    const goals = [{ id: "SG-1", asil: "D" as const }, { id: "SG-2", asil: "B" as const }];
    const modes2 = [m({ id: "A", fit: 100, goalIds: ["SG-1"] }), m({ id: "B", fit: 100, dcSpfRf: 0.99, mechanismId: "SM", rationale: "FMEDA 2024-05 表 3", goalIds: ["SG-2"] })];
    const r = validateHwModes(modes2, ["D", "B"], { goals, mechanisms: [{ id: "SM", diagnosticCoverage: "high", asil: "D", paired: true }] });
    expect(r.filter((i) => i.severity === "error").map((i) => `${i.code}@${i.ref}`)).toEqual(["HW_SPFM_BELOW_TARGET@SG-1"]); // SG-2 は B の 90% を満たす
  });
  it("入力の検証: 範囲外・重複・存在しない要素", () => {
    const bad = [m({ id: "A", fit: -1 }), m({ id: "A", dcSpfRf: 1.5 }), m({ id: "B", elementId: "nope" })];
    const codes = validateHwModes(bad, ["D"], new Set(["ok"])).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["HW_RANGE", "DUP_ID", "UNKNOWN_ELEMENT"]));
  });
});

describe("HW メトリクスの欠落と DC の貸し出し元(ラウンド 8)", () => {
  const ev = "FMEDA 2024-05 表 3";
  it("ASIL B 以上の目標に関係する故障モードが無い(または故障率 0)と、その目標が評価できていない旨の警告", () => {
    const goals = [{ id: "SG-1", asil: "D" as const }, { id: "SG-3", asil: "C" as const }];
    const r = validateHwModes([m({ id: "A", dcSpfRf: 0.99, goalIds: ["SG-1"], mechanismId: "SM", rationale: ev })], ["D", "C"], { goals, mechanisms: [{ id: "SM", diagnosticCoverage: "high", asil: "D", paired: true }] });
    expect(r.map((i) => `${i.code}@${i.ref}`)).toContain("HW_METRICS_MISSING@SG-3");
    const zero = validateHwModes([m({ id: "A", fit: 0 })], ["D"], { goals: [{ id: "SG-1", asil: "D" }] });
    expect(zero.map((i) => i.code)).toContain("HW_METRICS_MISSING");
  });
  it("DC を担う機構が QM ならエラー、ペアになっていなければ警告", () => {
    const mode = m({ id: "A", dcSpfRf: 0.5, mechanismId: "SM", rationale: ev });
    const qm = validateHwModes([mode], ["QM"], { mechanisms: [{ id: "SM", diagnosticCoverage: "high", asil: "QM", paired: true }] });
    expect(qm.map((i) => `${i.severity}:${i.code}`)).toEqual(["error:HW_DC_MECHANISM_QM"]);
    const unpaired = validateHwModes([mode], ["QM"], { mechanisms: [{ id: "SM", diagnosticCoverage: "high", asil: "B", paired: false }] });
    expect(unpaired.map((i) => `${i.severity}:${i.code}`)).toEqual(["warning:HW_DC_MECHANISM_UNPAIRED"]);
  });
});

describe("根拠の形式検査と DC を貸す機構の ASIL(ラウンド 9)", () => {
  const mech = [{ id: "SM", diagnosticCoverage: "high" as const, asil: "A" as const, paired: true }];
  it("HW の根拠も、形だけの文字列（xxxxxxxx・TODO TODO・12345678）は不十分", () => {
    for (const t of ["xxxxxxxx", "TODO TODO", "12345678", "in-progress 2024-01", "to be defined 001"]) {
      const r = validateHwModes([m({ id: "A", dcSpfRf: 0.5, mechanismId: "SM", rationale: t })], ["QM"], { mechanisms: [{ ...mech[0]!, asil: "B" }] });
      expect(r.map((i) => i.code), t).toContain("HW_NO_RATIONALE");
    }
  });
  it("語の一部（depending・sampled・仮想化）は弾かない", () => {
    for (const t of ["depending on DFA-12 report", "sampled FMEDA-2024 sheet 3", "仮想化分離 DFA-12 §3"])
      expect(validateHwModes([m({ id: "A", dcSpfRf: 0.5, mechanismId: "SM", rationale: t })], ["QM"], { mechanisms: [{ ...mech[0]!, asil: "B" }] }).map((i) => i.code), t).not.toContain("HW_NO_RATIONALE");
  });
  it("DC を貸す機構の ASIL（分解の元 ASIL を含む）が目標より低ければエラー", () => {
    const goals = [{ id: "SG-1", asil: "D" as const }];
    const mode = m({ id: "A", dcSpfRf: 0.5, mechanismId: "SM", goalIds: ["SG-1"], rationale: "FMEDA 2024-05 表 3" });
    expect(validateHwModes([mode], ["D"], { goals, mechanisms: mech }).map((i) => i.code)).toContain("HW_DC_MECHANISM_BELOW_GOAL");
    expect(validateHwModes([mode], ["D"], { goals, mechanisms: [{ ...mech[0]!, asil: "B", originAsil: "D" }] }).map((i) => i.code)).not.toContain("HW_DC_MECHANISM_BELOW_GOAL");
  });
});
