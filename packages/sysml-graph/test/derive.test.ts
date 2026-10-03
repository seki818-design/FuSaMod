import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildFmeaView, impactOfFailureChange, validateNet } from "@fusamod/safety-core";
import { deriveNet, type ElementGraph } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const loadGraph = (): ElementGraph =>
  JSON.parse(readFileSync(resolve(here, "../../../examples/sysml/ev-powertrain.graph.json"), "utf8")) as ElementGraph;

const P = "'EV Powertrain'::";
const VEH = `${P}vehicle`;
const PT = `${VEH}::powertrain`;
const INV = `${PT}::inverter`;
const MOT = `${PT}::motor`;
const F_DRIVE = `${VEH}::'drive vehicle'`;
const F_TORQUE = `${F_DRIVE}::'output drive torque'`;
const F_CONV = `${F_TORQUE}::'convert power'`;
const F_GEN = `${F_TORQUE}::'generate torque'`;

describe("SysML モデルからの構造ネット・機能ネットの導出", () => {
  const d = deriveNet(loadGraph());

  it("構造ネット: part の入れ子", () => {
    const parents = Object.fromEntries(d.net.elements.map((e) => [e.id, e.parentId ?? null]));
    expect(parents).toEqual({ [VEH]: null, [PT]: VEH, [INV]: PT, [MOT]: PT });
    expect(d.net.elements.find((e) => e.id === MOT)).toMatchObject({ name: "motor", modelRef: MOT });
  });

  it("機能ネット: perform で担当要素が決まり、action の入れ子が上位機能になる", () => {
    const f = Object.fromEntries(d.net.functions.map((x) => [x.id, [x.ownerId, x.parentFunctionId ?? null]]));
    expect(f).toEqual({
      [F_DRIVE]: [VEH, null], // part が所有する action → その part の機能
      [F_TORQUE]: [PT, F_DRIVE], // perform によりパワートレインの機能
      [F_CONV]: [INV, F_TORQUE],
      [F_GEN]: [MOT, F_TORQUE],
    });
  });

  it("導出したネットは、階層の整合に関するエラー/警告を出さない(未着手の故障モードのみ)", () => {
    expect(d.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(d.issues.map((i) => i.code).filter((c) => c !== "FUNCTION_WITHOUT_FAILURE")).toEqual([]);
    expect(d.issues.filter((i) => i.code === "FUNCTION_WITHOUT_FAILURE")).toHaveLength(4);
  });

  it("要求と satisfy を構造要素に結びつける", () => {
    expect(d.requirements).toEqual([
      { id: `${P}'REQ-001'`, text: "加速要求に対して、意図しない過大トルクを出力しないこと", satisfiedBy: [PT] },
      { id: `${P}'REQ-002'`, text: "モータは要求トルクに従ってトルクを発生すること", satisfiedBy: [MOT] },
    ]);
  });

  it("故障モード候補: 機能単位と出力パラメータ単位", () => {
    const perFunction = d.candidates.filter((c) => c.parameter === undefined);
    expect(perFunction).toHaveLength(4 * 8);
    const gen = d.candidates.filter((c) => c.functionId === F_GEN && c.parameter === "motor torque");
    expect(gen.length).toBeGreaterThan(0);
    expect(gen.map((c) => c.description)).toContain("generate torque: 出力「motor torque」機能喪失");
    // 入力パラメータ(accelerator request)からは候補を作らない
    expect(d.candidates.some((c) => c.parameter === "accelerator request")).toBe(false);
    expect(d.parameters[F_DRIVE]).toEqual([{ name: "accelerator request", direction: "in", type: "Real" }]);
  });
});

describe("導出したネットから FMEA へ(端から端まで)", () => {
  it("候補から故障ノードを確定し、上位/下位の FMEA が同一ノードで繋がる", () => {
    const { net } = deriveNet(loadGraph());
    // 候補のうち 3 つを採用して故障ノードにする(人または AI が選ぶ想定)
    net.failures.push(
      { id: "fe-veh", description: "走行不能", functionId: F_DRIVE, severity: 10 },
      { id: "fm-pt", description: "駆動トルクが出ない", functionId: F_TORQUE },
      { id: "fm-mot", description: "モータがトルクを発生しない", functionId: F_GEN },
      { id: "fm-inv", description: "インバータが出力しない", functionId: F_CONV },
    );
    net.links.push(
      { id: "l1", causeId: "fm-pt", effectId: "fe-veh", occurrence: 3, detection: 4 },
      { id: "l2", causeId: "fm-mot", effectId: "fm-pt", occurrence: 4, detection: 5 },
      { id: "l3", causeId: "fm-inv", effectId: "fm-pt", occurrence: 3, detection: 4 },
    );
    expect(validateNet(net).filter((i) => i.severity === "error")).toEqual([]);

    const pt = buildFmeaView(net, PT);
    expect(pt.rows).toHaveLength(1);
    expect(pt.rows[0]!.effects.map((e) => e.failureId)).toEqual(["fe-veh"]);
    expect(pt.rows[0]!.causes.map((c) => c.failureId).sort()).toEqual(["fm-inv", "fm-mot"]);
    expect(pt.rows[0]!.severity).toBe(10);

    const mot = buildFmeaView(net, MOT);
    expect(mot.rows[0]!.effects.map((e) => e.failureId)).toEqual(["fm-pt"]);
    expect(mot.rows[0]!.severity).toBe(10);

    expect(impactOfFailureChange(net, "fm-pt").affectedElements.sort()).toEqual([INV, MOT, PT, VEH].sort());
  });
});

describe("導出時の指摘", () => {
  const base = (): ElementGraph => loadGraph();

  it("担当 part を決められない action は除外して警告", () => {
    const g = base();
    g.elements.push({ kind: "ActionUsage", qualifiedName: `${P}orphanAction`, name: "orphanAction", owner: P.slice(0, -2) });
    const d = deriveNet(g);
    expect(d.issues.map((i) => i.code)).toContain("FUNCTION_NO_OWNER");
    expect(d.net.functions.some((f) => f.id === `${P}orphanAction`)).toBe(false);
  });

  it("複数の part が perform すると警告(先頭を担当)", () => {
    const g = base();
    g.performs!.push({ performer: INV, performed: F_GEN });
    const d = deriveNet(g);
    expect(d.issues.map((i) => i.code)).toContain("FUNCTION_MULTIPLE_PERFORMERS");
    expect(d.net.functions.find((f) => f.id === F_GEN)!.ownerId).toBe(MOT);
  });

  it("part 以外の perform / part 以外への satisfy は無視して警告", () => {
    const g = base();
    g.performs!.push({ performer: F_DRIVE, performed: F_GEN });
    g.satisfies.push({ requirement: `${P}'REQ-001'`, by: F_DRIVE });
    const codes = deriveNet(g).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["PERFORM_NOT_PART", "SATISFY_NOT_PART"]));
  });

  it("part が無いグラフはエラー", () => {
    const g = base();
    g.elements = g.elements.filter((e) => e.kind !== "PartUsage");
    expect(deriveNet(g).issues.map((i) => i.code)).toContain("NO_STRUCTURE");
  });
});
