import type { Issue } from "./issues.js";
import type { ElementId } from "./net-types.js";

export const ASILS = ["QM", "A", "B", "C", "D"] as const;
export type Asil = (typeof ASILS)[number];

export function asilRank(a: Asil): number {
  return ASILS.indexOf(a);
}

/** ISO 26262-9 の ASIL デコンポジション表(順不同のペア)。 */
const DECOMPOSITIONS: Record<Exclude<Asil, "QM">, readonly (readonly [Asil, Asil])[]> = {
  D: [["D", "QM"], ["C", "A"], ["B", "B"]],
  C: [["C", "QM"], ["B", "A"]],
  B: [["B", "QM"], ["A", "A"]],
  A: [["A", "QM"]],
};

export function isValidDecomposition(parent: Asil, a: Asil, b: Asil): boolean {
  if (parent === "QM") return false;
  return DECOMPOSITIONS[parent].some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a),
  );
}

/** 分解後の表記。例: B(D) */
export function formatDecomposedAsil(asil: Asil, origin: Asil): string {
  return origin === asil ? asil : `${asil}(${origin})`;
}

export type RequirementLevel = "safety-goal" | "fsr" | "tsr" | "hw" | "sw";

export interface SafetyRequirement {
  id: string;
  text: string;
  level: RequirementLevel;
  asil: Asil;
  /** 分解済みの場合、分解前の元 ASIL(表記 B(D) の括弧内) */
  originAsil?: Asil;
  parentId?: string;
  allocatedTo?: ElementId;
  /** 紐づく安全目標(HARA の SafetyGoal.id)。親の要求をたどって決まる場合は省略できる */
  safetyGoalId?: string;
  /** この安全要求が詳細化する SysML の requirement(完全修飾名)。トレースと影響分析でモデルの要求とつなぐ */
  refines?: string;
}

export interface Decomposition {
  id: string;
  parentRequirementId: string;
  childRequirementIds: [string, string];
  /** 独立性(依存故障解析・FFI)の根拠となる文書/モデル要素への参照 */
  independenceEvidence?: string;
}

/**
 * ASIL デコンポジションの規則チェック。
 * 判断が要る箇所(再分解など)は、専門家レビュー用に警告として残す。
 */
export function validateDecompositions(
  reqs: SafetyRequirement[],
  decomps: Decomposition[],
): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(reqs.map((r) => [r.id, r]));
  for (const d of decomps) {
    const err = (code: string, message: string) =>
      issues.push({ code, severity: "error", message, ref: d.id });
    const warn = (code: string, message: string) =>
      issues.push({ code, severity: "warning", message, ref: d.id });

    const parent = byId.get(d.parentRequirementId);
    const [c1, c2] = d.childRequirementIds.map((id) => byId.get(id));
    if (!parent || !c1 || !c2) {
      err("UNKNOWN_REF", "分解元または分解先の要求が存在しません");
      continue;
    }
    if (c1.id === c2.id) {
      err("DECOMP_SAME_CHILD", "分解先に同じ要求が指定されています");
      continue;
    }
    if (!isValidDecomposition(parent.asil, c1.asil, c2.asil))
      err(
        "DECOMP_INVALID",
        `ASIL ${parent.asil} は ${c1.asil} + ${c2.asil} に分解できません`,
      );
    const origin = parent.originAsil ?? parent.asil;
    for (const c of [c1, c2])
      if ((c.originAsil ?? c.asil) !== origin)
        err(
          "DECOMP_ORIGIN",
          `${c.id} の元 ASIL 表記が ${origin} と一致しません(例: ${formatDecomposedAsil(c.asil, origin)})`,
        );
    if (parent.originAsil)
      warn("REDECOMPOSITION", "分解済みの要求の再分解です。ISO 26262 専門家の確認が必要です");
    if (c1.allocatedTo && c1.allocatedTo === c2.allocatedTo)
      err("DECOMP_NOT_INDEPENDENT", "分解先が同一の要素に割り当てられており、独立性が成立しません");
    const evidence = d.independenceEvidence?.trim() ?? "";
    if (evidence === "") err("DECOMP_NO_EVIDENCE", "独立性の根拠(依存故障解析/FFI)が未登録です。ISO 26262-9 の分解には、独立性の根拠が必要です");
    else if (!isSubstantial(evidence))
      warn("DECOMP_EVIDENCE_WEAK", `独立性の根拠が形だけに見えます(${EVIDENCE_MIN} 文字以上で、文書番号や解析名などの具体的な内容を記入してください)`);
    if (c1.parentId !== parent.id || c2.parentId !== parent.id)
      err("DECOMP_CHILD_NOT_DERIVED", "分解先の要求が、分解元の要求から導出(parentId)されていません。分解先は分解元の下に置いてください");
  }
  checkDecompositionReuse(decomps, issues);
  checkDecompositionCycles(decomps, issues);
  return issues;
}

const EVIDENCE_MIN = 8;
/**
 * 形だけの根拠を除く簡易な検査(内容の妥当性は人が判断する)。
 * 8 文字以上、6 種類以上の文字、数字だけでない、同じ語の繰り返しでない、プレースホルダ(TODO/TBD/XXX/WIP/draft/none/see…/ダミー/仮/後述/同上など)を含まない、数字か区切りを含む(「abcdabcd」「TODO TODO」「12345678」「asdfghjk」「DFA-XXX-000」「DFA TBD 1234」を除く)。
 */
export const isSubstantial = (t: string) =>
  t.length >= EVIDENCE_MIN &&
  new Set(t).size >= 6 &&
  !/^\d+$/.test(t) &&
  !/^(.{2,}?)\s*\1+$/.test(t) &&
  // 英単語は語境界で判定する（sampled・depending・todos のような語の一部は弾かない）。日本語は部分一致
  !/\b(?:todo|tbd|tbc|n\/a|xxx+|dummy|sample|lorem|ipsum|pending|placeholder|wip|draft|later|none|see|ditto|tba|same\s+as|as\s+above|in[\s-]progress|to\s+follow|to\s+be\s+(?:defined|determined|decided)|not\s+(?:yet|done|applicable|available))\b/i.test(t) &&
  !/(?:^|\s)n\.a\.?(?:\s|$)/i.test(t) &&
  !/(?:未実施|未作成|未着手|検討予定|未定|未確認|確認中|検討中|あとで|ダミー|仮(?!想)|なし|後述|別紙|同上|作成中|準備中|記載予定|作業中|対応中)/.test(t) &&
  /[\d\-_/:()（）\s]/.test(t); // 文書番号・区切りなど、参照らしい形(連打した文字列を除く)

/** 分解の自己参照と循環(A → B + QM、B → A + … など)。 */
function checkDecompositionCycles(decomps: Decomposition[], issues: Issue[]) {
  const next = new Map<string, string[]>();
  for (const d of decomps) next.set(d.parentRequirementId, [...(next.get(d.parentRequirementId) ?? []), ...d.childRequirementIds]);
  const reported = new Set<string>();
  for (const d of decomps) {
    if (d.childRequirementIds.includes(d.parentRequirementId)) {
      issues.push({ code: "DECOMP_CYCLE", severity: "error", message: "要求が自分自身に分解されています", ref: d.id });
      continue;
    }
    // d の分解先から、分解元に戻れるか
    const seen = new Set<string>();
    const stack = [...d.childRequirementIds];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === d.parentRequirementId && !reported.has(d.id)) {
        reported.add(d.id);
        issues.push({ code: "DECOMP_CYCLE", severity: "error", message: "分解が循環しています(分解先をたどると分解元に戻ります)", ref: d.id });
        break;
      }
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...(next.get(cur) ?? []));
    }
  }
}

/** 同じ要求を二度分解する、分解先を別の分解でも使う、といった重複の検出。 */
function checkDecompositionReuse(decomps: Decomposition[], issues: Issue[]) {
  const parents = new Map<string, string>();
  const children = new Map<string, string>();
  for (const d of decomps) {
    const prev = parents.get(d.parentRequirementId);
    if (prev) issues.push({ code: "DECOMP_DUPLICATE_PARENT", severity: "error", message: `${d.parentRequirementId} は ${prev} でもすでに分解されています`, ref: d.id });
    else parents.set(d.parentRequirementId, d.id);
    for (const c of d.childRequirementIds) {
      const used = children.get(c);
      if (used && used !== d.id) issues.push({ code: "DECOMP_CHILD_REUSED", severity: "error", message: `${c} は ${used} の分解先としても使われています`, ref: d.id });
      else children.set(c, d.id);
    }
  }
}

/** 要求の親(parentId)をたどって循環する(自己親を含む)ものを報告する。 */
function checkParentCycles(reqs: SafetyRequirement[], byId: Map<string, SafetyRequirement>, issues: Issue[]) {
  for (const r of reqs) {
    const seen = new Set<string>([r.id]);
    for (let cur = r.parentId !== undefined ? byId.get(r.parentId) : undefined; cur; cur = cur.parentId !== undefined ? byId.get(cur.parentId) : undefined) {
      if (seen.has(cur.id)) {
        issues.push({ code: "REQ_PARENT_CYCLE", severity: "error", message: `要求の親子が循環しています(${r.id} から ${cur.id} に戻ります)`, ref: r.id });
        break;
      }
      seen.add(cur.id);
    }
  }
}

/**
 * 安全要求の ASIL の継承規則(ISO 26262-3/-9)。
 * - 親(parentId)の要求より低い ASIL への引き下げは、デコンポジションでのみ許される(元 ASIL = originAsil ?? asil で比較)。
 * - 安全目標に紐づく要求(safetyGoalId、または親をたどって決まる)は、目標の ASIL 以上であること。
 * - 元 ASIL の表記(originAsil)を持つ要求は、デコンポジションの分解先でなければならない。
 * - ASIL の付いた安全目標には、少なくとも 1 つの要求が必要。
 */
export function validateAsilInheritance(
  reqs: SafetyRequirement[],
  decomps: Decomposition[],
  goals: { id: string; asil: Asil }[],
): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const eff = (r: SafetyRequirement) => asilRank(r.originAsil ?? r.asil);
  const decompChildren = new Set(decomps.flatMap((d) => d.childRequirementIds));
  const goalOf = (r: SafetyRequirement): string | undefined => {
    const seen = new Set<string>();
    for (let cur: SafetyRequirement | undefined = r; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (cur.safetyGoalId !== undefined) return cur.safetyGoalId;
      seen.add(cur.id);
    }
    return undefined;
  };
  /** 分解先、またはその子孫(parentId をたどって分解先に着く)であること */
  const inDecomposedBranch = (r: SafetyRequirement): boolean => {
    const seen = new Set<string>();
    for (let cur: SafetyRequirement | undefined = r; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (decompChildren.has(cur.id)) return true;
      seen.add(cur.id);
    }
    return false;
  };
  checkParentCycles(reqs, byId, issues);
  const covered = new Set<string>();
  for (const r of reqs) {
    const parent = r.parentId !== undefined ? byId.get(r.parentId) : undefined;
    const isChild = decompChildren.has(r.id);
    if (r.originAsil !== undefined && !isChild && !(parent && inDecomposedBranch(parent) && parent.originAsil === r.originAsil))
      issues.push({ code: "DECOMP_ORPHAN", severity: "error", message: `${r.id} は元 ASIL(${r.originAsil})の表記を持ちますが、デコンポジションの分解先でも、その子孫(親と同じ元 ASIL)でもありません`, ref: r.id });
    // 分解先そのものは、元 ASIL で比較する(分解表の妥当性は validateDecompositions が見る)。
    // その子孫は分解されない限り下がらないので、実際の ASIL で比較する(元 ASIL の表記を盾にした引き下げを許さない)。
    if (parent && isChild && eff(r) < eff(parent))
      issues.push({ code: "REQ_ASIL_DOWNGRADE", severity: "error", message: `${r.id}(元 ASIL ${r.originAsil ?? r.asil})が上位の ${parent.id}(ASIL ${parent.originAsil ?? parent.asil})より低く、デコンポジションによらない引き下げです`, ref: r.id });
    if (parent && !isChild && asilRank(r.asil) < asilRank(parent.asil))
      issues.push({ code: "REQ_ASIL_DOWNGRADE", severity: "error", message: `${r.id}(ASIL ${r.asil})が上位の ${parent.id}(ASIL ${parent.asil})より低く、デコンポジションによらない引き下げです。下げるにはデコンポジションが必要です`, ref: r.id });
    const gid = goalOf(r);
    if (gid === undefined) continue;
    const g = goalById.get(gid);
    if (!g) {
      issues.push({ code: "UNKNOWN_REF", severity: "error", message: `安全目標が存在しません: ${gid}`, ref: r.id });
      continue;
    }
    covered.add(gid);
    if (eff(r) < asilRank(g.asil))
      issues.push({ code: "REQ_BELOW_GOAL_ASIL", severity: "error", message: `${r.id}(ASIL ${r.originAsil ?? r.asil})が安全目標 ${g.id}(ASIL ${g.asil})を下回っています`, ref: r.id });
    if (r.level === "safety-goal" && r.asil !== g.asil)
      issues.push({ code: "SG_REQ_ASIL_MISMATCH", severity: "error", message: `安全目標レベルの要求 ${r.id} の ASIL が目標 ${g.id} と一致しません`, ref: r.id });
  }
  for (const g of goals)
    if (g.asil !== "QM" && !covered.has(g.id))
      issues.push({ code: "GOAL_NO_FSR", severity: "error", message: `ASIL ${g.asil} の安全目標 ${g.id} から導出された安全要求がありません`, ref: g.id });
  return issues;
}

/** 意図機能。各階層で識別できるよう、担当要素に紐づける。 */
export interface IntendedFunction {
  id: string;
  name: string;
  elementId: ElementId;
  asil: Asil;
  /** 分解済みの場合、分解前の元 ASIL(表記 B(D) の括弧内) */
  originAsil?: Asil;
  /** この意図機能の要求グループに属する追加の安全要求(SafetyRequirement.id) */
  requirementIds?: string[];
}

export interface SafetyMechanism {
  id: string;
  name: string;
  elementId: ElementId;
  /** 故障許容時間間隔 [ms] */
  ftti?: number;
  diagnosticCoverage?: "low" | "medium" | "high";
  safeState?: string;
  /** FMEA-MSR 用: この安全機構が検出/対処する故障モード */
  coversFailureIds?: string[];
  /** 安全機構の要求グループに属する安全要求(SafetyRequirement.id) */
  requirementIds?: string[];
  asil?: Asil;
  originAsil?: Asil;
}

export interface FunctionMechanismPair {
  id: string;
  intendedFunctionId: string;
  mechanismId: string;
  /** 両者の独立性の要求(例: 「同時侵害となる従属故障なきこと」)。SCDL の制約条件になる */
  independence?: string;
}

export function validatePairing(
  functions: IntendedFunction[],
  mechanisms: SafetyMechanism[],
  pairs: FunctionMechanismPair[],
): Issue[] {
  const issues: Issue[] = [];
  const fnById = new Map(functions.map((f) => [f.id, f]));
  const mechById = new Map(mechanisms.map((m) => [m.id, m]));
  for (const p of pairs) {
    const f = fnById.get(p.intendedFunctionId);
    const m = mechById.get(p.mechanismId);
    if (!f || !m) {
      issues.push({ code: "UNKNOWN_REF", severity: "error", message: "ペアが存在しない機能/安全機構を参照しています", ref: p.id });
      continue;
    }
    if (f.elementId === m.elementId)
      issues.push({
        code: "PAIR_SAME_ELEMENT",
        severity: "warning",
        message: "意図機能と安全機構が同一要素にあります。干渉の無いこと(FFI)の根拠が必要です",
        ref: p.id,
      });
  }
  const paired = new Set(pairs.map((p) => p.intendedFunctionId));
  for (const f of functions)
    if (asilRank(f.asil) >= asilRank("A") && !paired.has(f.id))
      issues.push({
        code: "NO_SAFETY_MECHANISM",
        severity: "warning",
        message: `ASIL ${f.asil} の意図機能に対応する安全機構がありません`,
        ref: f.id,
      });
  const usedMech = new Set(pairs.map((p) => p.mechanismId));
  for (const m of mechanisms) {
    if (!usedMech.has(m.id))
      issues.push({ code: "MECHANISM_UNPAIRED", severity: "warning", message: "意図機能とペアになっていない安全機構です", ref: m.id });
    if (m.ftti === undefined)
      issues.push({ code: "MISSING_FTTI", severity: "warning", message: "FTTI が未設定です", ref: m.id });
  }
  return issues;
}

/**
 * 意図機能・安全機構の ASIL の検査(安全要求と同じ抜け道を、別の成果物で作らせない)。
 * - 紐づく要求(requirementIds。意図機能は自身の ID の要求も)の ASIL より低くしない。
 * - 元 ASIL の表記(originAsil)は、同じ元 ASIL を持つ要求に紐づくときだけ使える。
 * - ASIL 付きの安全目標があるのに、紐づく要求の無い QM の意図機能は、確認を促す。
 */
export function validateElementAsil(
  functions: IntendedFunction[],
  mechanisms: SafetyMechanism[],
  reqs: SafetyRequirement[],
  opts: { goals?: { id: string; asil: Asil }[] } = {},
): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const check = (kind: string, x: { id: string; asil?: Asil | undefined; originAsil?: Asil | undefined; requirementIds?: string[] | undefined }) => {
    const linked = [x.id, ...(x.requirementIds ?? [])].map((i) => byId.get(i)).filter((r): r is SafetyRequirement => r !== undefined);
    const own = x.asil ?? "QM";
    for (const r of linked)
      if (asilRank(own) < asilRank(r.asil))
        issues.push({ code: "ELEMENT_ASIL_BELOW_REQ", severity: "error", message: `${kind} ${x.id} の ASIL(${own})が、紐づく要求 ${r.id}(ASIL ${r.asil})より低くなっています`, ref: x.id });
    if (x.originAsil !== undefined && !linked.some((r) => (r.originAsil ?? r.asil) === x.originAsil && r.originAsil !== undefined))
      issues.push({ code: "DECOMP_ORPHAN", severity: "error", message: `${kind} ${x.id} は元 ASIL(${x.originAsil})の表記を持ちますが、同じ元 ASIL を持つ要求(分解先)に紐づいていません`, ref: x.id });
    const asilGoals = new Map((opts.goals ?? []).filter((g) => g.asil !== "QM").map((g) => [g.id, g]));
    // 紐づく要求が ASIL の付いた安全目標までたどれるか(QM のダミー要求だけに紐づけても、ASIL を外したことにならない)
    const tracesToGoal = linked.some((r) => asilGoals.has(goalIdOfRequirement(reqs, r.id) ?? ""));
    for (const r of linked) {
      const g = asilGoals.get(goalIdOfRequirement(reqs, r.id) ?? "");
      if (g && asilRank(x.originAsil ?? own) < asilRank(g.asil))
        issues.push({ code: "ELEMENT_BELOW_GOAL_ASIL", severity: "error", message: `${kind} ${x.id} の ASIL(${x.originAsil ? `${own}(${x.originAsil})` : own})が、紐づく安全目標 ${g.id}(ASIL ${g.asil})を下回っています`, ref: x.id });
    }
    if (own === "QM" && x.originAsil === undefined && !tracesToGoal && (linked.length === 0 || asilGoals.size > 0))
      // ASIL の付いた安全目標があるのに、そこへつながらない QM の意図機能は、ASIL を黙って外している疑いがある(エラー)。安全機構は警告
      issues.push({ code: "ELEMENT_QM_UNLINKED", severity: asilGoals.size > 0 && kind === "意図機能" ? "error" : "warning", message: `${kind} ${x.id} は QM で、紐づく要求もありません。ASIL の付いた安全目標・要求との関係を確認してください`, ref: x.id });
  };
  for (const f of functions) check("意図機能", f);
  for (const m of mechanisms) check("安全機構", m);
  return issues;
}

/** 要求が(自身または親をたどって)紐づく安全目標の ID。 */
export function goalIdOfRequirement(reqs: SafetyRequirement[], requirementId: string): string | undefined {
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (let cur = byId.get(requirementId); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    if (cur.safetyGoalId !== undefined) return cur.safetyGoalId;
    seen.add(cur.id);
  }
  return undefined;
}
