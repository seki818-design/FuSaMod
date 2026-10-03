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
