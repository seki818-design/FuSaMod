export type ActionPriority = "H" | "M" | "L";

/** 従来の RPN。AIAG-VDA では AP が主、RPN は参考指標として併記できるようにする。 */
export function rpn(s: number, o: number, d: number): number {
  return s * o * d;
}

export interface ApRule {
  s: [number, number];
  o: [number, number];
  d: [number, number];
  ap: ActionPriority;
}

export type ApLookup = (s: number, o: number, d: number) => ActionPriority;

const RANGE = Array.from({ length: 10 }, (_, i) => i + 1);
const RANK: Record<ActionPriority, number> = { L: 0, M: 1, H: 2 };

/**
 * AP 表を検証してルックアップ関数にする。
 * 表の値は AIAG-VDA FMEA ハンドブックの正式な表をユーザーが投入する(ADR-0004)。
 * 検証内容: 10×10×10 の全組み合わせをちょうど 1 回ずつ網羅 / S・O・D について単調非減少。
 */
export function compileApTable(rules: ApRule[]): ApLookup {
  const table = new Map<string, ActionPriority>();
  for (const r of rules) {
    for (const s of RANGE.filter((v) => v >= r.s[0] && v <= r.s[1]))
      for (const o of RANGE.filter((v) => v >= r.o[0] && v <= r.o[1]))
        for (const d of RANGE.filter((v) => v >= r.d[0] && v <= r.d[1])) {
          const key = `${s},${o},${d}`;
          if (table.has(key)) throw new Error(`AP 表が重複しています: S=${s} O=${o} D=${d}`);
          table.set(key, r.ap);
        }
  }
  for (const s of RANGE)
    for (const o of RANGE)
      for (const d of RANGE) {
        const cur = table.get(`${s},${o},${d}`);
        if (!cur) throw new Error(`AP 表に未定義の組み合わせがあります: S=${s} O=${o} D=${d}`);
        for (const [ns, no, nd] of [
          [s + 1, o, d],
          [s, o + 1, d],
          [s, o, d + 1],
        ] as const) {
          const next = table.get(`${ns},${no},${nd}`);
          if (next && RANK[next] < RANK[cur])
            throw new Error(
              `AP 表が単調ではありません: (${s},${o},${d})=${cur} > (${ns},${no},${nd})=${next}`,
            );
        }
      }
  return (s, o, d) => {
    const ap = table.get(`${s},${o},${d}`);
    if (!ap) throw new RangeError(`評価値は 1〜10 の整数: S=${s} O=${o} D=${d}`);
    return ap;
  };
}

export function isRating(v: number | undefined): v is number {
  return v !== undefined && Number.isInteger(v) && v >= 1 && v <= 10;
}
