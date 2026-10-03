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
    const codes = (asils: ("A" | "B" | "C" | "D" | "QM")[]) => validateHwModes(modes, asils).map((i) => i.code);
    expect(codes(["QM", "A"])).toEqual([]); // 目標値なし
    expect(codes(["B"])).toEqual(["HW_SPFM_BELOW_TARGET"]); // SPFM 85.4% < 90%、LFM 93.3% ≥ 60%
    expect(codes(["B", "D"])).toEqual(["HW_SPFM_BELOW_TARGET"]); // D: LFM 93.3% ≥ 90%
    const ok = [m({ id: "A", dcSpfRf: 0.995 }), m({ id: "C", type: "multiple", dcLatent: 0.95 })];
    expect(validateHwModes(ok, ["D"])).toEqual([]);
  });
  it("入力の検証: 範囲外・重複・存在しない要素", () => {
    const bad = [m({ id: "A", fit: -1 }), m({ id: "A", dcSpfRf: 1.5 }), m({ id: "B", elementId: "nope" })];
    const codes = validateHwModes(bad, ["D"], new Set(["ok"])).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["HW_RANGE", "DUP_ID", "UNKNOWN_ELEMENT"]));
  });
});
