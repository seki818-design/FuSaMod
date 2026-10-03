import { afterEach, describe, expect, it } from "vitest";
import type { Proposal } from "@fusamod/ai";
import { importSysml, validateScdl } from "@fusamod/scdl";
import { harness, type Harness } from "./helpers.js";

let h: Harness;
afterEach(async () => h?.close());
const json = (r: { body: string }) => JSON.parse(r.body);

describe("基本とプロジェクト", () => {
  it("health / 一覧 / 取得(解析つき)", async () => {
    h = await harness();
    expect(json(await h.app.inject("/api/health"))).toMatchObject({ status: "ok", sysml: "snapshot", ai: "rule-based", authRequired: false });
    expect(json(await h.app.inject("/api/projects")).projects.map((p: { id: string }) => p.id)).toEqual(["ev-powertrain"]);
    const r = await h.app.inject("/api/projects/ev-powertrain");
    expect(r.statusCode).toBe(200);
    const v = json(r);
    expect(v.modelOk).toBe(true);
    expect(v.analysis.summary.errors).toBe(0);
    expect(v.analysis.puzzle.levels).toHaveLength(4);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
  });

  it("存在しないプロジェクトは 404、不正な ID は 400(パストラバーサル対策)", async () => {
    h = await harness();
    expect((await h.app.inject("/api/projects/nope")).statusCode).toBe(404);
    for (const bad of ["..%2F..%2Fetc", "..", "A_B", "x".repeat(65), "%2e%2e"]) {
      const r = await h.app.inject(`/api/projects/${bad}`);
      expect([400, 404]).toContain(r.statusCode);
      expect(r.body).not.toContain("root:");
    }
    expect((await h.app.inject({ method: "POST", url: "/api/projects", payload: { id: "../x" } })).statusCode).toBe(400);
  });

  it("プロジェクトを作成できる(重複は 409)", async () => {
    h = await harness();
    const c = await h.app.inject({ method: "POST", url: "/api/projects", payload: { id: "new-1" } });
    expect(c.statusCode).toBe(201);
    expect((await h.app.inject({ method: "POST", url: "/api/projects", payload: { id: "new-1" } })).statusCode).toBe(409);
    expect((await h.app.inject({ method: "POST", url: "/api/projects", payload: { id: "bad", extra: 1 } })).statusCode).toBe(400);
  });
});

describe("認証と監査", () => {
  it("トークンを設定すると認証が必要になり、操作者が記録される", async () => {
    h = await harness({ env: { FUSAMOD_TOKENS: "alice:tok-alice-0123456789,bob:tok-bob-0123456789abc" } });
    expect((await h.app.inject("/api/projects")).statusCode).toBe(401);
    expect((await h.app.inject({ url: "/api/projects", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    expect((await h.app.inject("/api/health")).statusCode).toBe(200);
    const auth = { authorization: "Bearer tok-bob-0123456789abc" };
    const p = json(await h.app.inject({ url: "/api/projects/ev-powertrain", headers: auth }));
    const put = await h.app.inject({ method: "PUT", url: "/api/projects/ev-powertrain/safety", headers: auth, payload: { data: p.safety, message: "bob の更新" } });
    expect(put.statusCode).toBe(200);
    const events = json(await h.app.inject({ url: "/api/projects/ev-powertrain/audit", headers: auth })).events;
    expect(events.at(-1)).toMatchObject({ actor: "bob", action: "safety.save" });
    const hist = json(await h.app.inject({ url: "/api/projects/ev-powertrain/history", headers: auth })).history;
    expect(hist[0]).toMatchObject({ actor: "bob", message: "bob の更新" });
  });
  it("トークンの設定が不正なら起動時に失敗する", async () => {
    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig({ FUSAMOD_TOKENS: "novalue" })).toThrow(/ユーザー名/);
    expect(() => loadConfig({ FUSAMOD_SYSML: "x" })).toThrow();
  });
});

describe("保存・競合・履歴", () => {
  it("安全データの保存で版が進み、古い版を基にした更新は 409", async () => {
    h = await harness();
    const p = json(await h.app.inject("/api/projects/ev-powertrain"));
    const ok = await h.app.inject({ method: "PUT", url: "/api/projects/ev-powertrain/safety", payload: { data: p.safety, baseRevision: p.revision } });
    expect(ok.statusCode).toBe(200);
    expect(json(ok).revision).toBe(p.revision + 1);
    const stale = await h.app.inject({ method: "PUT", url: "/api/projects/ev-powertrain/safety", payload: { data: p.safety, baseRevision: p.revision } });
    expect(stale.statusCode).toBe(409);
    expect(json(stale).error).toContain("競合");
  });

  it("不正な安全データは 400 でパスつきのエラーを返し、何も保存しない", async () => {
    h = await harness();
    const p = json(await h.app.inject("/api/projects/ev-powertrain"));
    const bad = structuredClone(p.safety);
    bad.hara.events[0].severity = 9;
    const r = await h.app.inject({ method: "PUT", url: "/api/projects/ev-powertrain/safety", payload: { data: bad } });
    expect(r.statusCode).toBe(400);
    expect(json(r).details.join()).toContain("hara.events.0.severity");
    expect(json(await h.app.inject("/api/projects/ev-powertrain")).revision).toBe(p.revision);
    expect((await h.app.inject({ method: "PUT", url: "/api/projects/ev-powertrain/safety", payload: { data: p.safety, junk: 1 } })).statusCode).toBe(400);
  });

  it("履歴の一覧・参照・復元(復元も履歴に残る)", async () => {
    h = await harness();
    const p = json(await h.app.inject("/api/projects/ev-powertrain"));
    const changed = structuredClone(p.safety);
    changed.hara.goals[0].text = "変更後の安全目標";
    await h.app.inject({ method: "PUT", url: "/api/projects/ev-powertrain/safety", payload: { data: changed, message: "目標を変更" } });
    const hist = json(await h.app.inject("/api/projects/ev-powertrain/history")).history;
    expect(hist.map((x: { message: string }) => x.message).slice(0, 2)).toEqual(["目標を変更", "初期"]);
    const old = json(await h.app.inject(`/api/projects/ev-powertrain/history/${hist[1].revision}`));
    expect(JSON.parse(old.safety).hara.goals[0].text).not.toBe("変更後の安全目標");
    const rest = await h.app.inject({ method: "POST", url: `/api/projects/ev-powertrain/history/${hist[1].revision}/restore` });
    expect(rest.statusCode).toBe(200);
    expect(json(rest).safety.hara.goals[0].text).not.toBe("変更後の安全目標");
    expect(json(rest).restored.kind).toBe("restore");
    expect(json(await h.app.inject("/api/projects/ev-powertrain/history")).history).toHaveLength(4); // 取り込み・初期・目標を変更・復元
    expect((await h.app.inject("/api/projects/ev-powertrain/history/999")).statusCode).toBe(404);
  });

  it("Java が無い(スナップショット)環境でモデルを編集すると、保存はできるが解析できない旨を返す", async () => {
    h = await harness();
    const p = json(await h.app.inject("/api/projects/ev-powertrain"));
    const r = await h.app.inject({ method: "PUT", url: "/api/projects/ev-powertrain/model", payload: { text: p.model + "\n// 変更\n" } });
    expect(r.statusCode).toBe(200);
    const v = json(r);
    expect(v.modelOk).toBe(false);
    expect(v.sysmlError).toContain("Java");
    expect(v.analysis).toBeNull();
    // エクスポートと AI は、解析できないモデルでは 409
    expect((await h.app.inject("/api/projects/ev-powertrain/export/fmea.csv")).statusCode).toBe(409);
    expect((await h.app.inject({ method: "POST", url: "/api/projects/ev-powertrain/ai/chat", payload: { message: "要約" } })).statusCode).toBe(409);
    // 元に戻せば解析できる
    const hist = json(await h.app.inject("/api/projects/ev-powertrain/history")).history;
    await h.app.inject({ method: "POST", url: `/api/projects/ev-powertrain/history/${hist[1].revision}/restore` });
    expect(json(await h.app.inject("/api/projects/ev-powertrain")).modelOk).toBe(true);
  });

  it("復元したモデルは、サーバーを再起動した後(キャッシュが空)でも、Java 無しで解析できる", async () => {
    h = await harness();
    const p = json(await h.app.inject("/api/projects/ev-powertrain"));
    await h.app.inject({ method: "PUT", url: "/api/projects/ev-powertrain/model", payload: { text: p.model + "\n// 変更\n" } });
    const hist = json(await h.app.inject("/api/projects/ev-powertrain/history")).history;
    await h.app.inject({ method: "POST", url: `/api/projects/ev-powertrain/history/${hist[1].revision}/restore` });
    // 再起動を模す: 同じ保存先に、空のキャッシュで新しいアプリを立てる
    const { buildApp } = await import("../src/app.js");
    const { AnalysisService } = await import("../src/services.js");
    const { SnapshotSysmlService } = await import("../src/sysml/snapshot-service.js");
    const { RuleBasedProvider } = await import("@fusamod/ai");
    const app2 = await buildApp({ config: h.config, store: h.store, analysis: new AnalysisService(new SnapshotSysmlService((x) => h.store.findGraphByModelHash(x))), ai: new RuleBasedProvider() });
    const v = json(await app2.inject("/api/projects/ev-powertrain"));
    expect(v.modelOk).toBe(true);
    expect(v.analysis.summary.errors).toBe(0);
    await app2.close();
  });

  it("大きすぎるリクエストは 413", async () => {
    h = await harness();
    const r = await h.app.inject({ method: "PUT", url: "/api/projects/ev-powertrain/model", payload: { text: "x".repeat(6 * 1024 * 1024) } });
    expect(r.statusCode).toBe(413);
  });
});

describe("エクスポート", () => {
  it("FMEA・トレース・指摘の CSV は BOM 付きの添付ファイル", async () => {
    h = await harness();
    for (const name of ["fmea.csv", "trace.csv", "issues.csv"]) {
      const r = await h.app.inject(`/api/projects/ev-powertrain/export/${name}`);
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-disposition"]).toBe(`attachment; filename="ev-powertrain-${name}"`);
      expect(r.body.startsWith("﻿")).toBe(true);
    }
    const one = await h.app.inject("/api/projects/ev-powertrain/export/fmea.csv?element=EvPowertrainDemo::vehicle::powertrain::motor");
    expect(one.body.split("\r\n").filter(Boolean).length).toBeLessThan((await h.app.inject("/api/projects/ev-powertrain/export/fmea.csv")).body.split("\r\n").filter(Boolean).length);
  });
  it("レポートと SCDL ビューの SysML(読み戻せて、検証を通る)", async () => {
    h = await harness();
    expect((await h.app.inject("/api/projects/ev-powertrain/export/report.md")).body).toContain("# ev-powertrain 安全分析レポート");
    const s = await h.app.inject("/api/projects/ev-powertrain/export/scdl.sysml");
    expect(s.statusCode).toBe(200);
    expect(s.body).toContain("@ScdlRequirementGroup".replace("@", "")); // メタデータ型の使用
    const { model, issues } = importSysml(s.body);
    expect(issues).toEqual([]);
    expect(validateScdl(model).filter((i) => i.severity === "error")).toEqual([]);
    expect(model.groupPairings).toHaveLength(1);
  });
  it("参照資料の一覧", async () => {
    h = await harness();
    const refs = json(await h.app.inject("/api/projects/ev-powertrain/refs")).refs;
    expect(refs.map((r: { name: string }) => r.name).sort()).toEqual(["システム設計方針.md", "機能安全コンセプト.md"]);
  });
  it("モデルのソース、解析結果の JSON、不明な出力", async () => {
    h = await harness();
    expect((await h.app.inject("/api/projects/ev-powertrain/export/model.sysml")).body).toContain("package EvPowertrainDemo");
    expect(json(await h.app.inject("/api/projects/ev-powertrain/export/analysis.json")).summary.errors).toBe(0);
    expect((await h.app.inject("/api/projects/ev-powertrain/export/..%2Fsafety.json")).statusCode).toBe(404);
    expect((await h.app.inject("/api/projects/ev-powertrain/export/nope")).statusCode).toBe(404);
  });
});

describe("AI アシスタント(提案 → 承認)", () => {
  const chat = (message: string) => h.app.inject({ method: "POST", url: "/api/projects/ev-powertrain/ai/chat", payload: { message } });

  it("提案は承認するまでデータを変えず、承認で適用され、監査ログに残る", async () => {
    h = await harness({ env: { FUSAMOD_TOKENS: "alice:t1-0123456789abcdef,bob:t2-0123456789abcdef" } });
    const A = { authorization: "Bearer t1-0123456789abcdef" };
    const B = { authorization: "Bearer t2-0123456789abcdef" };
    const c = await h.app.inject({ method: "POST", url: "/api/projects/ev-powertrain/ai/chat", headers: A, payload: { message: "safetyMonitor の FMEA を実施して" } });
    expect(c.statusCode).toBe(200);
    const proposal: Proposal = json(c).proposals[0];
    expect(proposal.status).toBe("pending");
    const before = json(await h.app.inject({ url: "/api/projects/ev-powertrain", headers: A }));
    expect(before.safety.failures.some((f: { id: string }) => f.id === "AI-FM-001")).toBe(false);

    const ap = await h.app.inject({ method: "POST", url: `/api/projects/ev-powertrain/ai/proposals/${proposal.id}/apply`, headers: B });
    expect(ap.statusCode).toBe(200);
    expect(json(ap).proposal).toMatchObject({ status: "applied", decidedBy: "bob" });
    expect(json(ap).safety.failures.some((f: { id: string }) => f.id === "AI-FM-001")).toBe(true);
    expect(json(ap).revision).toBe(before.revision + 1);

    // 二重の適用は 409
    expect((await h.app.inject({ method: "POST", url: `/api/projects/ev-powertrain/ai/proposals/${proposal.id}/apply`, headers: B })).statusCode).toBe(409);
    const events = json(await h.app.inject({ url: "/api/projects/ev-powertrain/audit", headers: A })).events.map((e: { action: string; actor: string }) => `${e.actor}:${e.action}`);
    expect(events).toEqual(expect.arrayContaining(["alice:ai.chat", "bob:ai.apply"]));
    const hist = json(await h.app.inject({ url: "/api/projects/ev-powertrain/history", headers: A })).history;
    expect(hist[0].message).toContain("AI 提案を適用");
  });

  it("却下できる。却下した提案は適用できない", async () => {
    h = await harness();
    const p: Proposal = json(await chat("safetyMonitor の FMEA")).proposals[0];
    expect((await h.app.inject({ method: "POST", url: `/api/projects/ev-powertrain/ai/proposals/${p.id}/reject` })).statusCode).toBe(200);
    expect((await h.app.inject({ method: "POST", url: `/api/projects/ev-powertrain/ai/proposals/${p.id}/apply` })).statusCode).toBe(409);
    const list = json(await h.app.inject("/api/projects/ev-powertrain/ai/proposals")).proposals;
    expect(list[0].status).toBe("rejected");
    expect((await h.app.inject({ method: "POST", url: "/api/projects/ev-powertrain/ai/proposals/P-none/apply" })).statusCode).toBe(404);
  });

  it("適用すると新しいエラーが生じる提案は、承認されても適用しない(データは変わらない)", async () => {
    h = await harness();
    const evil: Proposal = {
      id: "P-evil", title: "階層を飛び越えるリンク", rationale: "", citations: [], status: "pending", createdAt: new Date().toISOString(), provider: { name: "claude" },
      operations: [{ op: "addLink", link: { id: "LX", causeId: "FC-GD-1", effectId: "FE-1", occurrence: 1, detection: 1 } }],
    };
    await h.store.updateProposals<Proposal, void>("ev-powertrain", (l) => ({ list: [...l, evil], result: undefined }));
    const r = await h.app.inject({ method: "POST", url: "/api/projects/ev-powertrain/ai/proposals/P-evil/apply" });
    expect(r.statusCode).toBe(422);
    expect(json(r).details.join()).toContain("LINK_LEVEL");
    const after = json(await h.app.inject("/api/projects/ev-powertrain"));
    expect(after.safety.links.some((l: { id: string }) => l.id === "LX")).toBe(false);
    expect(json(await h.app.inject("/api/projects/ev-powertrain/ai/proposals")).proposals[0].status).toBe("pending");
  });

  it("参照資料に根拠があれば出典つき、AI へのリクエストには上限がある", async () => {
    h = await harness();
    const r = json(await chat("安全状態は何ですか"));
    expect(r.citations[0].source).toMatch(/\.md$/);
    expect((await h.app.inject({ method: "POST", url: "/api/projects/ev-powertrain/ai/chat", payload: { message: "" } })).statusCode).toBe(400);
    let last = 200;
    for (let i = 0; i < 21; i++) last = (await chat("要約")).statusCode;
    expect(last).toBe(429);
  });

  it("AI プロバイダの失敗は、内部情報を含まない形で返す", async () => {
    const { AiProviderError } = await import("@fusamod/ai");
    h = await harness({ ai: { name: "x", propose: async () => { throw new AiProviderError("AI サービスのリクエスト制限に達しました。", true); } } });
    const r = await chat("要約");
    expect(r.statusCode).toBe(503);
    expect(json(r).error).toContain("リクエスト制限");
    h.close();
    h = await harness({ ai: { name: "x", propose: async () => { throw new Error("secret stack sk-ant-xxx"); } } });
    const r2 = await chat("要約");
    expect(r2.statusCode).toBe(500);
    expect(r2.body).not.toContain("sk-ant");
  });
});

describe("認証の堅牢性・役割", () => {
  it("FUSAMOD_TOKENS の書式: ユーザー名:トークン。短い・重複・不正な書式は起動時に拒否", async () => {
    const { parseTokens } = await import("../src/config.js");
    expect(parseTokens("alice:0123456789abcdef0,bob/viewer:abcdef0123456789x")).toEqual([
      { user: "alice", role: "editor", token: "0123456789abcdef0" },
      { user: "bob", role: "viewer", token: "abcdef0123456789x" },
    ]);
    expect(() => parseTokens("alice:short")).toThrow(/16 文字以上/);
    expect(() => parseTokens("alice:0123456789abcdef0,bob:0123456789abcdef0")).toThrow(/同じトークン/);
    expect(() => parseTokens("alice:0123456789abcdef0,alice:abcdef0123456789x")).toThrow(/重複/);
    expect(() => parseTokens("alice/root:0123456789abcdef0")).toThrow(/ユーザー名/);
    expect(() => parseTokens(":0123456789abcdef0")).toThrow();
  });
  it("秘密のトークンが利用者名として監査ログに残らない(書式の取り違えの回帰)", async () => {
    h = await harness({ env: { FUSAMOD_TOKENS: "alice:tok-alice-0123456789" } });
    const auth = { authorization: "Bearer tok-alice-0123456789" };
    const p = json(await h.app.inject({ url: "/api/projects/ev-powertrain", headers: auth }));
    await h.app.inject({ method: "PUT", url: "/api/projects/ev-powertrain/safety", headers: auth, payload: { data: p.safety } });
    const events = json(await h.app.inject({ url: "/api/projects/ev-powertrain/audit", headers: auth })).events;
    expect(JSON.stringify(events)).not.toContain("tok-alice");
    expect(events.at(-1).actor).toBe("alice");
  });
  it("読み取り専用の役割は、保存できないが、読み取りと解析はできる", async () => {
    h = await harness({ env: { FUSAMOD_TOKENS: "vera/viewer:tok-viewer-0123456789" } });
    const auth = { authorization: "Bearer tok-viewer-0123456789" };
    const p = json(await h.app.inject({ url: "/api/projects/ev-powertrain", headers: auth }));
    expect((await h.app.inject({ method: "PUT", url: "/api/projects/ev-powertrain/safety", headers: auth, payload: { data: p.safety } })).statusCode).toBe(403);
    expect((await h.app.inject({ method: "POST", url: "/api/projects", headers: auth, payload: { id: "x1" } })).statusCode).toBe(403);
    expect((await h.app.inject({ method: "POST", url: "/api/projects/ev-powertrain/analyze", headers: auth, payload: { safety: p.safety } })).statusCode).toBe(200);
  });
  it("認証の失敗が続くと 429 になる(総当たり対策)", async () => {
    h = await harness({ env: { FUSAMOD_TOKENS: "alice:tok-alice-0123456789" } });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await h.app.inject({ url: "/api/projects", headers: { authorization: `Bearer wrong-${i}` } })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    // 正しいトークンは、失敗の制限とは別に通る
    expect((await h.app.inject({ url: "/api/projects", headers: { authorization: "Bearer tok-alice-0123456789" } })).statusCode).toBe(200);
  });
});

describe("viewer の権限(クエリ・パスの迂回の回帰)", () => {
  it("URL にクエリや末尾の /analyze を足しても、書き込み系は 403", async () => {
    h = await harness({ env: { FUSAMOD_TOKENS: "vera/viewer:tok-viewer-0123456789" } });
    const auth = { authorization: "Bearer tok-viewer-0123456789" };
    const p = json(await h.app.inject({ url: "/api/projects/ev-powertrain", headers: auth }));
    const tries: [string, string, unknown][] = [
      ["POST", "/api/projects?x=/analyze", { id: "x2" }],
      ["POST", "/api/projects/ev-powertrain/history/1/restore?x=/analyze", undefined],
      ["POST", "/api/projects/ev-powertrain/ai/chat?/analyze", { message: "FMEA を実施して" }],
      ["PUT", "/api/projects/ev-powertrain/safety?a=/analyze", { data: p.safety }],
      ["POST", "/api/projects/ev-powertrain/ai/proposals/x/apply?/analyze", undefined],
    ];
    for (const [method, url, payload] of tries) {
      const r = await h.app.inject({ method: method as "POST" | "PUT", url, headers: auth, ...(payload ? { payload } : {}) });
      expect([method, url, r.statusCode]).toEqual([method, url, 403]);
    }
    expect((await h.app.inject({ method: "POST", url: "/api/projects/ev-powertrain/analyze?x=1", headers: auth, payload: { safety: p.safety } })).statusCode).toBe(200);
  });
});

describe("/api/me", () => {
  it("利用者名と役割を返す(認証なしのローカルは local / editor)", async () => {
    h = await harness();
    expect(json(await h.app.inject("/api/me"))).toEqual({ user: "local", role: "editor" });
    const h2 = await harness({ env: { FUSAMOD_TOKENS: "vera/viewer:tok-viewer-0123456789" } });
    expect(json(await h2.app.inject({ url: "/api/me", headers: { authorization: "Bearer tok-viewer-0123456789" } }))).toEqual({ user: "vera", role: "viewer" });
    await h2.close();
  });
});

describe("AI の来歴と承認者の分離", () => {
  const chatOf = (hdr: Record<string, string>) => h.app.inject({ method: "POST", url: "/api/projects/ev-powertrain/ai/chat", headers: hdr, payload: { message: "safetyMonitor の FMEA を実施して" } });
  it("適用すると、提案者・承認者・時刻が safety.json に残る", async () => {
    h = await harness({ env: { FUSAMOD_TOKENS: "alice:t1-0123456789abcdef,bob:t2-0123456789abcdef" } });
    const A = { authorization: "Bearer t1-0123456789abcdef" };
    const B = { authorization: "Bearer t2-0123456789abcdef" };
    const proposal: Proposal = json(await chatOf(A)).proposals[0];
    expect(proposal.requestedBy).toBe("alice");
    const ap = await h.app.inject({ method: "POST", url: `/api/projects/ev-powertrain/ai/proposals/${proposal.id}/apply`, headers: B });
    expect(ap.statusCode).toBe(200);
    const s = json(await h.app.inject({ url: "/api/projects/ev-powertrain", headers: B })).safety;
    expect(s.aiChanges.at(-1)).toMatchObject({ proposalId: proposal.id, requestedBy: "alice", approvedBy: "bob" });
  });
  it("FUSAMOD_AI_SEPARATE_APPROVER=1 なら、依頼した本人は承認できない", async () => {
    h = await harness({ env: { FUSAMOD_TOKENS: "alice:t1-0123456789abcdef,bob:t2-0123456789abcdef", FUSAMOD_AI_SEPARATE_APPROVER: "1" } });
    const A = { authorization: "Bearer t1-0123456789abcdef" };
    const B = { authorization: "Bearer t2-0123456789abcdef" };
    const proposal: Proposal = json(await chatOf(A)).proposals[0];
    const self = await h.app.inject({ method: "POST", url: `/api/projects/ev-powertrain/ai/proposals/${proposal.id}/apply`, headers: A });
    expect(self.statusCode).toBe(403);
    expect((await h.app.inject({ method: "POST", url: `/api/projects/ev-powertrain/ai/proposals/${proposal.id}/apply`, headers: B })).statusCode).toBe(200);
  });
});

describe("SCDL の書き出し", () => {
  it("SCDL にエラーがあるとき(存在しない要素への配置)は、書き出しを拒否する", async () => {
    h = await harness();
    const p = json(await h.app.inject("/api/projects/ev-powertrain"));
    const ok = await h.app.inject("/api/projects/ev-powertrain/export/scdl.sysml");
    expect(ok.statusCode).toBe(200);
    const bad = structuredClone(p.safety);
    bad.mechanisms[0].elementId = "NOPE::nowhere";
    await h.app.inject({ method: "PUT", url: "/api/projects/ev-powertrain/safety", payload: { data: bad } });
    const r = await h.app.inject("/api/projects/ev-powertrain/export/scdl.sysml");
    expect(r.statusCode).toBe(409);
  });
});

describe("認証・役割は、URL の書き方によらず同じ規則で働く(表駆動)", () => {
  const spellings = [
    "/api/projects",
    "/%61pi/projects",
    "/a%70i/projects",
    "/%41PI/projects",
    "/api/%70rojects",
    "//api/projects",
    "/./api/projects",
    "/api/./projects",
    "/api/projects/",
    "/api/projects?x=/analyze",
    "/%2561pi/projects",
  ];
  it("トークンなしでは、どの書き方でも API に到達できない(401/404/400 のいずれか。200/201 は不可)", async () => {
    h = await harness({ env: { FUSAMOD_TOKENS: "alice:tok-alice-0123456789" } });
    for (const method of ["GET", "POST", "PUT", "DELETE"] as const) {
      for (const u of spellings) {
        const r = await h.app.inject({ method, url: u, ...(method === "POST" || method === "PUT" ? { payload: { id: "evil1" } } : {}) });
        expect([method, u, r.statusCode < 200 || r.statusCode >= 300]).toEqual([method, u, true]);
      }
    }
    // 悪用の結果、プロジェクトが作られていない
    const ok = await h.app.inject({ url: "/api/projects", headers: { authorization: "Bearer tok-alice-0123456789" } });
    expect(JSON.stringify(json(ok))).not.toContain("evil1");
  });
  it("viewer は、どの書き方でも書き込めない", async () => {
    h = await harness({ env: { FUSAMOD_TOKENS: "vera/viewer:tok-viewer-0123456789" } });
    const auth = { authorization: "Bearer tok-viewer-0123456789" };
    for (const u of spellings) {
      for (const method of ["POST", "PUT", "DELETE"] as const) {
        const r = await h.app.inject({ method, url: u, headers: auth, payload: { id: "evil2" } });
        expect([method, u, r.statusCode < 200 || r.statusCode >= 300]).toEqual([method, u, true]);
      }
    }
    const list = json(await h.app.inject({ url: "/api/projects", headers: auth }));
    expect(JSON.stringify(list)).not.toContain("evil2");
  });
  it("認証の失敗は、書き方を変えても同じ制限(429)にかかる", async () => {
    h = await harness({ env: { FUSAMOD_TOKENS: "alice:tok-alice-0123456789" } });
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await h.app.inject({ url: i % 2 ? "/%61pi/projects" : "/api/projects", headers: { authorization: `Bearer wrong-${i}` } })).statusCode);
    expect(codes.slice(10).every((c) => c === 429)).toBe(true);
  });
  it("health だけは認証なしで見られる", async () => {
    h = await harness({ env: { FUSAMOD_TOKENS: "alice:tok-alice-0123456789" } });
    expect((await h.app.inject("/api/health")).statusCode).toBe(200);
  });
});
