import type { ScdlModel } from "../src/index.js";

const req = (id: string, allocation: string | undefined, weight?: string, extra: object = {}) => ({
  id,
  isAllocated: allocation !== undefined,
  ...(allocation !== undefined ? { allocation } : {}),
  ...(weight ? { weight } : {}),
  ...extra,
});

/**
 * ASAM SCDL 事例集の「冗長設計」の構造を模した例(入力 → 制御量演算 → 出力の 3 エレメントで、
 * 各段に 意図機能 / 安全機構 の要求グループペアと独立性の制約条件)。
 * 名称・重み付けは本リポジトリ用に付け直したもの。
 */
export function redundantArchitecture(): ScdlModel {
  return {
    elements: [
      { id: "ITEM", weight: "B" },
      { id: "E-1", parent: "ITEM", weight: "B" },
      { id: "E-1-1", parent: "E-1", weight: "A(B)" },
      { id: "E-1-2", parent: "E-1", weight: "B" },
      { id: "E-2", parent: "ITEM", weight: "B" },
      { id: "E-2-1", parent: "E-2", weight: "A(B)" },
      { id: "E-2-2", parent: "E-2", weight: "B" },
      { id: "E-3", parent: "ITEM", weight: "B" },
      { id: "E-3-1", parent: "E-3", weight: "A(B)" },
      { id: "E-3-2", parent: "E-3", weight: "A(B)" },
    ],
    requirements: [
      req("MFR-1", "E-1-1", "A(B)"),
      req("SR-11", "E-1-2", "A(B)"),
      req("SR-12", "E-1-2", "B"),
      req("MFR-2", "E-2-1", "A(B)"),
      req("SR-21", "E-2-2", "A(B)"),
      req("SR-22", "E-2-2", "B"),
      req("MFR-3", "E-3-2", "A(B)"),
      req("SR-31", "E-3-1", "A(B)"),
      req("SR-32", "E-3-1", "A(B)"),
      req("SR-33", "E-3-1", "A(B)"),
      req("X-DRV1", undefined, undefined, { isExternal: true }),
      req("X-DRV2", undefined, undefined, { isExternal: true }),
      req("X-ANGLE", undefined, undefined, { isExternal: true }),
      req("X-ACT", undefined, undefined, { isExternal: true }),
    ],
    constraints: [
      req("NFSR-1", "E-1", "B"),
      req("NFSR-2", "E-2", "B"),
      req("NFSR-3", "E-3", "B"),
    ],
    interactions: [
      { id: "I-1", source: "X-DRV1", targets: ["MFR-1"] },
      { id: "I-2", source: "X-DRV2", targets: ["SR-11"] },
      { id: "I-3", source: "MFR-1", targets: ["SR-12"] },
      { id: "I-4", source: "SR-11", targets: ["SR-12"] },
      { id: "I-5", source: "SR-12", targets: ["MFR-2", "SR-21"] },
      { id: "I-6", source: "MFR-2", targets: ["SR-22"] },
      { id: "I-7", source: "SR-21", targets: ["SR-22"] },
      { id: "I-8", source: "SR-22", targets: ["MFR-3", "SR-31"] },
      { id: "I-9", source: "MFR-3", targets: ["SR-33"] },
      { id: "I-10", source: "SR-32", targets: ["SR-31"] },
      { id: "I-11", source: "SR-31", targets: ["SR-33"] },
      { id: "I-12", source: "X-ANGLE", targets: ["SR-32"] },
      { id: "I-13", source: "SR-33", targets: ["X-ACT"] },
    ],
    groups: [
      { id: "RG-1", name: "Main Function", role: "intendedFunction", requirements: ["MFR-1"] },
      { id: "SRG-1", name: "Safety Mechanism", role: "safetyMechanism", requirements: ["SR-11", "SR-12"] },
      { id: "RG-2", name: "Main Function", role: "intendedFunction", requirements: ["MFR-2"] },
      { id: "SRG-2", name: "Safety Mechanism", role: "safetyMechanism", requirements: ["SR-21", "SR-22"] },
      { id: "RG-3", name: "Main Function", role: "intendedFunction", requirements: ["MFR-3"] },
      { id: "SRG-3", name: "Safety Mechanism", role: "safetyMechanism", requirements: ["SR-31", "SR-32", "SR-33"] },
    ],
    groupPairings: [
      { id: "P-1", set: ["RG-1", "SRG-1"] },
      { id: "P-2", set: ["RG-2", "SRG-2"] },
      { id: "P-3", set: ["RG-3", "SRG-3"] },
    ],
    requirementPairings: [],
    coexistences: [],
    constraintPairings: [
      { id: "C-1", constraint: "NFSR-1", target: { kind: "group-pairing", id: "P-1" } },
      { id: "C-2", constraint: "NFSR-2", target: { kind: "group-pairing", id: "P-2" } },
      { id: "C-3", constraint: "NFSR-3", target: { kind: "group-pairing", id: "P-3" } },
    ],
  };
}
