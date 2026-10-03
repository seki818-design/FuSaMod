import type { CellStatus } from "@fusamod/analysis";
import type { Asil } from "@fusamod/safety-core";

export const STATUS: Record<CellStatus, { label: string; icon: string; cls: string }> = {
  consistent: { label: "整合", icon: "✓", cls: "consistent" },
  review: { label: "要確認", icon: "▲", cls: "review" },
  inconsistent: { label: "不整合", icon: "✕", cls: "inconsistent" },
  undetermined: { label: "未確定", icon: "?", cls: "undetermined" },
  none: { label: "—", icon: "", cls: "none" },
};

export function AsilBadge({ asil, origin }: { asil: Asil | string; origin?: Asil | string }) {
  const text = origin && origin !== asil ? `${asil}(${origin})` : String(asil);
  const base = String(origin ?? asil);
  return (
    <span className={`badge accent asil-${base === "D" ? "D" : base === "C" ? "C" : ""}`} title={`ASIL ${text}`}>
      ASIL {text}
    </span>
  );
}

export function SeverityBadge({ s }: { s: "error" | "warning" }) {
  return s === "error" ? <span className="badge err">✕ エラー</span> : <span className="badge warn">▲ 警告</span>;
}

/** 完全修飾名の最後の名前(引用符を外す)。 */
export const last = (qn: string) => (qn.split("::").pop() ?? qn).replace(/^'(.*)'$/, "$1");

/** 「AI-FM-001」のような接頭辞つきの次の ID を返す。 */
export function nextId(prefix: string, existing: string[]): string {
  let n = 1;
  const used = new Set(existing);
  while (used.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

/** 全角(日本語など)を 2、半角を 1 として数え、最大幅(units)に収まるように末尾を「…」で切り詰める。 */
export function fit(text: string, units: number): string {
  let used = 0;
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const w = c <= 0xff || (c >= 0xff61 && c <= 0xff9f) ? 1 : 2;
    if (used + w > units - 1) return `${out}…`;
    used += w;
    out += ch;
  }
  return out;
}
