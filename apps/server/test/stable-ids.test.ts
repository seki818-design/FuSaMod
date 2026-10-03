import { describe, expect, it } from "vitest";
import { stabilizeJsonIds } from "../src/sysml/stable-ids.js";

const rec = (id: string, extra: object) => ({ identity: { "@id": id }, payload: { elementId: id, ...extra } });
const sample = (ids: string[]) =>
  JSON.stringify([
    rec(ids[0]!, { "@type": "Package", declaredName: "P" }),
    rec(ids[1]!, { "@type": "PartUsage", declaredName: "a", owner: { "@id": ids[0]! } }),
    rec(ids[2]!, { "@type": "PartUsage", declaredName: "a", owner: { "@id": ids[0]! }, ownedRelationship: [{ "@id": ids[1]! }] }),
    rec(ids[3]!, { "@type": "FeatureTyping", owner: { "@id": ids[2]! }, type: { "@id": "11111111-1111-1111-1111-111111111111" } }),
  ]);

describe("標準 JSON の elementId を決定的にする", () => {
  const a = sample(["a0000000-0000-0000-0000-000000000001", "a0000000-0000-0000-0000-000000000002", "a0000000-0000-0000-0000-000000000003", "a0000000-0000-0000-0000-000000000004"]);
  const b = sample(["b0000000-0000-0000-0000-000000000009", "b0000000-0000-0000-0000-000000000008", "b0000000-0000-0000-0000-000000000007", "b0000000-0000-0000-0000-000000000006"]);
  it("ランダムな ID が違っても、同じモデルなら同じ出力になる", () => {
    expect(stabilizeJsonIds(a)).toBe(stabilizeJsonIds(b));
  });
  it("参照も一緒に置き換わり、閉じている(置き換え後の参照先が存在する)。外部(出力に含まれない要素)への参照は決定的な ID になる", () => {
    const out = JSON.parse(stabilizeJsonIds(a)) as { payload: { elementId: string; owner?: { "@id": string }; ownedRelationship?: { "@id": string }[] } }[];
    const ids = new Set(out.map((r) => r.payload.elementId));
    expect(ids.size).toBe(4);
    for (const r of out) if (r.payload.owner) expect(ids.has(r.payload.owner["@id"])).toBe(true);
    // 出力に含まれない要素（ライブラリなど）への参照は、変換のたびに変わるので、参照元から決めた ID に置き換える
    expect(stabilizeJsonIds(a)).not.toContain("11111111-1111-1111-1111-111111111111");
    expect(stabilizeJsonIds(a)).not.toContain("a0000000");
  });
  it("同名・同種の兄弟は区別される(同じ ID にならない)", () => {
    const out = JSON.parse(stabilizeJsonIds(a)) as { payload: { elementId: string } }[];
    expect(out[1]!.payload.elementId).not.toBe(out[2]!.payload.elementId);
  });
  it("JSON でないものはそのまま返す", () => {
    expect(stabilizeJsonIds("not json")).toBe("not json");
  });
});
