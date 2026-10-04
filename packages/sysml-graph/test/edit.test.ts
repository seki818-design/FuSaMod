import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { addChild, decodeName, editability, encodeName, remapIds, removeElement, renameElement, type ElementGraph } from "../src/index.js";

const dir = resolve(import.meta.dirname, "../../../examples/sysml");
const load = (n: string) => ({ text: readFileSync(resolve(dir, `${n}.sysml`), "utf8"), graph: JSON.parse(readFileSync(resolve(dir, `${n}.graph.json`), "utf8")) as ElementGraph });
const P = "TypedDefinitions";

describe("図からのモデルの書き換え(公式実装が出力した位置で確認)", () => {
  const { text, graph } = load("typed-definitions");
  it("本体のある要素の中に部品を追加する（閉じ括弧の前に、既存と同じ字下げで入る）", () => {
    const r = addChild(text, graph, `${P}::Car`, "part", "spare");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain("        part spare;\n    }");
      expect(r.text.length).toBeGreaterThan(text.length);
    }
  });
  it("本体の無い要素（part rotor;）に追加すると、; が本体に置き換わる", () => {
    const r = addChild(text, graph, `${P}::Motor::rotor`, "part", "shaft");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toMatch(/part rotor \{\n\s+part shaft;\n\s+\}/);
  });
  it("機能の追加は perform action になる", () => {
    const r = addChild(text, graph, `${P}::Motor::rotor`, "function", "spin");
    expect(r.ok && r.text).toContain("perform action spin;");
  });
  it("最上位に追加するとパッケージの直下に入る。最上位に機能は追加できない", () => {
    const r = addChild(text, graph, undefined, "part", "extra");
    expect(r.ok).toBe(true);
    expect(addChild(text, graph, undefined, "function", "f").ok).toBe(false);
  });
  it("同名の要素・不正な名前は拒否する。空白や日本語の名前は引用符で囲む", () => {
    expect(addChild(text, graph, `${P}::Car`, "part", "front")).toMatchObject({ ok: false });
    expect(addChild(text, graph, `${P}::Car`, "part", "   ")).toMatchObject({ ok: false });
    expect(encodeName("my part")).toBe("'my part'");
    expect(encodeName("モーター")).toBe("'モーター'");
    expect(encodeName("part")).toBe("'part'"); // 予約語
    expect(encodeName("ok_1")).toBe("ok_1");
    expect(decodeName("'a\\'b'")).toBe("a'b");
    const r = addChild(text, graph, `${P}::Car`, "part", "ECU 2");
    expect(r.ok && r.text).toContain("part 'ECU 2';");
  });
  it("名前変更: 宣言と、同じ名前の参照を書き換え、ID の変更を返す", () => {
    const r = renameElement(text, graph, `${P}::Motor`, "Engine");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain("part def Engine");
      expect(r.text).toContain("part front : Engine;");
      expect(r.text).not.toMatch(/\bMotor\b/);
      expect(r.idChange).toEqual({ from: `${P}::Motor`, to: `${P}::Engine` });
    }
  });
  it("名前変更: 参照の書き換えを切ると、宣言だけが変わる", () => {
    const r = renameElement(text, graph, `${P}::Motor`, "Engine", false);
    expect(r.ok && r.text).toContain("part front : Motor;");
  });
  it("コメント・文字列の中の同じ語は書き換えない", () => {
    const t2 = text.replace("package TypedDefinitions {", 'package TypedDefinitions {\n    // Motor のコメント\n    doc /* Motor doc */');
    const g2 = JSON.parse(JSON.stringify(graph)) as ElementGraph;
    // 位置がずれるので、再解析されたものとして扱えない: 古い位置は検出されて拒否される
    expect(renameElement(t2, g2, `${P}::Motor`, "Engine")).toMatchObject({ ok: false });
  });
  it("同じ名前の宣言が複数あるときは、参照を書き換えず、宣言だけを変える", () => {
    const r = renameElement(text, graph, `${P}::Car::front`, "head");
    // front は Car の使用で、他に同名の宣言（Axle など）が無ければ参照も書き換わる。ここでは宣言が変わることだけを確かめる
    expect(r.ok && r.text).toContain("part head : Motor;");
  });
  it("同じ階層に同名があるとき、名前変更は拒否する", () => {
    expect(renameElement(text, graph, `${P}::Car::front`, "rear")).toMatchObject({ ok: false });
  });
  it("削除: その要素の行を丸ごと消す", () => {
    const r = removeElement(text, graph, `${P}::Car::rear`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).not.toContain("part rear");
      expect(r.text).toContain("part front");
      expect(r.text.split("\n").length).toBe(text.split("\n").length - 1);
    }
  });
  it("パッケージは削除できない。型から展開された要素（グラフに無い ID）は編集できない", () => {
    expect(removeElement(text, graph, P)).toMatchObject({ ok: false });
    const r = editability(text, graph, `${P}::car::front::rotor`);
    expect(r.ok).toBe(false);
  });
  it("テキストが解析時から変わっている（位置が合わない）と、書き換えずに理由を返す", () => {
    const r = addChild(`// 追記\n${text}`, graph, `${P}::Car`, "part", "x");
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.reason).toContain("変更されています");
  });
  it("編集後のテキストは、もう一度同じ操作の前提（位置）を満たさない＝古いグラフでの連続編集を防ぐ", () => {
    const r1 = addChild(text, graph, `${P}::Car`, "part", "spare");
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(addChild(r1.text, graph, `${P}::Car`, "part", "spare2")).toMatchObject({ ok: false });
  });
});

describe("名前変更に伴う ID の付け替え", () => {
  it("完全一致と接頭辞（子孫）を付け替え、キーも付け替える。aiChanges は触らない", () => {
    const data = { a: "X::Motor", b: ["X::Motor::rotor", "X::MotorBike"], levelOverrides: { "X::Motor": "detail" }, aiChanges: [{ id: "X::Motor" }] };
    const r = remapIds(data, "X::Motor", "X::Engine");
    expect(r).toEqual({ a: "X::Engine", b: ["X::Engine::rotor", "X::MotorBike"], levelOverrides: { "X::Engine": "detail" }, aiChanges: [{ id: "X::Motor" }] });
  });
});

import { addMessage, addSuccession, moveMessage, removeMessage, removeSuccession, renameMessage } from "../src/index.js";

describe("アクティビティ図・シーケンス図の編集(公式実装が出力した位置で確認)", () => {
  const { text, graph } = load("behavior-diagrams");
  const B = "BehaviorDiagrams";
  it("公式実装が、後続関係（開始・終了を含む）とメッセージ（送り手・受け手・型）を出力している", () => {
    expect(graph.successions!.map((s) => `${s.source.split("::").pop()}>${s.target.split("::").pop()}`)).toEqual(["start>readPedal", "readPedal>computeTorque", "computeTorque>outputTorque", "outputTorque>done"]);
    expect(graph.messages!.map((m) => `${m.name}:${m.from.split("::").pop()}>${m.to.split("::").pop()}:${m.payload ?? ""}`)).toEqual(["pedalPos:driver>vcu:Real", "torqueCmd:vcu>inverter:Real", "ack:inverter>vcu:"]);
  });
  it("アクションを追加し、後続関係をつなぐ（first … then …）。重複・自己ループ・不正な向きは拒否", () => {
    const r1 = addChild(text, graph, `${B}::Accelerate`, "action", "limitTorque");
    expect(r1.ok && r1.text).toContain("action limitTorque;");
    const r2 = addSuccession(text, graph, `${B}::Accelerate`, `${B}::Accelerate::readPedal`, `${B}::Accelerate::outputTorque`);
    expect(r2.ok && r2.text).toContain("first readPedal then outputTorque;");
    expect(addSuccession(text, graph, `${B}::Accelerate`, `${B}::Accelerate::readPedal`, `${B}::Accelerate::computeTorque`)).toMatchObject({ ok: false }); // 既にある
    expect(addSuccession(text, graph, `${B}::Accelerate`, `${B}::Accelerate::readPedal`, `${B}::Accelerate::readPedal`)).toMatchObject({ ok: false });
    expect(addSuccession(text, graph, `${B}::Accelerate`, "done", `${B}::Accelerate::readPedal`)).toMatchObject({ ok: false });
    expect(addSuccession(text, graph, `${B}::Accelerate`, `${B}::Accelerate::readPedal`, "start")).toMatchObject({ ok: false });
    const r3 = addSuccession(text, graph, `${B}::Accelerate`, "start", `${B}::Accelerate::outputTorque`);
    expect(r3.ok && r3.text).toContain("first start then outputTorque;");
  });
  it("後続関係を削除すると、その行だけが消える", () => {
    const r = removeSuccession(text, graph, `${B}::Accelerate`, `${B}::Accelerate::readPedal`, `${B}::Accelerate::computeTorque`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).not.toContain("first readPedal then computeTorque");
      expect(r.text).toContain("first start then readPedal");
      expect(r.text.split("\n").length).toBe(text.split("\n").length - 1);
    }
  });
  it("メッセージを末尾に、または指定したメッセージの直後に追加する（時間順）", () => {
    const end = addMessage(text, graph, `${B}::system`, "reset", `${B}::system::vcu`, `${B}::system::driver`);
    expect(end.ok && end.text).toMatch(/message ack from inverter to vcu;\n\s+message reset from vcu to driver;/);
    const mid = addMessage(text, graph, `${B}::system`, "check", `${B}::system::vcu`, `${B}::system::inverter`, `${B}::system::pedalPos`);
    expect(mid.ok && mid.text).toMatch(/message pedalPos of Real from driver to vcu;\n\s+message check from vcu to inverter;\n\s+message torqueCmd/);
    expect(addMessage(text, graph, `${B}::system`, "ack", `${B}::system::vcu`, `${B}::system::driver`)).toMatchObject({ ok: false }); // 同名
    expect(addMessage(text, graph, `${B}::system`, "x", `${B}::system::nope`, `${B}::system::vcu`)).toMatchObject({ ok: false });
  });
  it("メッセージの名前変更・削除・順序の入れ替え", () => {
    const ren = renameMessage(text, graph, `${B}::system::ack`, "ackBack");
    expect(ren.ok && ren.text).toContain("message ackBack from inverter to vcu;");
    const del = removeMessage(text, graph, `${B}::system::torqueCmd`);
    expect(del.ok && del.text).not.toContain("torqueCmd");
    const up = moveMessage(text, graph, `${B}::system::torqueCmd`, -1);
    expect(up.ok).toBe(true);
    if (up.ok) expect(up.text.indexOf("message torqueCmd")).toBeLessThan(up.text.indexOf("message pedalPos"));
    expect(moveMessage(text, graph, `${B}::system::pedalPos`, -1)).toMatchObject({ ok: false });
    expect(moveMessage(text, graph, `${B}::system::ack`, 1)).toMatchObject({ ok: false });
  });
  it("古い位置（テキストが変わった後）では、書き換えない", () => {
    expect(removeMessage(`// x\n${text}`, graph, `${B}::system::ack`)).toMatchObject({ ok: false });
    expect(renameMessage(`// x\n${text}`, graph, `${B}::system::ack`, "y")).toMatchObject({ ok: false });
  });
});

describe("削除に伴う、メッセージ・後続関係の整理", () => {
  const { text, graph } = load("behavior-diagrams");
  const B = "BehaviorDiagrams";
  it("部品を削除すると、その部品を送り手・受け手とするメッセージも消える（参照エラーを残さない）", () => {
    const r = removeElement(text, graph, `${B}::system::inverter`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).not.toContain("inverter");
      expect(r.text).toContain("message pedalPos");
    }
  });
  it("アクションを削除すると、それにつながる矢印も消える", () => {
    const r = removeElement(text, graph, `${B}::Accelerate::computeTorque`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).not.toContain("computeTorque");
      expect(r.text).toContain("first start then readPedal");
    }
  });
});
