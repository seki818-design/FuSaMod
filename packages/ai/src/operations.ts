import { z } from "zod";
import { SafetyDataSchema, parseSafetyData, type SafetyData } from "@fusamod/analysis";
import { goalIdOfRequirement } from "@fusamod/safety-core";

const S = SafetyDataSchema.shape;
const id = z.string().min(1).max(600);

/**
 * 提案が持てる「操作」。AI(または人)はこの操作の並びとして変更を提案し、承認後にだけ適用される(ADR-0005)。
 * 追加(add*)と、評価値の設定(set*)のみ。削除・上書きは提案できない。
 */
export const OperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("addFailure"), failure: S.failures.element }).strict(),
  z.object({ op: z.literal("addLink"), link: S.links.element }).strict(),
  z
    .object({
      op: z.literal("setLinkRatings"),
      linkId: id,
      occurrence: z.number().int().min(1).max(10).optional(),
      detection: z.number().int().min(1).max(10).optional(),
      preventionControl: z.string().max(5000).optional(),
      detectionControl: z.string().max(5000).optional(),
    })
    .strict(),
  z.object({ op: z.literal("setSeverity"), failureId: id, severity: z.number().int().min(1).max(10) }).strict(),
  z.object({ op: z.literal("addHazardEvent"), event: S.hara.shape.events.element }).strict(),
  z.object({ op: z.literal("addSafetyGoal"), goal: S.hara.shape.goals.element }).strict(),
  z.object({ op: z.literal("addIntendedFunction"), intendedFunction: S.intendedFunctions.element }).strict(),
  z.object({ op: z.literal("addMechanism"), mechanism: S.mechanisms.element }).strict(),
  z.object({ op: z.literal("addPair"), pair: S.pairs.element }).strict(),
  z.object({ op: z.literal("addSafetyRequirement"), requirement: S.safetyRequirements.element }).strict(),
  z.object({ op: z.literal("addDecomposition"), decomposition: S.decompositions.element }).strict(),
  z.object({ op: z.literal("addSignalFlow"), flow: S.signalFlows.element }).strict(),
]);
export type Operation = z.infer<typeof OperationSchema>;

export interface ApplyResult {
  ok: boolean;
  /** 適用後のデータ(ok のときのみ有効。入力は変更しない) */
  data: SafetyData;
  errors: string[];
}

/**
 * 操作をデータに適用する。1 件でもエラーなら全体を適用しない(原子的)。
 * 適用後のデータがスキーマに合わない場合もエラー。
 */
export function applyOperations(input: SafetyData, ops: Operation[]): ApplyResult {
  const data = structuredClone(input);
  const errors: string[] = [];
  const addUnique = <T extends { id: string }>(list: T[], item: T, label: string) => {
    if (list.some((x) => x.id === item.id)) errors.push(`${label} の ID が既に存在します: ${item.id}`);
    else list.push(item);
  };
  ops.forEach((op, i) => {
    const at = `操作 ${i + 1}(${op.op})`;
    const before = errors.length;
    switch (op.op) {
      case "addFailure": addUnique(data.failures, op.failure, "故障ノード"); break;
      case "addLink": addUnique(data.links, op.link, "故障リンク"); break;
      case "setLinkRatings": {
        const l = data.links.find((x) => x.id === op.linkId);
        if (!l) { errors.push(`故障リンクが存在しません: ${op.linkId}`); break; }
        if (op.occurrence !== undefined) l.occurrence = op.occurrence;
        if (op.detection !== undefined) l.detection = op.detection;
        if (op.preventionControl !== undefined) l.preventionControl = op.preventionControl;
        if (op.detectionControl !== undefined) l.detectionControl = op.detectionControl;
        break;
      }
      case "setSeverity": {
        const f = data.failures.find((x) => x.id === op.failureId);
        if (!f) { errors.push(`故障ノードが存在しません: ${op.failureId}`); break; }
        f.severity = op.severity;
        break;
      }
      case "addHazardEvent": addUnique(data.hara.events, op.event, "ハザード事象"); break;
      case "addSafetyGoal": addUnique(data.hara.goals, op.goal, "安全目標"); break;
      case "addIntendedFunction": addUnique(data.intendedFunctions, op.intendedFunction, "意図機能"); break;
      case "addMechanism": addUnique(data.mechanisms, op.mechanism, "安全機構"); break;
      case "addPair": addUnique(data.pairs, op.pair, "ペア"); break;
      case "addSafetyRequirement": addUnique(data.safetyRequirements, op.requirement, "安全要求"); break;
      case "addDecomposition": addUnique(data.decompositions, op.decomposition, "分解"); break;
      case "addSignalFlow": addUnique(data.signalFlows, op.flow, "信号フロー"); break;
    }
    if (errors.length > before) errors[errors.length - 1] = `${at}: ${errors[errors.length - 1]}`;
  });
  if (errors.length > 0) return { ok: false, data: input, errors };
  const parsed = parseSafetyData(data);
  if (!parsed.ok) return { ok: false, data: input, errors: parsed.errors.map((e) => `適用後のデータが不正: ${e}`) };
  return { ok: true, data: parsed.data, errors: [] };
}

export interface DataChange {
  id: string;
  field: string;
  from: string | number | undefined;
  to: string | number | undefined;
  /** リスクを下げうる変更(評価値の低下、管理策の削除、リスク情報の削除、ASIL を下げる分解/QM の追加 など) */
  lowersRisk: boolean;
}

const ASIL_RANK: Record<string, number> = { QM: 0, A: 1, B: 2, C: 3, D: 4 };

type Val = string | number | undefined;
interface Differ {
  out: DataChange[];
  push(id: string, field: string, from: Val, to: Val, lowersRisk: boolean): void;
  /** 数値: 値が下がる(lowers)、または未評価に「良い評価」(good 以下)が付くとリスク低下 */
  num(id: string, field: string, from: number | undefined, to: number | undefined, lowers: (a: number, b: number) => boolean, good?: number): void;
  text(id: string, field: string, from: string | undefined, to: string | undefined): void;
}

function differ(): Differ {
  const out: DataChange[] = [];
  const push: Differ["push"] = (id, field, from, to, lowersRisk) => {
    if (from !== to) out.push({ id, field, from, to, lowersRisk });
  };
  return {
    out,
    push,
    num(id, field, from, to, lowers, good) {
      const l = from !== undefined && to !== undefined ? lowers(from, to) : from === undefined && to !== undefined && good !== undefined && to <= good;
      push(id, field, from, to, l);
    },
    text(id, field, from, to) {
      // 記述の変更は、内容が変わったことを必ず記録する（同じ長さの書き換えも）。弱める（消す・半分未満にする）変更はリスク低下の主張。
      // 内容そのものは長いので差分には載せず、長さと内容の短い指紋で示す
      const a = (from ?? "").trim();
      const b = (to ?? "").trim();
      if (a === b) return;
      const shown = (t: string) => (t ? `(記述あり ${t.length} 文字 #${fingerprint(t)})` : undefined);
      out.push({ id, field, from: shown(a), to: shown(b), lowersRisk: a !== "" && b.length < a.length / 2 });
    },
  };
}
/** 内容の短い指紋（差分の表示用。同じ長さの書き換えを区別する） */
function fingerprint(t: string): string {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 5);
}
const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
const dec = (a: number, b: number) => b < a;
const inc = (a: number, b: number) => b > a;

/** FMEA の評価値(重大度・発生度・検出度)と、管理策の記述。 */
function fmeaChanges(d: Differ, before: SafetyData, after: SafetyData) {
  const oldF = byId(before.failures);
  for (const f of after.failures) {
    const o = oldF.get(f.id);
    if (o) d.num(f.id, "severity", o.severity, f.severity, dec, 5);
  }
  const oldL = byId(before.links);
  for (const l of after.links) {
    const o = oldL.get(l.id);
    if (!o) continue;
    d.num(l.id, "occurrence", o.occurrence, l.occurrence, dec, 3);
    d.num(l.id, "detection", o.detection, l.detection, dec, 3);
    d.text(l.id, "preventionControl", o.preventionControl, l.preventionControl);
    d.text(l.id, "detectionControl", o.detectionControl, l.detectionControl);
  }
}

/** HARA(S/E/C、安全目標の ASIL・FTTI)、フォールトツリーの確率、安全機構。 */
function haraChanges(d: Differ, before: SafetyData, after: SafetyData) {
  const oldE = byId(before.hara.events);
  for (const e of after.hara.events) {
    const o = oldE.get(e.id);
    if (!o) continue;
    d.num(e.id, "S", o.severity, e.severity, dec);
    d.num(e.id, "E", o.exposure, e.exposure, dec);
    d.num(e.id, "C", o.controllability, e.controllability, dec);
    d.text(e.id, "hazard", o.hazard, e.hazard);
    d.text(e.id, "situation", o.situation, e.situation);
    d.text(e.id, "rationale", o.rationale, e.rationale);
  }
  const oldG = byId(before.hara.goals);
  for (const g of after.hara.goals) {
    const o = oldG.get(g.id);
    if (!o) continue;
    d.push(g.id, "goalAsil", o.asil, g.asil, (ASIL_RANK[g.asil] ?? 0) < (ASIL_RANK[o.asil] ?? 0));
    d.num(g.id, "ftti", o.ftti, g.ftti, inc); // FTTI を延ばすと、安全機構への要求がゆるむ
    d.text(g.id, "text", o.text, g.text);
    d.text(g.id, "safeState", o.safeState, g.safeState);
  }
  const oldT = byId(before.faultTrees);
  for (const t of after.faultTrees) {
    const oldN = byId(oldT.get(t.id)?.nodes ?? []);
    for (const n of t.nodes) {
      const on = oldN.get(n.id);
      if (on) d.num(`${t.id}/${n.id}`, "probability", on.probability, n.probability, dec);
    }
  }
}

const DC_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

/** 安全機構・意図機能・安全要求(ASIL、診断カバレッジ、対象の故障、安全状態)。 */
function conceptChanges(d: Differ, before: SafetyData, after: SafetyData) {
  const asilDown = (a: string | undefined, b: string | undefined) => (ASIL_RANK[b ?? "QM"] ?? 0) < (ASIL_RANK[a ?? "QM"] ?? 0);
  const oldM = byId(before.mechanisms);
  for (const m of after.mechanisms) {
    const o = oldM.get(m.id);
    if (!o) continue;
    d.num(m.id, "ftti", o.ftti, m.ftti, inc);
    // 対象の故障が増える・診断カバレッジが上がるのは、「より守れている」という主張の変更(リスク低下の主張)。減るのは逆
    const was = (o.coversFailureIds ?? []).length;
    const now = (m.coversFailureIds ?? []).length;
    d.push(m.id, "coversFailureIds", was, now, now > was);
    d.push(m.id, "diagnosticCoverage", o.diagnosticCoverage, m.diagnosticCoverage, (DC_RANK[m.diagnosticCoverage ?? ""] ?? 0) > (DC_RANK[o.diagnosticCoverage ?? ""] ?? 0));
    d.text(m.id, "safeState", o.safeState, m.safeState);
    d.push(m.id, "asil", o.asil, m.asil, asilDown(o.asil, m.asil));
  }
  // 紐づく要求の付け替えで、要求される ASIL(たどれる安全目標の最大の ASIL)が下がるのは、ASIL を下げる迂回
  const goalAsil = (s: SafetyData, ids: string[] | undefined, own: string) => {
    const gs = new Map(s.hara.goals.map((g) => [g.id, g.asil]));
    return Math.max(0, ...[own, ...(ids ?? [])].map((i) => ASIL_RANK[gs.get(goalIdOfRequirement(s.safetyRequirements, i) ?? "") ?? "QM"] ?? 0));
  };
  const relink = (kind: string, x: { id: string; requirementIds?: string[] | undefined }, o: { requirementIds?: string[] | undefined }) => {
    const was = (o.requirementIds ?? []).join(",");
    const now = (x.requirementIds ?? []).join(",");
    d.push(x.id, `requirementIds(${kind})`, was || undefined, now || undefined, was !== now && goalAsil(after, x.requirementIds, x.id) < goalAsil(before, o.requirementIds, x.id));
  };
  for (const m of after.mechanisms) {
    const o = oldM.get(m.id);
    if (o) relink("安全機構", m, o);
  }
  const oldI = byId(before.intendedFunctions);
  for (const f of after.intendedFunctions) {
    const o = oldI.get(f.id);
    if (!o) continue;
    d.push(f.id, "asil", o.asil, f.asil, asilDown(o.asil, f.asil));
    relink("意図機能", f, o);
  }
  const oldR = byId(before.safetyRequirements);
  for (const r of after.safetyRequirements) {
    const o = oldR.get(r.id);
    if (!o) continue;
    d.push(r.id, "asil", o.asil, r.asil, asilDown(o.asil, r.asil));
    d.push(r.id, "originAsil", o.originAsil, r.originAsil, r.originAsil !== undefined && o.originAsil === undefined);
  }
}

/**
 * ハードウェアの故障モード。SPFM/LFM を良く見せうる変更をリスク低下として示す:
 * 故障率の低下、DC・安全な故障の割合の上昇(未設定 → 設定を含む)、高 DC のモードの追加や故障率の増加(分母が増えて指標が改善する)、
 * 対象の安全目標の削減、モードの削除。
 */
function hardwareChanges(d: Differ, before: SafetyData, after: SafetyData) {
  const old = byId(before.hardwareFailureModes ?? []);
  const up = (a: number | undefined, b: number | undefined) => (b ?? 0) > (a ?? 0);
  for (const m of after.hardwareFailureModes ?? []) {
    const o = old.get(m.id);
    const dcOf = (x: typeof m) => (x.type === "single" ? x.dcSpfRf : x.dcLatent) ?? 0;
    if (!o) {
      // 追加: DC や安全な故障の割合を主張するモデルは、指標を良く見せうる
      d.push(m.id, "追加(ハードウェア故障モード)", undefined, m.fit, dcOf(m) > 0 || (m.safeFraction ?? 0) > 0);
      continue;
    }
    d.push(m.id, "fit", o.fit, m.fit, m.fit < o.fit || (m.fit > o.fit && dcOf(m) >= 0.9));
    d.push(m.id, "safeFraction", o.safeFraction, m.safeFraction, up(o.safeFraction, m.safeFraction));
    d.push(m.id, "dcSpfRf", o.dcSpfRf, m.dcSpfRf, up(o.dcSpfRf, m.dcSpfRf));
    d.push(m.id, "dcLatent", o.dcLatent, m.dcLatent, up(o.dcLatent, m.dcLatent));
    d.push(m.id, "type", o.type, m.type, o.type === "single" && m.type === "multiple");
    d.push(m.id, "mechanismId", o.mechanismId, m.mechanismId, false);
    const goalsBefore = o.goalIds ?? [];
    const goalsAfter = m.goalIds ?? [];
    // 対象の安全目標を絞る(省略 = すべて)ほど、他の目標の指標から外れる
    const narrowed = (goalsBefore.length === 0 && goalsAfter.length > 0) || goalsBefore.some((g) => goalsAfter.length > 0 && !goalsAfter.includes(g));
    d.push(m.id, "goalIds", goalsBefore.join(",") || "(すべて)", goalsAfter.join(",") || "(すべて)", narrowed);
    d.text(m.id, "rationale", o.rationale, m.rationale);
  }
  const now = new Set((after.hardwareFailureModes ?? []).map((m) => m.id));
  for (const m of before.hardwareFailureModes ?? []) if (!now.has(m.id)) d.push(m.id, "削除(ハードウェア故障モード)", "あり", undefined, true);
}

/** ペアの独立性の記述と、分解の独立性の根拠(弱める・消すとリスク低下の主張になる)。 */
function independenceChanges(d: Differ, before: SafetyData, after: SafetyData) {
  const oldP = byId(before.pairs);
  for (const p of after.pairs) {
    const o = oldP.get(p.id);
    if (o) d.text(p.id, "independence", o.independence, p.independence);
  }
  const oldD = byId(before.decompositions);
  for (const x of after.decompositions) {
    const o = oldD.get(x.id);
    if (o) d.text(x.id, "independenceEvidence", o.independenceEvidence, x.independenceEvidence);
  }
}

function countH(rules: NonNullable<SafetyData["apTable"]> | undefined): number {
  let n = 0;
  for (const r of rules ?? []) if (r.ap === "H") n += (r.s[1] - r.s[0] + 1) * (r.o[1] - r.o[0] + 1) * (r.d[1] - r.d[0] + 1);
  return n;
}

/** FTA の構造(ゲートの種類・入力・基本事象の対応)と、AP 表。 */
function structuralRiskChanges(d: Differ, before: SafetyData, after: SafetyData) {
  const oldT = byId(before.faultTrees);
  for (const t of after.faultTrees) {
    const o = oldT.get(t.id);
    if (!o) continue;
    const oldN = byId(o.nodes);
    d.push(t.id, "top", o.top, t.top, true);
    for (const n of t.nodes) {
      const on = oldN.get(n.id);
      if (!on) continue;
      const path = `${t.id}/${n.id}`;
      d.push(path, "gate", on.gate, n.gate, on.gate === "or" && n.gate === "and"); // OR → AND は頂上事象の起きにくさを主張する
      const was = new Set(on.inputs ?? []);
      const now = new Set(n.inputs ?? []);
      const dropped = [...was].filter((x) => !now.has(x)).length;
      if (dropped > 0 || was.size !== now.size) d.push(path, "inputs", was.size, now.size, dropped > 0);
      d.push(path, "failureId", on.failureId, n.failureId, true);
    }
    const nowIds = new Set(t.nodes.map((n) => n.id));
    for (const n of o.nodes) if (!nowIds.has(n.id)) d.push(`${t.id}/${n.id}`, "削除(ノード)", "あり", undefined, true);
  }
  const hb = countH(before.apTable);
  const ha = countH(after.apTable);
  if (JSON.stringify(before.apTable ?? []) !== JSON.stringify(after.apTable ?? [])) d.push("apTable", "H の件数", hb, ha, ha < hb);
  d.push("apTable", "出典", before.apTableSource, after.apTableSource, false);
}

/** 追加(QM の意図機能・安全機構、ASIL を下げる分解)と、削除(リスクの情報が消える)。 */
function structureChanges(d: Differ, before: SafetyData, after: SafetyData) {
  const known = new Set([...before.intendedFunctions.map((f) => f.id), ...before.mechanisms.map((m) => m.id)]);
  for (const x of [...after.intendedFunctions, ...after.mechanisms])
    if (!known.has(x.id)) d.push(x.id, "asil(追加)", undefined, x.asil ?? "QM", (x.asil ?? "QM") === "QM");
  const knownD = new Set(before.decompositions.map((x) => x.id));
  for (const x of after.decompositions) if (!knownD.has(x.id)) d.push(x.id, "分解(追加)", undefined, x.parentRequirementId, true);
  const removed = <T extends { id: string }>(label: string, b: T[], a: T[]) => {
    const now = new Set(a.map((x) => x.id));
    for (const x of b) if (!now.has(x.id)) d.push(x.id, `削除(${label})`, "あり", undefined, true);
  };
  removed("故障ノード", before.failures, after.failures);
  removed("故障リンク", before.links, after.links);
  removed("ハザード事象", before.hara.events, after.hara.events);
  removed("安全目標", before.hara.goals, after.hara.goals);
  removed("安全要求", before.safetyRequirements, after.safetyRequirements);
  removed("フォールトツリー", before.faultTrees, after.faultTrees);
  removed("安全機構", before.mechanisms, after.mechanisms);
  removed("意図機能", before.intendedFunctions, after.intendedFunctions);
  removed("ペア", before.pairs, after.pairs);
  removed("分解", before.decompositions, after.decompositions);
}

/**
 * 前後の差分(評価値・HARA・ASIL・確率・管理策の記述の変更と、追加・削除された要素)。
 * 承認者に見せ、来歴(AI)と監査ログ(人の保存)に残す。リスクを下げうる変更は lowersRisk = true。
 */
export function riskChanges(before: SafetyData, after: SafetyData): DataChange[] {
  const d = differ();
  fmeaChanges(d, before, after);
  haraChanges(d, before, after);
  conceptChanges(d, before, after);
  hardwareChanges(d, before, after);
  independenceChanges(d, before, after);
  structuralRiskChanges(d, before, after);
  structureChanges(d, before, after);
  return d.out;
}
