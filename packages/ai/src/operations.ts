import { z } from "zod";
import { SafetyDataSchema, parseSafetyData, type SafetyData } from "@fusamod/analysis";

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
      if ((from ?? "") !== (to ?? "")) push(id, field, from ? "(記述あり)" : undefined, to ? "(記述あり)" : undefined, !!from && (to ?? "").trim().length < from.trim().length / 2);
    },
  };
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
  }
  const oldG = byId(before.hara.goals);
  for (const g of after.hara.goals) {
    const o = oldG.get(g.id);
    if (!o) continue;
    d.push(g.id, "goalAsil", o.asil, g.asil, (ASIL_RANK[g.asil] ?? 0) < (ASIL_RANK[o.asil] ?? 0));
    d.num(g.id, "ftti", o.ftti, g.ftti, inc); // FTTI を延ばすと、安全機構への要求がゆるむ
  }
  const oldT = byId(before.faultTrees);
  for (const t of after.faultTrees) {
    const oldN = byId(oldT.get(t.id)?.nodes ?? []);
    for (const n of t.nodes) {
      const on = oldN.get(n.id);
      if (on) d.num(`${t.id}/${n.id}`, "probability", on.probability, n.probability, dec);
    }
  }
  const oldM = byId(before.mechanisms);
  for (const m of after.mechanisms) {
    const o = oldM.get(m.id);
    if (!o) continue;
    d.num(m.id, "ftti", o.ftti, m.ftti, inc);
    const was = (o.coversFailureIds ?? []).length;
    const now = (m.coversFailureIds ?? []).length;
    d.push(m.id, "coversFailureIds", was, now, now < was);
  }
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
  structureChanges(d, before, after);
  return d.out;
}
