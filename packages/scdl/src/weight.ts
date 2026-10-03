import { ASILS, asilRank, type Asil } from "@fusamod/safety-core";

export interface ParsedWeight {
  asil: Asil;
  /** 分解前の元 ASIL(表記 A(B) の括弧内) */
  origin?: Asil;
}

const PATTERN = /^(QM|A|B|C|D)(?:\((QM|A|B|C|D)\))?$/;

/** "B" / "A(B)" を解釈する。不正な表記は undefined。 */
export function parseWeight(w: string): ParsedWeight | undefined {
  const m = PATTERN.exec(w.trim());
  if (!m) return undefined;
  const asil = m[1] as Asil;
  const origin = m[2] as Asil | undefined;
  if (origin !== undefined && asilRank(origin) < asilRank(asil)) return undefined;
  return origin ? { asil, origin } : { asil };
}

export { ASILS };
