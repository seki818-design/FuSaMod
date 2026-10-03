import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportSysml, importSysml, quoteName, ScdlSysmlError, validateScdl, type ScdlModel } from "../src/index.js";
import { redundantArchitecture } from "./fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const exampleFile = resolve(here, "../../../examples/sysml/redundant-architecture.sysml");

const exported = () => exportSysml(redundantArchitecture(), { packageName: "RedundantArchitecture" });

describe("SysML v2 書き出し", () => {
  it("ステレオタイプを使った宣言になる", () => {
    const t = exported();
    expect(t).toContain("private import SCDL::*;");
    expect(t).toContain("@ScdlElement { weight = Asil::A; decomposedFrom = Asil::B; }");
    expect(t).toContain("@ScdlRequirement { isExternal = true; }");
    expect(t).toContain("dependency 'I-5' from RedundantArchitecture::Requirements::'SR-12' to");
    expect(t).toContain("'MFR-2', RedundantArchitecture::Requirements::'SR-21'");
    expect(t).toContain("metadata 'RG-1' : ScdlRequirementGroup about RedundantArchitecture::Requirements::'MFR-1'");
    expect(t).toContain("role = ScdlGroupRole::intendedFunction;");
    expect(t).toContain(
      "satisfy RedundantArchitecture::Requirements::'MFR-1' by RedundantArchitecture::Architecture::'ITEM'::'E-1'::'E-1-1';",
    );
  });

  it("コミット済みのサンプルと一致する(UPDATE_EXAMPLES=1 で再生成)", () => {
    if (process.env["UPDATE_EXAMPLES"]) {
      mkdirSync(dirname(exampleFile), { recursive: true });
      writeFileSync(exampleFile, exported());
    }
    expect(existsSync(exampleFile)).toBe(true);
    expect(readFileSync(exampleFile, "utf8")).toBe(exported());
  });

  it("参照切れ・空グループ・不正な重み付けは書き出さない", () => {
    const bad = (f: (m: ScdlModel) => void) => {
      const m = redundantArchitecture();
      f(m);
      return () => exportSysml(m, { packageName: "X" });
    };
    expect(bad((m) => (m.interactions[0]!.targets = ["NOPE"]))).toThrow(ScdlSysmlError);
    expect(bad((m) => m.groups.push({ id: "G", requirements: [] }))).toThrow(/空/);
    expect(bad((m) => (m.requirements[0]!.weight = "Z"))).toThrow(/重み付け/);
    expect(() => exportSysml(redundantArchitecture(), { packageName: "bad name" })).toThrow(/パッケージ名/);
  });

  it("引用符を含む ID をエスケープする", () => {
    expect(quoteName("a'b\\c")).toBe("'a\\'b\\\\c'");
  });
});

describe("書き出し → 読み込みの往復", () => {
  it("元のモデルに戻る", () => {
    const { model, issues } = importSysml(exported());
    expect(issues).toEqual([]);
    expect(model).toEqual(redundantArchitecture());
  });

  it("読み戻したモデルも検証を通る", () => {
    expect(validateScdl(importSysml(exported()).model)).toEqual([]);
  });

  it("無干渉・部分ペアリング・名称/備考・引用符つき ID も往復できる", () => {
    const m = redundantArchitecture();
    m.requirements[0]!.name = "ドライバ操作検知 \"A\"\n2行目";
    m.requirements[0]!.text = "備考";
    m.requirementPairings.push({ id: "RP-1", set: ["MFR-1", "SR-11"] });
    m.constraints.push({ id: "NF'9", isAllocated: true, allocation: "ITEM", weight: "B" });
    m.coexistences.push({ id: "CX-1", source: "E-1-2", target: { kind: "requirement", id: "MFR-1" } });
    m.coexistences.push({ id: "CX-2", source: "E-1-2", target: { kind: "group", id: "RG-1" } });
    m.coexistences.push({ id: "CX-3", source: "E-2", target: { kind: "element", id: "E-1" } });
    m.constraintPairings.push({ id: "C-9", constraint: "NF'9", target: { kind: "coexistence", id: "CX-1" } });
    m.constraintPairings.push({ id: "C-10", constraint: "NF'9", target: { kind: "requirement-pairing", id: "RP-1" } });
    const { model } = importSysml(exportSysml(m, { packageName: "X" }));
    expect(model).toEqual(m);
  });

  it("ID が要素の種類をまたいで重複しても、種類ごとのパッケージで区別できる", () => {
    const m = redundantArchitecture();
    m.requirements.push({ id: "E-1", isAllocated: false });
    m.coexistences.push({ id: "CX-1", source: "E-2", target: { kind: "element", id: "E-1" } });
    m.coexistences.push({ id: "CX-2", source: "E-2", target: { kind: "requirement", id: "E-1" } });
    expect(importSysml(exportSysml(m, { packageName: "X" })).model).toEqual(m);
  });
});

describe("SysML v2 読み込みのエラー", () => {
  const wrap = (body: string) => `package P { private import SCDL::*; ${body} }`;

  it("SCDL 以外の宣言(注釈なし)は無視する", () => {
    const { model } = importSysml(wrap("part plain { part inner; } requirement r1;"));
    expect(model).toEqual({ ...model, elements: [], requirements: [] });
  });

  it("未対応の構文はエラー", () => {
    expect(() => importSysml(wrap("action a;"))).toThrow(/未対応の構文/);
  });

  it("解決できない参照はエラー(行番号つき)", () => {
    const t = wrap("requirement 'A' { @ScdlRequirement; }\ndependency 'I' from P::'A' to P::'Z' { @ScdlInteraction; }");
    expect(() => importSysml(t)).toThrow(/解決できません.*行 2/);
  });

  it("ステレオタイプと宣言の種類が合わないとエラー", () => {
    expect(() => importSysml(wrap("part 'A' { @ScdlRequirement; }"))).toThrow(/requirement に適用/);
  });

  it("1 つの要求を複数のエレメントに配置すると指摘する", () => {
    const t = wrap(`
      part 'E1' { @ScdlElement; }
      part 'E2' { @ScdlElement; }
      requirement 'R' { @ScdlRequirement; }
      satisfy P::'R' by P::'E1';
      satisfy P::'R' by P::'E2';`);
    expect(importSysml(t).issues.map((i) => i.code)).toEqual(["ALLOCATION_MULTIPLE"]);
  });

  it("閉じていない引用符/コメントはエラー", () => {
    expect(() => importSysml("package P { part 'A")).toThrow(/引用符/);
    expect(() => importSysml("package P { /* x ")).toThrow(/コメント/);
  });
});

describe("役割(拡張)の検査", () => {
  it("両端が同じ役割のペアを警告する", () => {
    const m = redundantArchitecture();
    m.groups.find((g) => g.id === "SRG-1")!.role = "intendedFunction";
    expect(validateScdl(m).map((i) => i.code)).toContain("PAIR_ROLES");
  });
});
