import { describe, expect, it } from "vitest";
import {
  formatDecomposedAsil,
  isValidDecomposition,
  validateDecompositions,
  validatePairing,
  type SafetyRequirement,
} from "../src/index.js";

describe("ASIL デコンポジション表", () => {
  it.each([
    ["D", "B", "B", true],
    ["D", "C", "A", true],
    ["D", "A", "C", true],
    ["D", "D", "QM", true],
    ["D", "B", "A", false],
    ["C", "B", "A", true],
    ["C", "C", "QM", true],
    ["C", "B", "B", false],
    ["B", "A", "A", true],
    ["A", "A", "QM", true],
    ["A", "A", "A", false],
    ["QM", "QM", "QM", false],
  ] as const)("%s → %s + %s = %s", (p, a, b, ok) => {
    expect(isValidDecomposition(p, a, b)).toBe(ok);
  });

  it("表記 B(D)", () => {
    expect(formatDecomposedAsil("B", "D")).toBe("B(D)");
    expect(formatDecomposedAsil("D", "D")).toBe("D");
  });
});

const req = (o: Partial<SafetyRequirement> & { id: string }): SafetyRequirement => ({
  text: "", level: "fsr", asil: "D", ...o,
});

describe("デコンポジション検証", () => {
  it("正しい分解 + 根拠ありで指摘なし", () => {
    const issues = validateDecompositions(
      [
        req({ id: "p" }),
        req({ id: "a", parentId: "p", asil: "B", originAsil: "D", allocatedTo: "e1" }),
        req({ id: "b", parentId: "p", asil: "B", originAsil: "D", allocatedTo: "e2" }),
      ],
      [{ id: "d", parentRequirementId: "p", childRequirementIds: ["a", "b"], independenceEvidence: "DFA-PT-001(独立電源)" }],
    );
    expect(issues).toEqual([]);
  });

  it("不正な組合せ・元ASIL不一致・同一要素割当・根拠なしを検出", () => {
    const issues = validateDecompositions(
      [
        req({ id: "p" }),
        req({ id: "a", parentId: "p", asil: "B", originAsil: "D", allocatedTo: "e1" }),
        req({ id: "b", parentId: "p", asil: "A", originAsil: "C", allocatedTo: "e1" }),
      ],
      [{ id: "d", parentRequirementId: "p", childRequirementIds: ["a", "b"] }],
    );
    expect(issues.map((i) => i.code).sort()).toEqual(
      ["DECOMP_INVALID", "DECOMP_NOT_INDEPENDENT", "DECOMP_NO_EVIDENCE", "DECOMP_ORIGIN"].sort(),
    );
    expect(issues.find((i) => i.code === "DECOMP_NO_EVIDENCE")?.severity).toBe("error");
  });

  it("再分解は専門家確認の警告", () => {
    const issues = validateDecompositions(
      [
        req({ id: "p", asil: "B", originAsil: "D" }),
        req({ id: "a", parentId: "p", asil: "A", originAsil: "D" }),
        req({ id: "b", parentId: "p", asil: "A", originAsil: "D" }),
      ],
      [{ id: "d", parentRequirementId: "p", childRequirementIds: ["a", "b"], independenceEvidence: "DFA-PT-001(独立電源)" }],
    );
    expect(issues.map((i) => i.code)).toEqual(["REDECOMPOSITION"]);
  });
});

describe("意図機能と安全機構のペア", () => {
  it("安全機構が無い ASIL 機能・FTTI 未設定・同一要素を警告", () => {
    const issues = validatePairing(
      [
        { id: "if1", name: "トルク制御", elementId: "inv", asil: "D" },
        { id: "if2", name: "ログ", elementId: "inv", asil: "QM" },
      ],
      [{ id: "sm1", name: "トルク監視", elementId: "inv" }],
      [{ id: "p1", intendedFunctionId: "if1", mechanismId: "sm1" }],
    );
    expect(issues.map((i) => i.code).sort()).toEqual(["MISSING_FTTI", "PAIR_SAME_ELEMENT"]);
    const none = validatePairing([{ id: "if1", name: "x", elementId: "e", asil: "B" }], [], []);
    expect(none.map((i) => i.code)).toEqual(["NO_SAFETY_MECHANISM"]);
  });
});
