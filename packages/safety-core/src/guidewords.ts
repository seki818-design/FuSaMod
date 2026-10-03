import type { FunctionNode } from "./net-types.js";

export interface Guideword {
  id: string;
  ja: string;
  en: string;
}

/** 機能の否定から故障モード候補を作るためのガイドワード(叩き台。ドメイン担当が拡張する)。 */
export const GUIDEWORDS: readonly Guideword[] = [
  { id: "loss", ja: "機能喪失", en: "loss of function" },
  { id: "degraded", ja: "性能低下", en: "degraded" },
  { id: "excess", ja: "過大", en: "excessive" },
  { id: "intermittent", ja: "断続的", en: "intermittent" },
  { id: "unintended", ja: "意図しない動作", en: "unintended" },
  { id: "delayed", ja: "遅延", en: "delayed" },
  { id: "reversed", ja: "逆方向", en: "reversed" },
  { id: "stuck", ja: "固着", en: "stuck" },
];

export interface FailureModeCandidate {
  functionId: string;
  guidewordId: string;
  description: string;
  /** 出力パラメータ単位の候補のとき、そのパラメータ名 */
  parameter?: string;
}

/** 故障モードの候補を提案する(確定は人が行う。AI 提案の入力にも使う)。 */
export function failureModeCandidates(fn: FunctionNode): FailureModeCandidate[] {
  return GUIDEWORDS.map((g) => ({
    functionId: fn.id,
    guidewordId: g.id,
    description: `${fn.name}: ${g.ja}`,
  }));
}

/** 出力として意味を持つガイドワード(出力が出ない/小さい/大きい/断続/遅い/固着/逆)。「意図しない動作」は機能単位で扱う。 */
const OUTPUT_GUIDEWORDS = new Set(["loss", "degraded", "excess", "intermittent", "delayed", "stuck", "reversed"]);

/** 機能の出力パラメータごとの故障モード候補(例: 「トルクが出ない」「トルクが過大」)。 */
export function outputFailureModeCandidates(fn: FunctionNode, parameter: string): FailureModeCandidate[] {
  return GUIDEWORDS.filter((g) => OUTPUT_GUIDEWORDS.has(g.id)).map((g) => ({
    functionId: fn.id,
    guidewordId: g.id,
    parameter,
    description: `${fn.name}: 出力「${parameter}」${g.ja}`,
  }));
}
