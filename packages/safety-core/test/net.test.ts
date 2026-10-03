import { describe, expect, it } from "vitest";
import {
  buildFmeaView,
  buildIndex,
  compileApTable,
  failureModeCandidates,
  impactOfFailureChange,
  effectiveSeverity,
  validateNet,
  type ApRule,
} from "../src/index.js";
import { sampleNet } from "./fixtures.js";

describe("FMEA ビュー(ネットの射影)", () => {
  it("上位FMEAの故障モードが下位FMEAの故障影響として同一ノードで現れる", () => {
    const net = sampleNet();
    const pt = buildFmeaView(net, "pt");
    const mot = buildFmeaView(net, "mot");
    expect(pt.rows).toHaveLength(1);
    // Powertrain の原因 = Motor の故障モード
    expect(pt.rows[0]!.causes.map((c) => c.failureId)).toEqual(["x-mot"]);
    // Motor の影響 = Powertrain の故障モード
    expect(mot.rows[0]!.effects.map((e) => e.failureId)).toEqual(["x-pt"]);
    expect(mot.rows[0]!.causes.map((c) => c.failureId)).toEqual(["x-wind"]);
  });

  it("重大度は最上位の故障影響から下位へ継承される", () => {
    const net = sampleNet();
    expect(effectiveSeverity(buildIndex(net), "x-wind")).toBe(10);
    expect(buildFmeaView(net, "mot").rows[0]!.severity).toBe(10);
  });

  it("RPN と AP を原因ごとに算出する", () => {
    const rules: ApRule[] = [
      { s: [1, 10], o: [1, 10], d: [1, 10], ap: "L" },
    ];
    // 全組合せ L の一様表(検証機能の動作確認用)
    const view = buildFmeaView(sampleNet(), "mot", compileApTable(rules));
    expect(view.rows[0]!.causes[0]).toMatchObject({ rpn: 10 * 3 * 6, ap: "L" });
  });
});

describe("整合性チェック", () => {
  it("サンプルは構造エラーなし", () => {
    expect(validateNet(sampleNet()).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("階層を飛び越えるリンクはエラー", () => {
    const net = sampleNet();
    net.links.push({ id: "bad", causeId: "x-mot", effectId: "x-veh", occurrence: 1, detection: 1 });
    expect(validateNet(net).map((i) => i.code)).toContain("LINK_LEVEL");
  });

  it("故障リンクの循環を検出する", () => {
    const net = sampleNet();
    net.links.push({ id: "loop", causeId: "x-veh", effectId: "x-wind" });
    const codes = validateNet(net).map((i) => i.code);
    expect(codes).toContain("FAILURE_CYCLE");
  });

  it("原因なし/影響なし/未評価を警告する", () => {
    const net = sampleNet();
    net.failures.push({ id: "x-orphan", description: "孤立", functionId: "f-pt" });
    const orphan = validateNet(net).filter((i) => i.ref === "x-orphan").map((i) => i.code);
    expect(orphan).toEqual(expect.arrayContaining(["NO_CAUSE", "NO_EFFECT"]));
  });

  it("最上位の影響に重大度が無いと警告", () => {
    const net = sampleNet();
    delete net.failures[0]!.severity;
    expect(validateNet(net).map((i) => i.code)).toContain("MISSING_SEVERITY");
  });

  it("評価値の範囲外はエラー", () => {
    const net = sampleNet();
    net.links[0]!.occurrence = 11;
    expect(validateNet(net).map((i) => i.code)).toContain("RATING_RANGE");
  });
});

describe("変更影響", () => {
  it("中間の故障を変えると上下の FMEA が要再確認になる", () => {
    const r = impactOfFailureChange(sampleNet(), "x-pt");
    expect(r.upstream.map((x) => x.failureId)).toEqual(["x-veh"]);
    expect(r.downstream.map((x) => x.failureId).sort()).toEqual(["x-mot", "x-wind"]);
    expect(r.affectedElements.sort()).toEqual(["mot", "pt", "veh"]);
  });
});

describe("AP 表の検証", () => {
  it("未定義の組み合わせを拒否する", () => {
    expect(() => compileApTable([{ s: [1, 9], o: [1, 10], d: [1, 10], ap: "L" }])).toThrow(/未定義/);
  });
  it("重複を拒否する", () => {
    expect(() =>
      compileApTable([
        { s: [1, 10], o: [1, 10], d: [1, 10], ap: "L" },
        { s: [5, 5], o: [1, 1], d: [1, 1], ap: "H" },
      ]),
    ).toThrow(/重複/);
  });
  it("単調でない表を拒否する", () => {
    expect(() =>
      compileApTable([
        { s: [1, 9], o: [1, 10], d: [1, 10], ap: "H" },
        { s: [10, 10], o: [1, 10], d: [1, 10], ap: "L" },
      ]),
    ).toThrow(/単調/);
  });
});

describe("ガイドワード", () => {
  it("機能から故障モード候補を作る", () => {
    const c = failureModeCandidates({ id: "f", name: "トルクを出す", ownerId: "mot" });
    expect(c.length).toBeGreaterThan(0);
    expect(c[0]!.description).toContain("トルクを出す");
  });
});
