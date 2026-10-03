import { asilRank, type Asil } from "./asil.js";
import type { Issue } from "./issues.js";

/** ISO 26262-3 のハザード分析およびリスク評価(HARA)の評価値。 */
export type Severity = 0 | 1 | 2 | 3;
export type Exposure = 0 | 1 | 2 | 3 | 4;
export type Controllability = 0 | 1 | 2 | 3;

/**
 * ASIL 判定(ISO 26262-3 Table 4)。S・E・C のいずれかが 0 なら QM。
 * それ以外は S+E+C の合計で決まる: 10=D, 9=C, 8=B, 7=A, 6 以下=QM(表と一致することをテストで全 36 通り確認)。
 */
export function determineAsil(s: Severity, e: Exposure, c: Controllability): Asil {
  if (s === 0 || e === 0 || c === 0) return "QM";
  const sum = s + e + c;
  if (sum >= 10) return "D";
  if (sum === 9) return "C";
  if (sum === 8) return "B";
  if (sum === 7) return "A";
  return "QM";
}

export interface HazardousEvent {
  id: string;
  /** ハザード(例: 意図しない過大トルク) */
  hazard: string;
  /** 運転状況(例: 市街地走行中) */
  situation: string;
  severity: Severity;
  exposure: Exposure;
  controllability: Controllability;
  /** 評価の根拠(S/E/C それぞれの理由) */
  rationale?: string;
  /** この事象から導出した安全目標 */
  safetyGoalId?: string;
}

export interface SafetyGoal {
  id: string;
  text: string;
  /** 紐づく事象の最大 ASIL と一致していること */
  asil: Asil;
  /** 故障許容時間間隔 [ms] */
  ftti?: number;
  safeState?: string;
}

export interface HaraData {
  events: HazardousEvent[];
  goals: SafetyGoal[];
}

/** 事象の ASIL を、評価値から導出して返す(保存値は持たない)。 */
export function eventAsil(e: HazardousEvent): Asil {
  return determineAsil(e.severity, e.exposure, e.controllability);
}

/** 安全目標ごとの、紐づく事象の最大 ASIL。事象が無ければ undefined。 */
export function goalAsilFromEvents(hara: HaraData, goalId: string): Asil | undefined {
  const asils = hara.events.filter((e) => e.safetyGoalId === goalId).map(eventAsil);
  if (asils.length === 0) return undefined;
  return asils.reduce((a, b) => (asilRank(b) > asilRank(a) ? b : a));
}

const inRange = (v: number, max: number) => Number.isInteger(v) && v >= 0 && v <= max;

/** HARA の整合性チェック。 */
export function validateHara(hara: HaraData): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, message: string, ref?: string) =>
    issues.push({ code, severity: "error", message, ...(ref ? { ref } : {}) });
  const warn = (code: string, message: string, ref?: string) =>
    issues.push({ code, severity: "warning", message, ...(ref ? { ref } : {}) });

  const dup = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) err("DUP_ID", `${label} の ID が重複: ${id}`, id);
      seen.add(id);
    }
  };
  dup("ハザード事象", hara.events.map((e) => e.id));
  dup("安全目標", hara.goals.map((g) => g.id));

  const goals = new Map(hara.goals.map((g) => [g.id, g]));
  for (const e of hara.events) {
    if (!inRange(e.severity, 3) || !inRange(e.exposure, 4) || !inRange(e.controllability, 3))
      err("HARA_RANGE", "S は 0〜3、E は 0〜4、C は 0〜3 の整数", e.id);
    if (e.safetyGoalId !== undefined && !goals.has(e.safetyGoalId))
      err("UNKNOWN_REF", `安全目標が存在しません: ${e.safetyGoalId}`, e.id);
    if (eventAsil(e) !== "QM" && e.safetyGoalId === undefined)
      warn("EVENT_NO_GOAL", `ASIL ${eventAsil(e)} の事象に安全目標がありません`, e.id);
    if (!e.rationale) warn("EVENT_NO_RATIONALE", "S/E/C の評価根拠が未記入です", e.id);
  }
  for (const g of hara.goals) {
    const derived = goalAsilFromEvents(hara, g.id);
    if (derived === undefined) warn("GOAL_NO_EVENT", "どのハザード事象にも紐づいていない安全目標です", g.id);
    else if (derived !== g.asil)
      err("GOAL_ASIL_MISMATCH", `安全目標の ASIL(${g.asil})が紐づく事象の最大 ASIL(${derived})と一致しません`, g.id);
    if (g.asil !== "QM" && g.ftti === undefined) warn("GOAL_NO_FTTI", "FTTI が未設定です", g.id);
    if (g.asil !== "QM" && !g.safeState) warn("GOAL_NO_SAFE_STATE", "安全状態が未設定です", g.id);
  }
  return issues;
}
