import { useSyncExternalStore } from "react";
import { analyzeProject, recomputePuzzle, type ProjectAnalysis, type Puzzle, type SafetyData } from "@fusamod/analysis";
import { addChild, editability, removeElement, renameElement, remapIds, type EditResult, type ElementGraph, type NewKind } from "@fusamod/sysml-graph";
import { api, ApiError, download, setToken, type ChatResult, type Citation, type Diagnostic, type Proposal, type ProjectView, type RevisionMeta } from "./api.js";

export type TabKey = "fmea" | "net" | "fta" | "hara" | "concept" | "scdl" | "trace" | "issues" | "history" | "data";
export type MainView = "diagram" | "activity" | "sequence" | "text";

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
  details?: string[];
}
export interface ChatMsg {
  id: number;
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  proposalIds?: string[];
  dropped?: string[];
  error?: boolean;
  provider?: string;
}

export interface State {
  ready: boolean;
  needLogin: boolean;
  health?: { sysml: string; ai: string; authRequired: boolean };
  /** ログイン中の利用者と役割(viewer は読み取り専用) */
  me?: { user: string; role: "editor" | "viewer" };
  projects: { id: string; revision: number; updated?: string }[];
  projectId?: string;
  server?: ProjectView;
  draftModel: string;
  draftSafety?: SafetyData;
  graph: ElementGraph | null;
  /** graph が対応するモデルのテキスト（図からの編集は、draftModel と一致しているときだけ行う） */
  graphModel: string | null;
  diagnostics: Diagnostic[];
  modelOk: boolean;
  sysmlError?: string;
  analysis: ProjectAnalysis | null;
  selectedElementId?: string;
  mainView: MainView;
  tab: TabKey;
  focusIssue?: { level?: string; viewpoint?: string };
  busy: { loading: boolean; saving: boolean; analyzing: boolean; chatting: boolean };
  toasts: Toast[];
  chat: ChatMsg[];
  proposals: Proposal[];
  history: RevisionMeta[];
  /** 監査ログのハッシュ連鎖の検証結果 */
  auditChain: { ok: boolean; lines: number; brokenAtLine?: number } | undefined;
  refs: { name: string; text: string }[];
  puzzleOnlyProblems: boolean;
  layerConsistency: boolean;
  analysisMax: boolean;
  /** ビュースペースを全画面にする(エクスプローラ・分析・AI・パズルビューを隠す) */
  viewMax: boolean;
  /** パズルビューのセルから指定された、図でハイライトする要素 */
  highlight?: { ids: string[]; emphasis: string[]; label: string };
  /** 図の階層指定: all=入れ子の全体、それ以外=その階層の要素だけを並べて表示 */
  diagramLevel: "all" | "system" | "subsystem" | "component" | "detail";
  /** true なら、選択中の要素を根として、その内部だけを表示する */
  diagramFocus: boolean;
  /** 図の配置の手動調整(要素 ID → 自動配置からのずれ) */
  layoutOffsets: Record<string, { dx: number; dy: number }>;
  theme: "dark" | "light";
}

const initial: State = {
  ready: false,
  needLogin: false,
  projects: [],
  draftModel: "",
  graph: null,
  graphModel: null,
  diagnostics: [],
  modelOk: true,
  analysis: null,
  mainView: "diagram",
  tab: "fmea",
  busy: { loading: false, saving: false, analyzing: false, chatting: false },
  toasts: [],
  chat: [],
  proposals: [],
  history: [],
  auditChain: undefined,
  refs: [],
  puzzleOnlyProblems: false,
  layerConsistency: true,
  analysisMax: false,
  viewMax: false,
  diagramLevel: "all",
  diagramFocus: false,
  layoutOffsets: {},
  theme: "dark",
};

let state: State = initial;
const listeners = new Set<() => void>();
export const getState = () => state;
function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  listeners.forEach((l) => l());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => sel(state),
    () => sel(initial),
  );
}

let toastId = 1;
export function toast(kind: Toast["kind"], text: string, details?: string[]) {
  const id = toastId++;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text, ...(details ? { details } : {}) }] }));
  if (kind !== "error") setTimeout(() => dismissToast(id), 5000);
}
export const dismissToast = (id: number) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

function fail(e: unknown, prefix = "") {
  if (e instanceof ApiError) {
    if (e.status === 401) {
      set({ needLogin: true });
      return;
    }
    toast("error", `${prefix}${e.message}`, e.details);
  } else toast("error", `${prefix}予期しないエラーが発生しました`);
}

/** 読み取り専用の利用者(viewer)かどうか。編集系の操作は、画面で無効にするだけでなく、ここでも拒否する。 */
export const isReadOnly = (st: State = state) => st.me?.role === "viewer";
function denyReadOnly(): boolean {
  if (!isReadOnly()) return false;
  toast("error", "読み取り専用の利用者のため、この操作はできません");
  return true;
}

// ----- 派生値 -----
export const isModelDirty = (s: State) => s.server !== undefined && s.draftModel !== s.server.model;
export const isSafetyDirty = (s: State) => s.server !== undefined && s.draftSafety !== undefined && JSON.stringify(s.draftSafety) !== JSON.stringify(s.server.safety);
export const isDirty = (s: State) => isModelDirty(s) || isSafetyDirty(s);

export function puzzleOf(s: State): Puzzle | undefined {
  if (!s.analysis) return undefined;
  return recomputePuzzle(s.analysis, { excludeSources: s.layerConsistency ? [] : ["consistency"] });
}

function recompute(graph: ElementGraph | null, safety: SafetyData | undefined): Partial<State> {
  if (!graph || !safety) return { analysis: null };
  try {
    return { analysis: analyzeProject(graph, safety) };
  } catch (e) {
    toast("error", `解析中にエラーが発生しました: ${(e as Error).message}`);
    return { analysis: null };
  }
}

function applyView(v: ProjectView, keepDrafts = false) {
  if (v.notice) toast("info", v.notice);
  set((s) => {
    const draftSafety = keepDrafts && s.draftSafety ? s.draftSafety : v.safety;
    const draftModel = keepDrafts ? s.draftModel : v.model;
    const graph = v.graph ?? (keepDrafts ? s.graph : null);
    return {
      server: v,
      draftModel,
      draftSafety,
      graph,
      graphModel: v.graph ? draftModel : keepDrafts ? s.graphModel : null,
      diagnostics: v.diagnostics,
      modelOk: v.modelOk,
      ...(v.sysmlError ? { sysmlError: v.sysmlError } : { sysmlError: undefined as unknown as string }),
      ...recompute(graph, draftSafety),
    };
  });
}

// ----- 起動・プロジェクト -----
export async function init() {
  try {
    const [health, list, me] = await Promise.all([api.health(), api.projects(), api.me()]);
    set({ health, projects: list.projects, me, ready: true, needLogin: false });
    const initialId = new URLSearchParams(location.search).get("project") ?? list.projects[0]?.id;
    if (initialId) await selectProject(initialId);
  } catch (e) {
    set({ ready: true });
    if (e instanceof ApiError && e.status === 401) set({ needLogin: true });
    else fail(e);
  }
}

export async function login(t: string) {
  setToken(t.trim() || undefined);
  set({ needLogin: false });
  await init();
}

export async function selectProject(id: string) {
  set((s) => ({ busy: { ...s.busy, loading: true }, projectId: id }));
  try {
    const v = await api.get(id);
    set({ chat: [], proposals: [], history: [], selectedElementId: undefined, highlight: undefined, layoutOffsets: loadOffsets(id) });
    applyView(v);
    const first = v.analysis ? Object.keys(v.analysis.fmea)[0] : undefined;
    set({ selectedElementId: first });
    void Promise.all([loadHistory(), loadProposals(), loadRefs()]);
  } catch (e) {
    fail(e, "プロジェクトを開けません: ");
  } finally {
    set((s) => ({ busy: { ...s.busy, loading: false } }));
  }
}

export async function createProject(id: string) {
  if (denyReadOnly()) return;
  try {
    await api.create(id);
    set({ projects: (await api.projects()).projects });
    await selectProject(id);
    toast("success", `プロジェクト「${id}」を作成しました`);
  } catch (e) {
    fail(e);
  }
}

async function loadHistory() {
  const id = state.projectId;
  if (!id) return;
  try {
    set({ history: (await api.history(id)).history });
    set({ auditChain: (await api.audit(id)).chain });
  } catch (e) {
    fail(e);
  }
}
async function loadProposals() {
  const id = state.projectId;
  if (!id) return;
  try {
    set({ proposals: (await api.proposals(id)).proposals });
  } catch (e) {
    fail(e);
  }
}
async function loadRefs() {
  const id = state.projectId;
  if (!id) return;
  try {
    set({ refs: (await api.refs(id)).refs });
  } catch (e) {
    fail(e);
  }
}

// ----- 編集 -----
let analyzeTimer: ReturnType<typeof setTimeout> | undefined;
let analyzeSeq = 0;

export function setDraftModel(text: string) {
  if (denyReadOnly()) return;
  set({ draftModel: text });
  clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(() => void analyzeModelNow(), 700);
}

export async function analyzeModelNow() {
  const id = state.projectId;
  if (!id) return;
  const seq = ++analyzeSeq;
  const sent = state.draftModel;
  set((s) => ({ busy: { ...s.busy, analyzing: true } }));
  try {
    const v = await api.analyze(id, { model: sent });
    if (seq !== analyzeSeq) return; // 古い結果は捨てる
    set((s) => ({
      diagnostics: v.diagnostics,
      modelOk: v.modelOk,
      sysmlError: v.sysmlError as string,
      graph: v.graph ?? (v.modelOk ? s.graph : null),
      graphModel: v.graph ? sent : v.modelOk ? s.graphModel : null,
      ...(v.graph ? recompute(v.graph, s.draftSafety) : { analysis: v.modelOk ? s.analysis : null }),
    }));
  } catch (e) {
    if (seq === analyzeSeq) fail(e, "モデルを解析できません: ");
  } finally {
    if (seq === analyzeSeq) set((s) => ({ busy: { ...s.busy, analyzing: false } }));
  }
}

/** 安全分析データを編集する。ブラウザ内で即時に再解析する。 */
export function updateSafety(fn: (draft: SafetyData) => void) {
  if (denyReadOnly()) return;
  const cur = state.draftSafety;
  if (!cur) return;
  const next = structuredClone(cur);
  fn(next);
  set((s) => ({ draftSafety: next, ...recompute(s.graph, next) }));
}

export function replaceSafety(next: SafetyData) {
  if (denyReadOnly()) return;
  set((s) => ({ draftSafety: next, ...recompute(s.graph, next) }));
}

// ----- 図・エクスプローラからのモデルの編集（テキストを書き換えて、すぐ再解析する） -----

/** 図から編集できない理由（編集できるなら undefined）。 */
export function editBlockReason(s: State, id: string | undefined): string | undefined {
  if (s.me?.role === "viewer") return "読み取り専用の利用者は編集できません";
  if (s.health && s.health.sysml !== "java") return "Java(公式実装)が使えないため、モデルを編集できません";
  if (!s.graph || s.graphModel === null) return "モデルを解析できていないため、図から編集できません。テキストで修正してください";
  if (s.draftModel !== s.graphModel || s.busy.analyzing) return "解析中です。終わってからもう一度操作してください";
  if (id === undefined) return undefined;
  const r = editability(s.draftModel, s.graph, id);
  return r.ok ? undefined : r.reason;
}

function commitEdit(r: EditResult, after?: { select?: string }) {
  if (!r.ok) {
    toast("error", r.reason);
    return false;
  }
  clearTimeout(analyzeTimer);
  set((s) => {
    let draftSafety = s.draftSafety;
    let sel = after?.select ?? s.selectedElementId;
    if (r.idChange && draftSafety) {
      draftSafety = remapIds(draftSafety, r.idChange.from, r.idChange.to);
      if (sel && (sel === r.idChange.from || sel.startsWith(`${r.idChange.from}::`))) sel = `${r.idChange.to}${sel.slice(r.idChange.from.length)}`;
    }
    return { draftModel: r.text, ...(draftSafety ? { draftSafety } : {}), selectedElementId: sel as string };
  });
  toast("success", `${r.summary}（保存すると確定します）`);
  void analyzeModelNow();
  return true;
}

export function addElement(parentId: string | undefined, kind: NewKind, name: string): boolean {
  if (denyReadOnly()) return false;
  const why = editBlockReason(state, parentId);
  if (why) {
    toast("error", why);
    return false;
  }
  const r = addChild(state.draftModel, state.graph!, parentId, kind, name);
  return commitEdit(r, r.ok && r.createdQn && kind === "part" ? { select: r.createdQn } : undefined);
}

/** 図からの編集の共通入口: containerQn が編集できることを確かめて、関数でテキストを書き換える。 */
export function editModelWith(containerQn: string | undefined, fn: (text: string, graph: ElementGraph) => EditResult): boolean {
  if (denyReadOnly()) return false;
  const why = editBlockReason(state, containerQn);
  if (why) {
    toast("error", why);
    return false;
  }
  return commitEdit(fn(state.draftModel, state.graph!));
}

export function renameElementTo(id: string, name: string, updateReferences = true): boolean {
  if (denyReadOnly()) return false;
  const why = editBlockReason(state, id);
  if (why) {
    toast("error", why);
    return false;
  }
  return commitEdit(renameElement(state.draftModel, state.graph!, id, name, updateReferences));
}

export function deleteElement(id: string): boolean {
  if (denyReadOnly()) return false;
  const why = editBlockReason(state, id);
  if (why) {
    toast("error", why);
    return false;
  }
  const ok = commitEdit(removeElement(state.draftModel, state.graph!, id));
  if (ok && state.selectedElementId && (state.selectedElementId === id || state.selectedElementId.startsWith(`${id}::`))) set({ selectedElementId: undefined as unknown as string });
  return ok;
}

export async function save(message?: string) {
  if (denyReadOnly()) return;
  const s0 = state;
  const id = s0.projectId;
  if (!id || !s0.server || s0.busy.saving) return;
  set((s) => ({ busy: { ...s.busy, saving: true } }));
  try {
    let rev = s0.server.revision;
    let last: ProjectView | undefined;
    if (isModelDirty(s0)) {
      last = await api.saveModel(id, s0.draftModel, rev, message);
      rev = last.revision;
    }
    if (isSafetyDirty(s0) && s0.draftSafety) {
      last = await api.saveSafety(id, s0.draftSafety, rev, message);
    }
    if (last) applyView(last, false);
    await loadHistory();
    toast("success", last && !last.modelOk ? "保存しました(モデルにエラーがあるため、解析は更新されていません)" : "保存しました");
  } catch (e) {
    fail(e, "保存できません: ");
  } finally {
    set((s) => ({ busy: { ...s.busy, saving: false } }));
  }
}

export function discard() {
  const v = state.server;
  if (!v) return;
  clearTimeout(analyzeTimer);
  analyzeSeq++;
  applyView(v, false);
}

export async function restoreRevision(rev: number) {
  if (denyReadOnly()) return;
  const id = state.projectId;
  if (!id) return;
  try {
    const v = await api.restore(id, rev);
    applyView(v, false);
    await loadHistory();
    toast("success", `リビジョン ${rev} に戻しました`);
  } catch (e) {
    fail(e);
  }
}

// ----- AI -----
let msgId = 1;
export async function sendChat(text: string) {
  if (denyReadOnly()) return;
  const id = state.projectId;
  const msg = text.trim();
  if (!id || !msg || state.busy.chatting) return;
  set((s) => ({ busy: { ...s.busy, chatting: true }, chat: [...s.chat, { id: msgId++, role: "user", text: msg }] }));
  try {
    const r: ChatResult = await api.chat(id, msg);
    set((s) => ({
      chat: [...s.chat, { id: msgId++, role: "assistant", text: r.reply, citations: r.citations, proposalIds: r.proposals.map((p) => p.id), ...(r.dropped ? { dropped: r.dropped } : {}), provider: r.provider.name }],
      proposals: [...s.proposals, ...r.proposals],
    }));
  } catch (e) {
    const text = e instanceof ApiError ? e.message : "AI の呼び出しに失敗しました";
    if (e instanceof ApiError && e.status === 401) set({ needLogin: true });
    set((s) => ({ chat: [...s.chat, { id: msgId++, role: "assistant", text, error: true }] }));
  } finally {
    set((s) => ({ busy: { ...s.busy, chatting: false } }));
  }
}

export async function applyProposal(pid: string) {
  if (denyReadOnly()) return;
  const id = state.projectId;
  if (!id) return;
  if (isDirty(state)) {
    toast("error", "未保存の変更があります。AI の提案を適用する前に、保存するか破棄してください。");
    return;
  }
  try {
    let r;
    try {
      r = await api.apply(id, pid);
    } catch (e) {
      // リスクを下げる変更を含む提案は、承認者が内容を確認したうえで適用する
      if (!(e instanceof ApiError) || e.status !== 409 || !e.message.startsWith("リスクを下げる")) throw e;
      if (!window.confirm(`${e.message}\n\n${(e.details ?? []).join("\n")}\n\nこの変更を適用しますか?`)) return;
      r = await api.apply(id, pid, true);
    }
    applyView(r, false);
    set((s) => ({ proposals: s.proposals.map((p) => (p.id === pid ? r.proposal : p)) }));
    await loadHistory();
    toast("success", `提案を適用しました: ${r.proposal.title}`);
  } catch (e) {
    fail(e, "提案を適用できません: ");
  }
}

export async function rejectProposal(pid: string) {
  if (denyReadOnly()) return;
  const id = state.projectId;
  if (!id) return;
  try {
    const r = await api.reject(id, pid);
    set((s) => ({ proposals: s.proposals.map((p) => (p.id === pid ? r.proposal : p)) }));
  } catch (e) {
    fail(e);
  }
}

// ----- 画面 -----
export const select = (elementId: string | undefined) => set({ selectedElementId: elementId });
export const openTab = (tab: TabKey) => set({ tab });
export const setMainView = (mainView: MainView) => set({ mainView });
export const setPuzzleOnlyProblems = (v: boolean) => set({ puzzleOnlyProblems: v });
export const toggleAnalysisMax = () => set((s) => ({ analysisMax: !s.analysisMax, viewMax: false }));
export const toggleViewMax = () => set((s) => ({ viewMax: !s.viewMax, analysisMax: false }));
export const exitViewMax = () => set({ viewMax: false });
export const setDiagramLevel = (diagramLevel: State["diagramLevel"]) => set({ diagramLevel });
export const setDiagramFocus = (diagramFocus: boolean) => set({ diagramFocus });

/** パズルビューのセルから、図に該当の要素をハイライトする(図に切り替え、階層指定・フォーカスは解除する)。 */
export function highlightElements(ids: string[], emphasis: string[], label: string) {
  set({ highlight: { ids, emphasis, label }, mainView: "diagram", diagramLevel: "all", diagramFocus: false });
}
export const clearHighlight = () => set({ highlight: undefined });

// ----- 図の配置(手動調整)。プロジェクトごとに、このブラウザに保存する(モデルには入れない) -----
const layoutKey = (id: string) => `fusamod.layout.${id}`;
function loadOffsets(id: string): State["layoutOffsets"] {
  try {
    const raw = localStorage.getItem(layoutKey(id));
    const v = raw ? (JSON.parse(raw) as unknown) : {};
    return v && typeof v === "object" ? (v as State["layoutOffsets"]) : {};
  } catch {
    return {};
  }
}
function saveOffsets(id: string | undefined, o: State["layoutOffsets"]) {
  if (!id) return;
  try {
    if (Object.keys(o).length === 0) localStorage.removeItem(layoutKey(id));
    else localStorage.setItem(layoutKey(id), JSON.stringify(o));
  } catch {
    /* 保存できない環境では、このセッションのみ */
  }
}
export function moveBoxes(changes: Record<string, { dx: number; dy: number }>) {
  const next = { ...state.layoutOffsets };
  for (const [id, d] of Object.entries(changes)) {
    const cur = next[id] ?? { dx: 0, dy: 0 };
    const v = { dx: Math.round(cur.dx + d.dx), dy: Math.round(cur.dy + d.dy) };
    if (v.dx === 0 && v.dy === 0) delete next[id];
    else next[id] = v;
  }
  set({ layoutOffsets: next });
  saveOffsets(state.projectId, next);
}
export function resetLayout() {
  set({ layoutOffsets: {} });
  saveOffsets(state.projectId, {});
}
export const setLayerConsistency = (v: boolean) => set({ layerConsistency: v });
export const focusIssues = (level?: string, viewpoint?: string) => set({ tab: "issues", focusIssue: { ...(level ? { level } : {}), ...(viewpoint ? { viewpoint } : {}) } });
export const clearIssueFocus = () => set({ focusIssue: undefined });

export function setTheme(theme: "dark" | "light") {
  set({ theme });
  document.documentElement.dataset["theme"] = theme;
  try {
    localStorage.setItem("fusamod.theme", theme);
  } catch {
    /* 保存できない環境では、このセッションのみ */
  }
}

export async function exportFile(name: string, query = "") {
  const id = state.projectId;
  if (!id) return;
  if (isDirty(state)) toast("info", "未保存の変更は含まれません(保存済みの内容を出力します)");
  try {
    await download(id, name, query);
  } catch (e) {
    fail(e, "");
  }
}

export function resetForTest() {
  state = { ...initial };
  listeners.forEach((l) => l());
}
