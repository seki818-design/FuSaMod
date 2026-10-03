import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeProject } from "@fusamod/analysis";
import { graph, safety } from "./helpers.js";
import * as store from "../src/store.js";
import { setToken } from "../src/api.js";

/** メモリ上の疑似サーバー。fetch を差し替えて、ストアの振る舞いだけを検証する。 */
function fakeServer(opts: { authRequired?: boolean; conflictOnSave?: boolean } = {}) {
  const g = graph();
  const s = safety();
  let revision = 1;
  let model = "package P {}";
  const calls: string[] = [];
  const view = () => ({
    id: "demo", revision, model, safety: s, sysmlMode: "snapshot", diagnostics: [], modelOk: true, analysis: analyzeProject(g, s), graph: g,
  });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const handler = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
    if (opts.authRequired && auth !== "Bearer ok") return json(401, { error: "認証が必要です" });
    if (url === "/api/health") return json(200, { status: "ok", sysml: "snapshot", ai: "rule", authRequired: !!opts.authRequired });
    if (url === "/api/projects") return json(200, { projects: [{ id: "demo", revision }] });
    if (url === "/api/projects/demo" && method === "GET") return json(200, view());
    if (url.endsWith("/history")) return json(200, { history: [] });
    if (url.endsWith("/audit")) return json(200, { events: [], chain: { ok: true, lines: 0 } });
    if (url.endsWith("/ai/proposals")) return json(200, { proposals: [] });
    if (url.endsWith("/refs")) return json(200, { refs: [] });
    if (url.endsWith("/model") && method === "PUT") {
      if (opts.conflictOnSave) return json(409, { error: "他の人が先に更新しました" });
      model = JSON.parse(String(init?.body)).text;
      revision++;
      return json(200, view());
    }
    return json(404, { error: "not found" });
  };
  return { handler, calls, get revision() { return revision; } };
}

function install(srv: ReturnType<typeof fakeServer>) {
  vi.stubGlobal("fetch", vi.fn((u: string, i?: RequestInit) => srv.handler(u, i)));
  vi.stubGlobal("location", { search: "" });
}

beforeEach(() => {
  store.resetForTest();
  setToken(undefined);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("store", () => {
  it("起動すると最初のプロジェクトを開き、先頭の要素を選ぶ", async () => {
    install(fakeServer());
    await store.init();
    const s = store.getState();
    expect(s.ready).toBe(true);
    expect(s.projectId).toBe("demo");
    expect(s.analysis).not.toBeNull();
    expect(s.selectedElementId).toBeDefined();
    expect(store.isDirty(s)).toBe(false);
  });

  it("安全分析データの編集は即時にブラウザ内で再解析され、未保存になる", async () => {
    install(fakeServer());
    await store.init();
    const before = store.getState().analysis!.issues.length;
    store.updateSafety((d) => {
      d.failures.push({ id: "FM-NEW", description: "存在しない機能への故障", functionId: "no::such" } as never);
    });
    const s = store.getState();
    expect(store.isSafetyDirty(s)).toBe(true);
    expect(s.analysis!.issues.length).toBeGreaterThan(before);
    store.discard();
    expect(store.isDirty(store.getState())).toBe(false);
    expect(store.getState().analysis!.issues.length).toBe(before);
  });

  it("モデルを保存するとリビジョンが進み、未保存でなくなる", async () => {
    const srv = fakeServer();
    install(srv);
    await store.init();
    store.setDraftModel("package P { part x; }");
    expect(store.isModelDirty(store.getState())).toBe(true);
    await store.save("テスト");
    expect(srv.revision).toBe(2);
    expect(store.isDirty(store.getState())).toBe(false);
    expect(store.getState().toasts.at(-1)?.kind).toBe("success");
  });

  it("保存の競合(409)は、エラーとして通知され、編集内容は失われない", async () => {
    install(fakeServer({ conflictOnSave: true }));
    await store.init();
    store.setDraftModel("package P { part y; }");
    await store.save();
    const s = store.getState();
    expect(s.toasts.at(-1)?.kind).toBe("error");
    expect(s.draftModel).toBe("package P { part y; }");
    expect(s.busy.saving).toBe(false);
  });

  it("認証が必要なら、ログインを促し、トークン入力後に開く", async () => {
    install(fakeServer({ authRequired: true }));
    await store.init();
    expect(store.getState().needLogin).toBe(true);
    await store.login("ok");
    expect(store.getState().needLogin).toBe(false);
    expect(store.getState().projectId).toBe("demo");
  });

  it("サーバーに接続できない場合は、分かりやすいエラーを出す", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("net"))));
    vi.stubGlobal("location", { search: "" });
    await store.init();
    const t = store.getState().toasts.at(-1);
    expect(t?.kind).toBe("error");
    expect(t?.text).toContain("接続できません");
  });

  it("階層間の整合性チェックの切り替えで、パズルの指摘件数が変わりうる", async () => {
    install(fakeServer());
    await store.init();
    const on = store.puzzleOf(store.getState());
    store.setLayerConsistency(false);
    const off = store.puzzleOf(store.getState());
    expect(on).toBeDefined();
    expect(off).toBeDefined();
    const total = (p: NonNullable<typeof on>) => Object.values(p.cells).flatMap((r) => Object.values(r)).reduce((n, c) => n + c.errors + c.warnings, 0);
    expect(total(off!)).toBeLessThanOrEqual(total(on!));
  });
});
