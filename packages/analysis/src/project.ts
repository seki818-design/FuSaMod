import { z } from "zod";

const id = z.string().min(1).max(600);
const text = z.string().max(5000);
const asil = z.enum(["QM", "A", "B", "C", "D"]);
const arr = <T extends z.ZodTypeAny>(t: T) => z.array(t).max(50000);

const failureNode = z
  .object({
    id,
    description: text,
    functionId: id,
    severity: z.number().int().min(1).max(10).optional(),
    isBasicCause: z.boolean().optional(),
  })
  .strict();

const failureLink = z
  .object({
    id,
    causeId: id,
    effectId: id,
    occurrence: z.number().int().min(1).max(10).optional(),
    detection: z.number().int().min(1).max(10).optional(),
    preventionControl: text.optional(),
    detectionControl: text.optional(),
  })
  .strict();

const lit3 = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const lit4 = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const hazardousEvent = z
  .object({
    id,
    hazard: text,
    situation: text,
    severity: lit3,
    exposure: lit4,
    controllability: lit3,
    rationale: text.optional(),
    safetyGoalId: id.optional(),
  })
  .strict();

const safetyGoal = z
  .object({
    id,
    text,
    asil,
    ftti: z.number().positive().optional(),
    safeState: text.optional(),
  })
  .strict();

const intendedFunction = z
  .object({
    id,
    name: text,
    elementId: id,
    asil,
    originAsil: asil.optional(),
    requirementIds: arr(id).optional(),
  })
  .strict();

const mechanism = z
  .object({
    id,
    name: text,
    elementId: id,
    ftti: z.number().positive().optional(),
    diagnosticCoverage: z.enum(["low", "medium", "high"]).optional(),
    safeState: text.optional(),
    coversFailureIds: arr(id).optional(),
    requirementIds: arr(id).optional(),
    asil: asil.optional(),
    originAsil: asil.optional(),
  })
  .strict();

const pair = z
  .object({ id, intendedFunctionId: id, mechanismId: id, independence: text.optional() })
  .strict();

const safetyRequirement = z
  .object({
    id,
    text,
    level: z.enum(["safety-goal", "fsr", "tsr", "hw", "sw"]),
    asil,
    originAsil: asil.optional(),
    parentId: id.optional(),
    allocatedTo: id.optional(),
    safetyGoalId: id.optional(),
    refines: id.optional(),
  })
  .strict();

const decomposition = z
  .object({
    id,
    parentRequirementId: id,
    childRequirementIds: z.tuple([id, id]),
    independenceEvidence: text.optional(),
  })
  .strict();

const signalFlow = z.object({ id, name: text.optional(), from: id, to: z.array(id).min(1).max(1000) }).strict();

const faultTreeNode = z
  .object({
    id,
    label: text,
    kind: z.enum(["gate", "basic"]),
    gate: z.enum(["and", "or"]).optional(),
    inputs: arr(id).optional(),
    failureId: id.optional(),
    probability: z.number().min(0).max(1).optional(),
    undeveloped: z.boolean().optional(),
  })
  .strict();

const faultTree = z.object({ id, name: text, top: id, nodes: arr(faultTreeNode) }).strict();

const apRule = z
  .object({
    s: z.tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)]),
    o: z.tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)]),
    d: z.tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)]),
    ap: z.enum(["H", "M", "L"]),
  })
  .strict();

/** AI の提案を適用した記録(来歴)。提案者(依頼した人)と承認者を残す。 */
const aiChange = z
  .object({
    proposalId: id,
    title: text,
    provider: z.string().max(200),
    requestedBy: z.string().max(200),
    approvedBy: z.string().max(200),
    at: z.string().max(40),
    operations: z.number().int().min(0),
    /** 変更前後の差分(評価値の変更など。最大 50 件) */
    changes: arr(z.object({ id, field: z.string().max(100), from: z.union([z.string().max(200), z.number()]).optional(), to: z.union([z.string().max(200), z.number()]).optional(), lowersRisk: z.boolean() }).strict()).max(50).optional(),
    /** リスクを下げる変更を含むことを承認者が確認した */
    confirmedRiskLowering: z.boolean().optional(),
  })
  .strict();

/** ハードウェアの故障モード(SPFM/LFM の入力。故障率は利用者が与える) */
const hardwareFailureMode = z
  .object({
    id,
    name: text,
    elementId: id.optional(),
    fit: z.number().min(0).max(1e9),
    safeFraction: z.number().min(0).max(1).optional(),
    type: z.enum(["single", "multiple"]),
    dcSpfRf: z.number().min(0).max(1).optional(),
    dcLatent: z.number().min(0).max(1).optional(),
  })
  .strict();

/** プロジェクトの安全分析データ(model.sysml に対応する safety.json)。 */
export const SafetyDataSchema = z
  .object({
    version: z.literal(1),
    hara: z.object({ events: arr(hazardousEvent), goals: arr(safetyGoal) }).strict(),
    failures: arr(failureNode),
    links: arr(failureLink),
    intendedFunctions: arr(intendedFunction),
    mechanisms: arr(mechanism),
    pairs: arr(pair),
    safetyRequirements: arr(safetyRequirement),
    decompositions: arr(decomposition),
    signalFlows: arr(signalFlow),
    faultTrees: arr(faultTree),
    /** ハードウェアの故障モードと故障率(SPFM/LFM の算出。ISO 26262-5)。任意 */
    hardwareFailureModes: arr(hardwareFailureMode).optional(),
    /** 要素 ID → 階層レベルの上書き(自動の階層レベルを変えたい場合のみ) */
    levelOverrides: z.record(z.enum(["system", "subsystem", "component", "detail"])).optional(),
    /** AIAG-VDA の Action Priority 表(ハンドブックの正式な表をユーザーが投入する。ADR-0004) */
    apTable: arr(apRule).optional(),
    /** AP 表の出典(例: 「AIAG-VDA FMEA ハンドブック 第 1 版 表 …」)。サンプル表は「非公式」と明記する */
    apTableSource: z.string().max(500).optional(),
    /** AI の提案を適用した履歴(新しいものが後ろ。最大 500 件) */
    aiChanges: arr(aiChange).optional(),
  })
  .strict();

export type SafetyData = z.infer<typeof SafetyDataSchema>;

export function emptySafetyData(): SafetyData {
  return {
    version: 1,
    hara: { events: [], goals: [] },
    failures: [],
    links: [],
    intendedFunctions: [],
    mechanisms: [],
    pairs: [],
    safetyRequirements: [],
    decompositions: [],
    signalFlows: [],
    faultTrees: [],
  };
}

export type ParseResult = { ok: true; data: SafetyData } | { ok: false; errors: string[] };

/** 外部から入ってきた JSON を検証して SafetyData にする。不正なら、パス付きのエラー一覧を返す。 */
export function parseSafetyData(input: unknown): ParseResult {
  const r = SafetyDataSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    errors: r.error.issues.slice(0, 50).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
