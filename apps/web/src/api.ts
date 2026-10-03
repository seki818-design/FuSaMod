import type { ProjectAnalysis, SafetyData } from "@fusamod/analysis";
import type { ElementGraph } from "@fusamod/sysml-graph";

export interface Diagnostic {
  severity: string;
  line?: number;
  column?: number;
  message: string;
}

export interface ProjectView {
  id: string;
  revision: number;
  model: string;
  safety: SafetyData;
  sysmlMode: "java" | "snapshot";
  diagnostics: Diagnostic[];
  modelOk: boolean;
  sysmlError?: string;
  analysis: ProjectAnalysis | null;
  graph: ElementGraph | null;
}

export interface RevisionMeta {
  revision: number;
  ts: string;
  actor: string;
  message: string;
  kind: "model" | "safety" | "restore" | "create";
}

export interface Citation {
  source: string;
  lines?: [number, number];
  quote: string;
}

export interface Operation {
  op: string;
  [k: string]: unknown;
}

export interface Proposal {
  id: string;
  title: string;
  rationale: string;
  operations: Operation[];
  citations: Citation[];
  status: "pending" | "applied" | "rejected";
  createdAt: string;
  decidedBy?: string;
  provider: { name: string; model?: string };
}

export interface ChatResult {
  reply: string;
  citations: Citation[];
  proposals: Proposal[];
  dropped?: string[];
  provider: { name: string; model?: string };
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: string[]) {
    super(message);
  }
}

let token: string | undefined;
try {
  token = sessionStorage.getItem("fusamod.token") ?? undefined;
} catch {
  /* 保存できない環境では、メモリのみ */
}
export function setToken(t: string | undefined) {
  token = t;
  try {
    if (t) sessionStorage.setItem("fusamod.token", t);
    else sessionStorage.removeItem("fusamod.token");
  } catch {
    /* 無視 */
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, "サーバーに接続できません。サーバーが起動しているか確認してください。");
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const d = data as { error?: string; details?: unknown } | undefined;
    throw new ApiError(res.status, d?.error ?? `エラーが発生しました(HTTP ${res.status})`, Array.isArray(d?.details) ? (d!.details as string[]) : undefined);
  }
  return data as T;
}

const P = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const api = {
  health: () => req<{ status: string; sysml: string; ai: string; authRequired: boolean }>("GET", "/api/health"),
  projects: () => req<{ projects: { id: string; revision: number; updated?: string }[] }>("GET", "/api/projects"),
  create: (id: string) => req<{ id: string }>("POST", "/api/projects", { id }),
  get: (id: string) => req<ProjectView>("GET", P(id)),
  analyze: (id: string, body: { model?: string; safety?: SafetyData }) => req<ProjectView>("POST", `${P(id)}/analyze`, body),
  saveModel: (id: string, text: string, baseRevision: number, message?: string) => req<ProjectView>("PUT", `${P(id)}/model`, { text, baseRevision, ...(message ? { message } : {}) }),
  saveSafety: (id: string, data: SafetyData, baseRevision: number, message?: string) => req<ProjectView>("PUT", `${P(id)}/safety`, { data, baseRevision, ...(message ? { message } : {}) }),
  history: (id: string) => req<{ history: RevisionMeta[] }>("GET", `${P(id)}/history`),
  restore: (id: string, rev: number) => req<ProjectView>("POST", `${P(id)}/history/${rev}/restore`),
  refs: (id: string) => req<{ refs: { name: string; text: string }[] }>("GET", `${P(id)}/refs`),
  chat: (id: string, message: string) => req<ChatResult>("POST", `${P(id)}/ai/chat`, { message }),
  proposals: (id: string) => req<{ proposals: Proposal[] }>("GET", `${P(id)}/ai/proposals`),
  apply: (id: string, pid: string) => req<ProjectView & { proposal: Proposal }>("POST", `${P(id)}/ai/proposals/${encodeURIComponent(pid)}/apply`),
  reject: (id: string, pid: string) => req<{ proposal: Proposal }>("POST", `${P(id)}/ai/proposals/${encodeURIComponent(pid)}/reject`),
  audit: (id: string) => req<{ events: { ts: string; actor: string; action: string }[]; chain: { ok: boolean; lines: number; brokenAtLine?: number } }>("GET", `${P(id)}/audit`),
};

/** 認証が必要なエンドポイントからのダウンロード(ヘッダにトークンを付けるため、fetch で取得して保存する)。 */
export async function download(id: string, name: string, query = ""): Promise<void> {
  const res = await fetch(`${P(id)}/export/${name}${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let msg = `出力に失敗しました(HTTP ${res.status})`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* 既定のメッセージ */
    }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
