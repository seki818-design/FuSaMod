import { asilRank, type Asil } from "./asil.js";
import type { Issue } from "./issues.js";

/**
 * ハードウェアアーキテクチャのメトリクス(ISO 26262-5 の SPFM / LFM)の入力。故障率は利用者が与える(本ツールは算出のみ)。
 *  - single : 安全目標の違反に**直接**つながりうる故障(単一点故障 / 残存故障の候補)。安全機構が無ければ DC は 0。
 *  - multiple: 他の故障との組み合わせで初めて違反になる故障(多重故障。潜在故障の候補)。
 */
export interface HardwareFailureMode {
  id: string;
  name: string;
  /** 構造要素の ID(任意。存在確認のみ) */
  elementId?: string;
  /** 故障率 [FIT = 10⁻⁹ /h](この故障モードの分) */
  fit: number;
  /** そのうち、安全に影響しない(安全な故障)割合 0〜1。既定 0 */
  safeFraction?: number;
  type: "single" | "multiple";
  /** single: 安全機構による、単一点・残存故障に対する診断カバレッジ 0〜1(安全機構が無ければ 0) */
  dcSpfRf?: number;
  /** multiple: 潜在故障に対する診断カバレッジ 0〜1 */
  dcLatent?: number;
}

export interface HwMetrics {
  /** 安全に関係する故障率の合計 [FIT] */
  totalFit: number;
  /** 単一点故障 + 残存故障の故障率 [FIT] */
  singleResidualFit: number;
  /** 潜在多重故障の故障率 [FIT] */
  latentFit: number;
  /** 単一点故障メトリクス(0〜1)。故障率が 0 なら undefined */
  spfm: number | undefined;
  /** 潜在故障メトリクス(0〜1)。分母が 0 なら undefined */
  lfm: number | undefined;
}

/** ISO 26262-5 の目標値(ASIL B / C / D)。QM と A には目標値が無い。 */
export const HW_TARGETS: Partial<Record<Asil, { spfm: number; lfm: number }>> = {
  B: { spfm: 0.9, lfm: 0.6 },
  C: { spfm: 0.97, lfm: 0.8 },
  D: { spfm: 0.99, lfm: 0.9 },
};

const clamp01 = (v: number | undefined, dflt: number) => (v === undefined ? dflt : v);

/**
 * SPFM = 1 − Σ(λSPF + λRF) / Σλ(安全関連)
 * LFM  = 1 − Σλ(潜在多重故障) / (Σλ(安全関連) − Σ(λSPF + λRF))
 * single の λSPF+λRF = λ·(1−DC_spfrf)、multiple の λ潜在 = λ·(1−DC_latent)。(安全な故障の割合は先に除く)
 * 入力は validateHwModes で検証しておくこと。
 */
export function computeHwMetrics(modes: HardwareFailureMode[]): HwMetrics {
  let total = 0;
  let single = 0;
  let latent = 0;
  for (const m of modes) {
    const sr = m.fit * (1 - clamp01(m.safeFraction, 0));
    total += sr;
    if (m.type === "single") single += sr * (1 - clamp01(m.dcSpfRf, 0));
    else latent += sr * (1 - clamp01(m.dcLatent, 0));
  }
  const lfmDen = total - single;
  return {
    totalFit: total,
    singleResidualFit: single,
    latentFit: latent,
    spfm: total > 0 ? 1 - single / total : undefined,
    lfm: lfmDen > 0 ? 1 - latent / lfmDen : undefined,
  };
}

/** 入力の検証と、目標値との比較(安全目標の最大の ASIL に対する)。 */
export function validateHwModes(modes: HardwareFailureMode[], goalAsils: Asil[], knownElements?: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, message: string, ref?: string) => issues.push({ code, severity: "error", message, ...(ref ? { ref } : {}) });
  const seen = new Set<string>();
  for (const m of modes) {
    if (seen.has(m.id)) err("DUP_ID", `ハードウェア故障モードの ID が重複しています: ${m.id}`, m.id);
    seen.add(m.id);
    if (!Number.isFinite(m.fit) || m.fit < 0) err("HW_RANGE", "故障率(FIT)は 0 以上の数", m.id);
    for (const [k, v] of [["safeFraction", m.safeFraction], ["dcSpfRf", m.dcSpfRf], ["dcLatent", m.dcLatent]] as const)
      if (v !== undefined && !(v >= 0 && v <= 1)) err("HW_RANGE", `${k} は 0〜1`, m.id);
    if (m.elementId !== undefined && knownElements && !knownElements.has(m.elementId)) err("UNKNOWN_ELEMENT", `構造要素が存在しません: ${m.elementId}`, m.id);
  }
  if (issues.length > 0 || modes.length === 0) return issues;
  const top = goalAsils.reduce<Asil>((a, b) => (asilRank(b) > asilRank(a) ? b : a), "QM");
  const target = HW_TARGETS[top];
  if (!target) return issues;
  const r = computeHwMetrics(modes);
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  if (r.spfm !== undefined && r.spfm < target.spfm) err("HW_SPFM_BELOW_TARGET", `SPFM ${pct(r.spfm)} が、ASIL ${top} の目標値 ${pct(target.spfm)} を下回っています`);
  if (r.lfm !== undefined && r.lfm < target.lfm) err("HW_LFM_BELOW_TARGET", `LFM ${pct(r.lfm)} が、ASIL ${top} の目標値 ${pct(target.lfm)} を下回っています`);
  return issues;
}
