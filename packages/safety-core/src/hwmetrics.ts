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
  /** 故障モードの分類・安全な故障の割合・DC の根拠(出典、FMEDA の参照など)。DC や安全な故障を主張するときは必須 */
  rationale?: string;
  /** 影響する安全目標(省略時はすべての安全目標) */
  goalIds?: string[];
  /** DC を担う安全機構(診断カバレッジの区分と照合する) */
  mechanismId?: string;
}

/** 診断カバレッジの区分ごとの上限(ISO 26262-5 付録 D の低 60% / 中 90% / 高 99%)。 */
export const DC_CAP: Record<"low" | "medium" | "high", number> = { low: 0.6, medium: 0.9, high: 0.99 };

export interface HwContext {
  knownElements?: Set<string>;
  goals?: { id: string; asil: Asil }[];
  mechanisms?: { id: string; diagnosticCoverage?: "low" | "medium" | "high"; asil?: Asil; paired?: boolean }[];
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

const substantial = (t: string | undefined) => (t ?? "").trim().length >= 8;

type Emit = (severity: "error" | "warning", code: string, message: string, ref?: string) => void;

/** 1 つの故障モードの入力検査(範囲・参照・DC の主張と機構・根拠)。 */
function checkMode(m: HardwareFailureMode, c: HwContext, emit: Emit) {
  if (!Number.isFinite(m.fit) || m.fit < 0) emit("error", "HW_RANGE", "故障率(FIT)は 0 以上の数", m.id);
  for (const [k, v] of [["safeFraction", m.safeFraction], ["dcSpfRf", m.dcSpfRf], ["dcLatent", m.dcLatent]] as const)
    if (v !== undefined && !(v >= 0 && v <= 1)) emit("error", "HW_RANGE", `${k} は 0〜1`, m.id);
  if (m.elementId !== undefined && c.knownElements && !c.knownElements.has(m.elementId)) emit("error", "UNKNOWN_ELEMENT", `構造要素が存在しません: ${m.elementId}`, m.id);
  const goalIds = new Set((c.goals ?? []).map((g) => g.id));
  for (const g of m.goalIds ?? []) if (c.goals && !goalIds.has(g)) emit("error", "UNKNOWN_GOAL", `安全目標が存在しません: ${g}`, m.id);
  checkDc(m, c, emit);
}

/** 診断カバレッジの主張: 担う安全機構(区分の上限と照合)と根拠があるか。 */
function checkDc(m: HardwareFailureMode, c: HwContext, emit: Emit) {
  const mech = m.mechanismId !== undefined ? (c.mechanisms ?? []).find((x) => x.id === m.mechanismId) : undefined;
  if (m.mechanismId !== undefined && c.mechanisms && !mech) emit("error", "UNKNOWN_MECHANISM", `安全機構が存在しません: ${m.mechanismId}`, m.id);
  const dc = (m.type === "single" ? m.dcSpfRf : m.dcLatent) ?? 0;
  if (dc > 0 && m.mechanismId === undefined) emit("warning", "HW_DC_NO_MECHANISM", `診断カバレッジ ${dc} を主張していますが、担う安全機構(mechanismId)が未指定です`, m.id);
  if (dc > 0 && mech) checkDcMechanism(m, dc, mech, emit);
  if ((dc > 0 || (m.safeFraction ?? 0) > 0) && !substantial(m.rationale))
    emit("warning", "HW_NO_RATIONALE", "診断カバレッジまたは安全な故障の割合を主張していますが、根拠(rationale: FMEDA の出典など)がありません", m.id);
}

/** DC を担う安全機構: 区分の上限・QM でないこと・ペアになっていること。 */
function checkDcMechanism(m: HardwareFailureMode, dc: number, mech: NonNullable<HwContext["mechanisms"]>[number], emit: Emit) {
  const cap = mech.diagnosticCoverage ? DC_CAP[mech.diagnosticCoverage] : 0;
  if (dc > cap) emit("error", "HW_DC_EXCEEDS_MECHANISM", `診断カバレッジ ${dc} が、安全機構 ${mech.id} の区分(${mech.diagnosticCoverage ?? "未設定"}: 上限 ${cap})を超えています`, m.id);
  if ((mech.asil ?? "QM") === "QM") emit("error", "HW_DC_MECHANISM_QM", `診断カバレッジを担う安全機構 ${mech.id} が QM です。DC を主張するには、安全目標に応じた ASIL が必要です`, m.id);
  if (mech.paired === false) emit("warning", "HW_DC_MECHANISM_UNPAIRED", `診断カバレッジを担う安全機構 ${mech.id} が、意図機能とペアになっていません`, m.id);
}

/** 安全目標ごとに、その目標に関係する故障モードで SPFM/LFM を目標値と比べる(goalIds 省略 = すべての目標)。 */
function checkTargets(modes: HardwareFailureMode[], goalAsils: Asil[], c: HwContext, emit: Emit) {
  const top = goalAsils.reduce<Asil>((a, b) => (asilRank(b) > asilRank(a) ? b : a), "QM");
  const targets = c.goals?.length ? c.goals : [{ id: "", asil: top }];
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  for (const g of targets) {
    const target = HW_TARGETS[g.asil];
    if (!target) continue;
    const r = computeHwMetrics(modes.filter((m) => !m.goalIds || m.goalIds.length === 0 || m.goalIds.includes(g.id)));
    const where = g.id ? `安全目標 ${g.id}(ASIL ${g.asil})` : `ASIL ${g.asil}`;
    if (r.spfm === undefined)
      emit("warning", "HW_METRICS_MISSING", `${g.id ? `安全目標 ${g.id}` : "この安全目標"}(ASIL ${g.asil})に関係する故障率が 0 または未入力のため、SPFM/LFM を評価できていません`, g.id || undefined);
    if (r.spfm !== undefined && r.spfm < target.spfm) emit("error", "HW_SPFM_BELOW_TARGET", `SPFM ${pct(r.spfm)} が、${where} の目標値 ${pct(target.spfm)} を下回っています`, g.id || undefined);
    if (r.lfm !== undefined && r.lfm < target.lfm) emit("error", "HW_LFM_BELOW_TARGET", `LFM ${pct(r.lfm)} が、${where} の目標値 ${pct(target.lfm)} を下回っています`, g.id || undefined);
  }
}

/** 入力の検証と、安全目標ごとの目標値との比較。 */
export function validateHwModes(modes: HardwareFailureMode[], goalAsils: Asil[], ctx: HwContext | Set<string> = {}): Issue[] {
  const c: HwContext = ctx instanceof Set ? { knownElements: ctx } : ctx;
  const issues: Issue[] = [];
  const emit: Emit = (severity, code, message, ref) => issues.push({ code, severity, message, ...(ref ? { ref } : {}) });
  const seen = new Set<string>();
  for (const m of modes) {
    if (seen.has(m.id)) emit("error", "DUP_ID", `ハードウェア故障モードの ID が重複しています: ${m.id}`, m.id);
    seen.add(m.id);
    checkMode(m, c, emit);
  }
  if (issues.some((i) => i.severity === "error") || modes.length === 0) return issues;
  checkTargets(modes, goalAsils, c, emit);
  return issues;
}
