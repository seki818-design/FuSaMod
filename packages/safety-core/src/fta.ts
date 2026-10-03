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

type Add = (code: string, message: string, ref?: string) => void;

function checkNodes(t: FaultTree, byId: Map<string, FaultTreeNode>, err: Add, warn: Add) {
  for (const n of t.nodes) {
    if (n.kind === "gate") {
      if (!n.gate) err("GATE_TYPE", "ゲートの種類(and/or)がありません", n.id);
      if (!n.inputs || n.inputs.length === 0) err("GATE_NO_INPUT", "ゲートに入力がありません", n.id);
      else if (n.gate === "and" && n.inputs.length < 2) warn("AND_SINGLE_INPUT", "AND ゲートの入力が 1 つです", n.id);
      for (const i of n.inputs ?? []) if (!byId.has(i)) err("UNKNOWN_REF", `入力ノードが存在しません: ${i}`, n.id);
      if (n.probability !== undefined) warn("GATE_PROBABILITY", "ゲートの確率は無視されます", n.id);
    } else if (n.inputs?.length) err("BASIC_HAS_INPUT", "基本事象に入力があります", n.id);
    if (n.probability !== undefined && !(n.probability >= 0 && n.probability <= 1)) err("PROBABILITY_RANGE", "確率は 0〜1", n.id);
    if (n.kind === "basic" && n.undeveloped) warn("FT_UNDEVELOPED", "展開されていない事象です", n.id);
  }
}

/** 頂上事象から到達できないノードの検出と、循環の検出(再帰を使わない)。 */
function checkReachability(t: FaultTree, byId: Map<string, FaultTreeNode>, err: Add, warn: Add) {
  const problems: string[] = [];
  const reach = new Set(postOrder(t, byId, problems));
  if (problems.some((p) => p.startsWith("循環"))) err("FT_CYCLE", "フォールトツリーに循環があります", t.id);
  for (const n of t.nodes) if (!reach.has(n.id)) warn("FT_UNREACHABLE", "頂上事象から到達できないノードです", n.id);
}

export function validateFaultTree(t: FaultTree): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Issue["severity"]): Add => (code, message, ref) => void issues.push({ code, severity, message, ...(ref ? { ref } : {}) });
  const err = add("error");
  const warn = add("warning");
  const byId = new Map<string, FaultTreeNode>();
  for (const n of t.nodes) {
    if (byId.has(n.id)) err("DUP_ID", `ノード ID が重複: ${n.id}`, n.id);
    byId.set(n.id, n);
  }
  if (!byId.has(t.top)) {
    err("UNKNOWN_REF", `頂上事象が存在しません: ${t.top}`, t.id);
    return issues;
  }
  checkNodes(t, byId, err, warn);
  checkReachability(t, byId, err, warn);
  return issues;
}

export interface CutSetResult {
  /** 最小カットセット(基本事象 ID の集合、昇順のサイズ・辞書順) */
  cutSets: string[][];
  /** 展開が上限(件数・時間)を超えて打ち切られた場合 true(結果は不完全) */
  truncated: boolean;
  /** 解析できなかった理由(循環・未知のノード・入力の無いゲート)。空でなければ結果は信用できない */
  problems: string[];
}

const USED = (r: CutSetResult) => r.problems.length === 0 && !r.truncated;
/** カットセットの結果が完全で信用できるか。 */
export const isCompleteResult = USED;

/** 吸収則: 他の集合の部分集合になっているものを除く(要素ごとの転置索引で、全組み合わせの比較を避ける)。 */
function absorb(sets: string[][], expired: () => boolean): { sets: string[][]; timedOut: boolean } {
  const sorted = sets
    .map((s) => [...new Set(s)].sort())
    .sort((a, b) => a.length - b.length || a.join("\0").localeCompare(b.join("\0")));
  const out: string[][] = [];
  const posting = new Map<string, number[]>();
  const hits: number[] = [];
  let seen = "";
  for (const s of sorted) {
    const key = s.join("\0");
    if (key === seen) continue;
    seen = key;
    if (expired()) return { sets: out, timedOut: true };
    const touched: number[] = [];
    let absorbed = out.length > 0 && out[0]!.length === 0;
    for (const x of s) {
      for (const idx of posting.get(x) ?? []) {
        if (hits[idx] === undefined || hits[idx] === 0) touched.push(idx);
        hits[idx] = (hits[idx] ?? 0) + 1;
        if (hits[idx] === out[idx]!.length) absorbed = true;
      }
    }
    for (const idx of touched) hits[idx] = 0;
    if (absorbed) continue;
    out.push(s);
    for (const x of s) {
      const l = posting.get(x);
      if (l) l.push(out.length - 1);
      else posting.set(x, [out.length - 1]);
    }
  }
  return { sets: out, timedOut: false };
}

/** 頂上から到達できるノードの後行順(入力が先)。循環・未知のノードを problems に集める。再帰を使わない。 */
function postOrder(t: FaultTree, byId: Map<string, FaultTreeNode>, problems: string[]): string[] {
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const stack: { id: string; i: number }[] = [{ id: t.top, i: 0 }];
  state.set(t.top, 1);
  while (stack.length) {
    const top = stack[stack.length - 1]!;
    const inputs = byId.get(top.id)?.inputs ?? [];
    if (top.i < inputs.length) {
      const next = inputs[top.i++]!;
      if (!byId.has(next)) {
        problems.push(`入力ノードが存在しません: ${next}`);
        continue;
      }
      const st = state.get(next);
      if (st === 1) problems.push(`循環があります: ${next}`);
      else if (st === undefined) {
        state.set(next, 1);
        stack.push({ id: next, i: 0 });
      }
    } else {
      state.set(top.id, 2);
      order.push(top.id);
      stack.pop();
    }
  }
  return order;
}

/**
 * 最小カットセット(MOCUS 法 + 吸収則)。
 * 循環・未知のノード・入力の無いゲートは `problems` に記録し、空の結果を「安全」と誤読させない。
 * 件数(limit)と時間(timeLimitMs)の上限を超えると truncated になる。
 */
export function minimalCutSets(t: FaultTree, opts: { limit?: number; timeLimitMs?: number } = {}): CutSetResult {
  const limit = opts.limit ?? 20000;
  const deadline = Date.now() + (opts.timeLimitMs ?? 3000);
  const expired = () => Date.now() > deadline;
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const problems: string[] = [];
  if (!byId.has(t.top)) return { cutSets: [], truncated: false, problems: [`頂上事象が存在しません: ${t.top}`] };
  const order = postOrder(t, byId, problems);
  let truncated = false;
  const memo = new Map<string, string[][]>();
  for (const id of order) {
    const n = byId.get(id)!;
    if (n.kind === "basic") {
      memo.set(id, [[id]]);
      continue;
    }
    const kids = (n.inputs ?? []).filter((i) => memo.has(i)).map((i) => memo.get(i)!);
    if (!n.inputs || n.inputs.length === 0) problems.push(`入力の無いゲートがあります: ${id}`);
    let acc: string[][];
    if (n.gate === "and") {
      acc = [[]];
      for (const k of kids) {
        const next: string[][] = [];
        for (const a of acc) {
          for (const b of k) {
            next.push([...a, ...b]);
            if (next.length > limit) truncated = true;
          }
          if (truncated) break;
        }
        const r = absorb(next, expired);
        acc = r.sets;
        if (r.timedOut) truncated = true;
        if (truncated) break;
      }
    } else {
      const r = absorb(kids.flat(), expired);
      acc = r.sets;
      if (r.timedOut) truncated = true;
    }
    memo.set(id, acc);
    if (truncated) break;
  }
  const cutSets = truncated ? [] : (memo.get(t.top) ?? []);
  return { cutSets: problems.length ? [] : cutSets, truncated, problems };
}

export interface SinglePointResult {
  faults: string[];
  /** false のとき、faults は信用できない(打ち切り・循環など)。UI は「0 件」を安全と表示してはいけない */
  complete: boolean;
  problems: string[];
}

/** 単一故障(サイズ 1 のカットセット)。ISO 26262 では単一点故障の候補として確認する。 */
export function singlePointFaults(t: FaultTree): SinglePointResult {
  const r = minimalCutSets(t);
  return { faults: r.cutSets.filter((c) => c.length === 1).map((c) => c[0]!), complete: USED(r), problems: r.problems };
}

/**
 * 頂上事象確率の上限(Esary-Proschan: 1 - Π(1 - P(カットセット)))。
 * すべての基本事象に確率がある場合のみ計算する。独立を仮定する。
 */
export function topProbabilityUpperBound(t: FaultTree): number | undefined {
  const probs = new Map(t.nodes.filter((n) => n.kind === "basic").map((n) => [n.id, n.probability]));
  const r = minimalCutSets(t);
  if (!isCompleteResult(r)) return undefined;
  const { cutSets } = r;
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
    if (visiting.has(fid)) {
      // 循環は切るが、黙って落とさず「循環(未展開)」の基本事象として残す
      const cid = `CYCLE:${fid}`;
      nodes.set(cid, { id: cid, label: `循環のため未展開: ${f.description}`, kind: "basic", failureId: fid, undeveloped: true });
      return cid;
    }
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
