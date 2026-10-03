import { describe, expect, it } from "vitest";
import { parseWeight, validateScdl, type ScdlModel } from "../src/index.js";
import { redundantArchitecture } from "./fixtures.js";

const codes = (m: ScdlModel) => validateScdl(m).map((i) => i.code).sort();
const mutate = (f: (m: ScdlModel) => void): ScdlModel => {
  const m = redundantArchitecture();
  f(m);
  return m;
};

describe("重み付けの表記", () => {
  it.each([
    ["B", { asil: "B" }],
    ["A(B)", { asil: "A", origin: "B" }],
    ["QM(D)", { asil: "QM", origin: "D" }],
  ])("%s を解釈する", (s, expected) => {
    expect(parseWeight(s)).toEqual(expected);
  });
  it.each(["", "E", "A(E)", "D(A)", "A (B)x"])("%s は不正", (s) => {
    expect(parseWeight(s)).toBeUndefined();
  });
});

describe("冗長設計の構造例", () => {
  it("指摘なしで検証を通る", () => {
    expect(validateScdl(redundantArchitecture())).toEqual([]);
  });
});

describe("メタモデルの制約", () => {
  it("1 つの要求から 2 つ以上の出力インタラクションは禁止", () => {
    const m = mutate((m) => m.interactions.push({ id: "I-x", source: "MFR-1", targets: ["SR-11"] }));
    expect(codes(m)).toContain("MULTIPLE_OUTGOING");
  });

  it("出力元と宛先が同じインタラクションは禁止", () => {
    const m = mutate((m) => (m.interactions[2]!.targets = ["MFR-1"]));
    expect(codes(m)).toContain("INTERACTION_SELF");
  });

  it("isAllocated と allocation の不一致", () => {
    const a = mutate((m) => (m.requirements[0]!.isAllocated = false));
    const b = mutate((m) => (m.requirements[10]!.allocation = "E-1"));
    expect(codes(a)).toContain("ALLOCATION_MISMATCH");
    expect(codes(b)).toContain("ALLOCATION_MISMATCH");
  });

  it("エレメントの入れ子の循環", () => {
    const m = mutate((m) => (m.elements[0]!.parent = "E-1-1"));
    expect(codes(m)).toContain("ELEMENT_CYCLE");
  });

  it("要求グループ: 空・重複メンバー", () => {
    const m = mutate((m) => {
      m.groups.push({ id: "G-empty", requirements: [] });
      m.groups.push({ id: "G-dup", requirements: ["MFR-1", "MFR-1"] });
    });
    expect(codes(m)).toEqual(expect.arrayContaining(["GROUP_EMPTY", "GROUP_DUP_MEMBER"]));
  });

  it("ペアリングは異なる 2 つ", () => {
    const m = mutate((m) => {
      m.groupPairings[0]!.set = ["RG-1", "RG-1"];
      m.requirementPairings.push({ id: "RP", set: ["MFR-1", "MFR-1"] });
    });
    expect(codes(m).filter((c) => c === "PAIRING_SAME")).toHaveLength(2);
  });

  it("制約条件はペアリング/無干渉に紐づく", () => {
    const m = mutate((m) => m.constraintPairings.shift());
    expect(codes(m)).toEqual(expect.arrayContaining(["CONSTRAINT_NO_PAIRING", "PAIRING_NO_CONSTRAINT"]));
  });

  it("未知の参照・不正な重み付け・重複 ID", () => {
    const m = mutate((m) => {
      m.groups[0]!.requirements = ["NOPE"];
      m.requirements[0]!.weight = "X";
      m.elements.push({ id: "E-1" });
    });
    expect(codes(m)).toEqual(expect.arrayContaining(["UNKNOWN_REF", "WEIGHT_FORMAT", "DUP_ID"]));
  });
});

describe("無干渉", () => {
  const withCoexistence = (m: ScdlModel) => {
    m.constraints.push({ id: "NFSR-9", isAllocated: true, allocation: "ITEM", weight: "B" });
    m.coexistences.push({ id: "CX-1", source: "E-1-2", target: { kind: "requirement", id: "MFR-1" } });
    m.constraintPairings.push({ id: "C-9", constraint: "NFSR-9", target: { kind: "coexistence", id: "CX-1" } });
  };
  it("エレメントから要求への無干渉は有効", () => {
    expect(validateScdl(mutate(withCoexistence))).toEqual([]);
  });
  it("自分自身への無干渉と未知の干渉先を検出", () => {
    const m = mutate((m) => {
      withCoexistence(m);
      m.coexistences.push({ id: "CX-2", source: "E-1", target: { kind: "element", id: "E-1" } });
      m.coexistences.push({ id: "CX-3", source: "E-1", target: { kind: "group", id: "NOPE" } });
    });
    expect(codes(m)).toEqual(expect.arrayContaining(["COEXISTENCE_SELF", "UNKNOWN_REF"]));
  });
});

describe("ASIL 分解との整合", () => {
  it("許可されない分解の組を検出(B → B + A)", () => {
    const m = mutate((m) => {
      m.requirements.find((r) => r.id === "MFR-3")!.weight = "B(B)";
    });
    expect(codes(m)).toContain("PAIR_DECOMP_INVALID");
  });

  it("ペアの元 ASIL の不一致を検出", () => {
    const m = mutate((m) => (m.requirements[0]!.weight = "A(C)"));
    expect(codes(m)).toContain("PAIR_ORIGIN_MISMATCH");
  });

  it("D → C + A は有効", () => {
    const m = mutate((m) => {
      for (const r of m.requirements) {
        if (r.id === "MFR-1") r.weight = "C(D)";
        if (r.id === "SR-11") r.weight = "A(D)";
      }
    });
    expect(codes(m).filter((c) => c.startsWith("PAIR_"))).toEqual([]);
  });

  it("エレメントの重み付けが配置された要求より低いと警告", () => {
    const m = mutate((m) => (m.elements.find((e) => e.id === "E-1-2")!.weight = "A"));
    expect(codes(m)).toContain("ELEMENT_WEIGHT_LOW");
  });

  it("グループ内で分解後 ASIL が混在すると警告", () => {
    const m = mutate((m) => (m.requirements.find((r) => r.id === "SR-32")!.weight = "B(B)"));
    expect(codes(m)).toContain("GROUP_MIXED_WEIGHT");
  });
});

describe("ID の種類をまたぐ重複", () => {
  it("要求と制約条件が同じ ID だと ID_COLLISION(配置先を取り違えないように)", () => {
    const m = mutate((m) => m.constraints.push({ id: "MFR-1", isAllocated: true, allocation: "E-1", weight: "B" }));
    expect(validateScdl(m).map((i) => i.code)).toContain("ID_COLLISION");
  });
});
