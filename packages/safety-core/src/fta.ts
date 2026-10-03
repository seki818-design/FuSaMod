import type { Issue } from "./issues.js";
import { buildIndex } from "./net-index.js";
import type { FailureId, SafetyNet } from "./net-types.js";

export type GateType = "and" | "or";

export interface FaultTreeNode {
  id: string;
  label: string;
  kind: "gate" | "basic";
  /** kind=gate のとき */
  gate?: GateType;
  /** kind=gate のとき、入力ノードの ID */
  inputs?: string[];
  /** kind=basic のとき、対応する故障ノード(FMEA のエラーネット) */
  failureId?: FailureId;
  /** 基本事象の発生確率(0〜1)。省略可 */
  probability?: number;
  /** 展開されていない事象(原因が未分析) */
  undeveloped?: boolean;
}

export interface FaultTree {
  id: string;
  name: string;
  /** 頂上事象のノード ID */
  top: string;
  nodes: FaultTreeNode[];
}

export function validateFaultTree(t: FaultTree): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, message: string, ref?: string) =>
    issues.push({ code, severity: "error", message, ...(ref ? { ref } : {}) });
  const warn = (code: string, message: string, ref?: string) =>
    issues.push({ code, severity: "warning", message, ...(ref ? { ref } : {}) });

  const byId = new Map<string, FaultTreeNode>();
  for (const n of t.nodes) {
    if (byId.has(n.id)) err("DUP_ID", `ノード ID が重複: ${n.id}`, n.id);
    byId.set(n.id, n);
  }
  if (!byId.has(t.top)) {
    err("UNKNOWN_REF", `頂上事象が存在しません: ${t.top}`, t.id);
    return issues;
  }
  for (const n of t.nodes) {
    if (n.kind === "gate") {
      if (!n.gate) err("GATE_TYPE", "ゲートの種類(and/or)がありません", n.id);
      if (!n.inputs || n.inputs.length === 0) err("GATE_NO_INPUT", "ゲートに入力がありません", n.id);
      else if (n.gate === "and" && n.inputs.length < 2) warn("AND_SINGLE_INPUT", "AND ゲートの入力が 1 つです", n.id);
      for (const i of n.inputs ?? []) if (!byId.has(i)) err("UNKNOWN_REF", `入力ノードが存在しません: ${i}`, n.id);
    } else if (n.inputs?.length) err("BASIC_HAS_INPUT", "基本事象に入力があります", n.id);
    if (n.probability !== undefined && !(n.probability >= 0 && n.probability <= 1))
      err("PROBABILITY_RANGE", "確率は 0〜1", n.id);
    if (n.kind === "gate" && n.probability !== undefined) warn("GATE_PROBABILITY", "ゲートの確率は無視されます", n.id);
  }
  // 循環
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    for (const i of byId.get(id)?.inputs ?? []) if (byId.has(i) && visit(i)) return true;
    state.set(id, 2);
    return false;
  };
  if (visit(t.top)) err("FT_CYCLE", "フォールトツリーに循環があります", t.id);
  // 到達不能
  const reach = new Set<string>();
  const walk = (id: string) => {
    if (reach.has(id)) return;
    reach.add(id);
    for (const i of byId.get(id)?.inputs ?? []) if (byId.has(i)) walk(i);
  };
  if (!state.has(t.top) || state.get(t.top) === 2) walk(t.top);
  for (const n of t.nodes) if (!reach.has(n.id)) warn("FT_UNREACHABLE", "頂上事象から到達できないノードです", n.id);
  for (const n of t.nodes)
    if (n.kind === "basic" && n.undeveloped) warn("FT_UNDEVELOPED", "展開されていない事象です", n.id);
  return issues;
}

export interface CutSetResult {
  /** 最小カットセット(基本事象 ID の集合、昇順のサイズ・辞書順) */
  cutSets: string[][];
  /** 展開が上限を超えて打ち切られた場合 true(結果は不完全) */
  truncated: boolean;
}

/** 最小カットセット(MOCUS 法 + 吸収則)。循環や未知のノードがあるツリーは検証してから使う。 */
export function minimalCutSets(t: FaultTree, opts: { limit?: number } = {}): CutSetResult {
  const limit = opts.limit ?? 20000;
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  let truncated = false;

  const expand = (id: string, depth: number): string[][] => {
    const n = byId.get(id);
    if (!n || depth > 10000) return [];
    if (n.kind === "basic") return [[n.id]];
    const kids = (n.inputs ?? []).map((i) => expand(i, depth + 1));
    if (n.gate === "or") return absorb(kids.flat());
    // and: 直積
    let acc: string[][] = [[]];
    for (const k of kids) {
      const next: string[][] = [];
      for (const a of acc)
        for (const b of k) {
          next.push([...new Set([...a, ...b])]);
          if (next.length > limit) { truncated = true; break; }
        }
      acc = absorb(next);
      if (truncated) break;
    }
    return acc;
  };
  const absorb = (sets: string[][]): string[][] => {
    const sorted = sets
      .map((s) => [...new Set(s)].sort())
      .sort((a, b) => a.length - b.length || a.join("\0").localeCompare(b.join("\0")));
    const out: string[][] = [];
    for (const s of sorted) {
      if (out.some((o) => o.every((x) => s.includes(x)))) continue;
      out.push(s);
    }
    return out;
  };
  const cutSets = absorb(expand(t.top, 0));
  return { cutSets, truncated };
}

/** 単一故障(サイズ 1 のカットセット)。ISO 26262 では単一点故障の候補として確認する。 */
export function singlePointFaults(t: FaultTree): string[] {
  return minimalCutSets(t).cutSets.filter((c) => c.length === 1).map((c) => c[0]!);
}

/**
 * 頂上事象確率の上限(Esary-Proschan: 1 - Π(1 - P(カットセット)))。
 * すべての基本事象に確率がある場合のみ計算する。独立を仮定する。
 */
export function topProbabilityUpperBound(t: FaultTree): number | undefined {
  const probs = new Map(t.nodes.filter((n) => n.kind === "basic").map((n) => [n.id, n.probability]));
  const { cutSets, truncated } = minimalCutSets(t);
  if (truncated) return undefined;
  let prodNot = 1;
  for (const cs of cutSets) {
    let p = 1;
    for (const id of cs) {
      const v = probs.get(id);
      if (v === undefined) return undefined;
      p *= v;
    }
    prodNot *= 1 - p;
  }
  return 1 - prodNot;
}

/**
 * 故障ネット(FMEA のエラーネット)から、ある故障ノードを頂上事象とするフォールトツリーを導出する。
 * 故障ノードごとに OR ゲート(原因のいずれか)を置く。共有された原因は同じノードを再利用する。
 * 原因が無く根本原因でもない故障は「未展開」の基本事象にする。
 */
export function faultTreeFromNet(net: SafetyNet, topFailureId: FailureId, name?: string): FaultTree {
  const idx = buildIndex(net);
  const nodes = new Map<string, FaultTreeNode>();
  const visiting = new Set<FailureId>();
  const build = (fid: FailureId): string | undefined => {
    const f = idx.failure.get(fid);
    if (!f) return undefined;
    if (nodes.has(fid)) return fid;
    const causes = idx.causesOf.get(fid) ?? [];
    if (visiting.has(fid)) return undefined; // 循環は切る
    if (causes.length === 0) {
      nodes.set(fid, {
        id: fid,
        label: f.description,
        kind: "basic",
        failureId: fid,
        ...(f.isBasicCause ? {} : { undeveloped: true }),
      });
      return fid;
    }
    visiting.add(fid);
    const inputs = causes.map((l) => build(l.causeId)).filter((x): x is string => x !== undefined);
    visiting.delete(fid);
    const gateId = `G:${fid}`;
    nodes.set(gateId, { id: gateId, label: f.description, kind: "gate", gate: "or", inputs });
    return gateId;
  };
  const top = build(topFailureId) ?? topFailureId;
  const topLabel = idx.failure.get(topFailureId)?.description ?? topFailureId;
  return { id: `FT:${topFailureId}`, name: name ?? topLabel, top, nodes: [...nodes.values()] };
}
