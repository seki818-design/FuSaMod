import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { ZodError, z } from "zod";
import {
  fmeaCsv,
  issuesCsv,
  reportMarkdown,
  traceCsv,
  type ProjectAnalysis,
} from "@fusamod/analysis";
import {
  AiProviderError,
  RefIndex,
  applyOperations,
  type AiProvider,
  type Proposal,
} from "@fusamod/ai";
import { exportSysml, ScdlSysmlError } from "@fusamod/scdl";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { HttpError, ProjectStore } from "./projects.js";
import { AnalysisService, requireSafety } from "./services.js";
import { SysmlUnavailableError } from "./sysml/types.js";

export interface AppDeps {
  config: Config;
  store: ProjectStore;
  analysis: AnalysisService;
  ai: AiProvider;
  logger?: boolean | object;
}

const sha = (s: string) => createHash("sha256").update(s).digest();

/** トークンを定数時間で照合し、ユーザーを返す。 */
function authenticate(tokens: Config["tokens"], header: string | undefined): Config["tokens"][number] | undefined {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!m) return undefined;
  const given = sha(m[1]!);
  let found: Config["tokens"][number] | undefined;
  for (const t of tokens) if (timingSafeEqual(given, sha(t.token))) found = t; // 全件を比較する
  return found;
}

/** 読み取り専用の役割でも使える操作(解析のみ。保存しない)。 */
/**
 * リクエストの URL を、ルーターが解釈するのと同じ形(パーセントエンコードを戻し、./ や // を畳んだパス)にする。
 * 認証・役割の判定は、生の URL ではなく、この正規化したパスで行う(/%61pi/... で認証を回避されないように)。
 * 解釈できない URL は null(拒否する)。
 */
export function normalizedPath(url: string): string | null {
  try {
    let path = new URL(url, "http://localhost").pathname;
    for (let i = 0; i < 4; i++) {
      const next = decodeURIComponent(path);
      if (next === path) break;
      path = next;
    }
    return path.replace(/\/{2,}/g, "/").toLowerCase();
  } catch {
    return null;
  }
}
const isApiPath = (path: string) => path === "/api" || path.startsWith("/api/");
const isHealth = (path: string) => path === "/api/health" || path === "/api/health/";
const readOnlyOk = (method: string, path: string) =>
  method === "GET" || method === "HEAD" || (method === "POST" && /^\/api\/projects\/[^/]+\/analyze\/?$/.test(path));

class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  allow(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }
}

const idParam = z.object({ id: z.string() });
const revParam = z.object({ id: z.string(), rev: z.coerce.number().int().min(1) });

const DEFAULT_MODEL = (name: string) => `package ${name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1")} {\n    part system;\n}\n`;

function attachment(reply: FastifyReply, filename: string, type: string, body: string) {
  return reply
    .header("Content-Type", `${type}; charset=utf-8`)
    .header("Content-Disposition", `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`)
    .send(body);
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, store, analysis, ai } = deps;
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: config.bodyLimit,
    trustProxy: config.trustProxy as never,
  });
  const aiLimiter = new RateLimiter(20, 60_000);
  let authFailCount = 0;
  const authFailLimiter = new RateLimiter(10, 60_000); // 認証失敗(総当たり対策): 1 分に 10 回まで
  const apiLimiter = new RateLimiter(600, 60_000); // API 全体: 1 分に 600 回まで(利用者または接続元ごと)

  // --- セキュリティヘッダ・CORS ---
  app.addHook("onSend", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    const p = normalizedPath(req.url);
    if (p === null || isApiPath(p)) reply.header("Cache-Control", "no-store");
    if (config.corsOrigin && req.headers.origin === config.corsOrigin) {
      reply.header("Access-Control-Allow-Origin", config.corsOrigin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Headers", "authorization, content-type");
      reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    }
  });
  app.options("/api/*", async (_req, reply) => reply.code(204).send());

  // --- 認証(トークンが設定されている場合) ---
  app.decorateRequest("actor", "local");
  app.addHook("onRequest", async (req, reply) => {
    const path = normalizedPath(req.url);
    if (path === null) return reply.code(400).send({ error: "不正な URL です" });
    // 既定は拒否: API(正規化したパス、またはルーターが選んだルートが /api 配下)は、health 以外すべて認証を通す
    const routePattern = (req.routeOptions?.url ?? "").toLowerCase();
    const api = isApiPath(path) || isApiPath(routePattern);
    if (!api || isHealth(path) || req.method === "OPTIONS") return;
    const r = req as unknown as { actor: string };
    if (config.tokens.length > 0) {
      const found = authenticate(config.tokens, req.headers.authorization);
      if (!found) {
        authFailCount++;
        if (authFailCount <= 20 || authFailCount % 100 === 0) await store.auditGlobal({ actor: "anonymous", action: "auth.fail", details: { ip: req.ip, method: req.method, path: path.slice(0, 200), count: authFailCount } });
        if (!authFailLimiter.allow(req.ip)) return reply.code(429).header("Retry-After", "60").send({ error: "認証の失敗が多すぎます。しばらくしてからやり直してください" });
        return reply.code(401).header("WWW-Authenticate", "Bearer").send({ error: "認証が必要です" });
      }
      r.actor = found.user;
      (req as unknown as { role: string }).role = found.role;
      if (found.role === "viewer" && !readOnlyOk(req.method, path)) return reply.code(403).send({ error: "この利用者は読み取り専用です" });
    }
    if (!apiLimiter.allow(r.actor === "local" ? req.ip : r.actor)) return reply.code(429).header("Retry-After", "60").send({ error: "リクエストが多すぎます" });
  });
  const actorOf = (req: FastifyRequest) => (req as FastifyRequest & { actor: string }).actor;

  // --- エラーの整形 ---
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    if (err instanceof ZodError) return reply.code(400).send({ error: "リクエストが不正です", details: err.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`) });
    if (err instanceof SysmlUnavailableError) return reply.code(503).send({ error: err.message });
    if (err instanceof AiProviderError) return reply.code(err.retryable ? 503 : 502).send({ error: err.message });
    if (err instanceof ScdlSysmlError) return reply.code(422).send({ error: `SCDL を書き出せません: ${err.message}` });
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.statusCode === 413 ? "リクエストが大きすぎます" : "リクエストが不正です" });
    req.log.error({ err }, "内部エラー");
    return reply.code(500).send({ error: "内部エラーが発生しました" });
  });

  const requireAnalysis = async (id: string) => {
    const p = await store.read(id);
    const out = await analysis.analyze(p.model, p.safety, p.graph);
    return { p, out };
  };
  const view = (id: string, p: Awaited<ReturnType<ProjectStore["read"]>>, out: Awaited<ReturnType<AnalysisService["analyze"]>>) => ({
    id,
    revision: p.revision,
    model: p.model,
    safety: p.safety,
    sysmlMode: analysis.mode,
    diagnostics: out.diagnostics,
    modelOk: out.modelOk,
    ...(p.notice ? { notice: p.notice } : {}),
    ...(out.sysmlError ? { sysmlError: out.sysmlError } : {}),
    analysis: out.analysis ?? null,
    /** 解析済みの要素グラフ(画面側で、編集中の安全データを即時に解析するために使う) */
    graph: out.graph ?? null,
  });

  // --- 基本 ---
  app.get("/api/health", async () => ({
    status: "ok",
    sysml: analysis.mode,
    ai: ai.name,
    authRequired: config.tokens.length > 0,
  }));

  app.get("/api/me", async (req) => ({ user: actorOf(req), role: (req as FastifyRequest & { role?: string }).role ?? "editor" }));
  app.get("/api/projects", async () => ({ projects: await store.list() }));

  app.post("/api/projects", async (req, reply) => {
    const body = z.object({ id: z.string(), model: z.string().max(2_000_000).optional() }).strict().parse(req.body);
    await store.create(body.id, body.model ?? DEFAULT_MODEL(body.id), actorOf(req));
    return reply.code(201).send({ id: body.id });
  });

  app.get("/api/projects/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const { p, out } = await requireAnalysis(id);
    return view(id, p, out);
  });

  // 保存せずに解析する(編集中のドラフト)
  app.post("/api/projects/:id/analyze", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ model: z.string().max(2_000_000).optional(), safety: z.unknown().optional() }).strict().parse(req.body ?? {});
    const p = await store.read(id);
    const model = body.model ?? p.model;
    const safety = body.safety !== undefined ? requireSafety(body.safety) : p.safety;
    const out = await analysis.analyze(model, safety, body.model === undefined ? p.graph : undefined);
    return view(id, { ...p, model, safety }, out);
  });

  app.put("/api/projects/:id/model", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ text: z.string().max(2_000_000), baseRevision: z.number().int().optional(), message: z.string().max(200).optional() }).strict().parse(req.body);
    if (Buffer.byteLength(body.text) > 2 * 1024 * 1024) throw new HttpError(413, "モデルが大きすぎます(2MB まで)");
    const p = await store.read(id);
    const out = await analysis.analyze(body.text, p.safety);
    // エラーがあっても下書きとして保存できる(グラフは正常に解析できたときだけ保存)
    const meta = await store.saveModel(id, body.text, actorOf(req), body.message ?? "モデルを更新", body.baseRevision, out.graph);
    return view(id, { ...p, model: body.text, revision: meta.revision }, out);
  });

  app.put("/api/projects/:id/safety", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ data: z.unknown(), baseRevision: z.number().int().optional(), message: z.string().max(200).optional() }).strict().parse(req.body);
    const data = requireSafety(body.data);
    const p = await store.read(id);
    const meta = await store.saveSafety(id, data, actorOf(req), body.message ?? "安全分析データを更新", body.baseRevision);
    const out = await analysis.analyze(p.model, data, p.graph);
    return view(id, { ...p, safety: data, revision: meta.revision }, out);
  });

  // --- 参照資料(RAG の対象。名前と本文) ---
  app.get("/api/projects/:id/refs", async (req) => ({ refs: await store.refs(idParam.parse(req.params).id) }));

  // --- 履歴(バージョン管理) ---
  app.get("/api/projects/:id/history", async (req) => ({ history: await store.history(idParam.parse(req.params).id) }));
  app.get("/api/projects/:id/history/:rev", async (req) => {
    const { id, rev } = revParam.parse(req.params);
    return store.revision(id, rev);
  });
  app.post("/api/projects/:id/history/:rev/restore", async (req) => {
    const { id, rev } = revParam.parse(req.params);
    const meta = await store.restore(id, rev, actorOf(req));
    const { p, out } = await requireAnalysis(id);
    return { restored: meta, ...view(id, p, out) };
  });
  app.get("/api/projects/:id/audit", async (req) => {
    const { id } = idParam.parse(req.params);
    return { events: await store.readAudit(id), chain: await store.verifyAudit(id) };
  });

  // --- エクスポート ---
  const needAnalysis = async (id: string): Promise<ProjectAnalysis> => {
    const { out } = await requireAnalysis(id);
    if (!out.analysis) throw new HttpError(409, "モデルにエラーがあるため、出力できません。モデルのエラーを直してください");
    return out.analysis;
  };
  app.get("/api/projects/:id/export/:name", async (req, reply) => {
    const { id, name } = z.object({ id: z.string(), name: z.string() }).parse(req.params);
    const q = z.object({ element: z.string().optional() }).parse(req.query);
    store.dir(id);
    await store.audit(id, { actor: actorOf(req), action: "export", details: { name: name.slice(0, 50) } });
    switch (name) {
      case "model.sysml": return attachment(reply, `${id}.sysml`, "text/plain", (await store.read(id)).model);
      case "fmea.csv": return attachment(reply, `${id}-fmea.csv`, "text/csv", fmeaCsv(await needAnalysis(id), q.element));
      case "trace.csv": return attachment(reply, `${id}-trace.csv`, "text/csv", traceCsv(await needAnalysis(id)));
      case "issues.csv": return attachment(reply, `${id}-issues.csv`, "text/csv", issuesCsv(await needAnalysis(id)));
      case "report.md": return attachment(reply, `${id}-report.md`, "text/markdown", reportMarkdown(await needAnalysis(id), id));
      case "scdl.sysml": {
        const a = await needAnalysis(id);
        const bad = a.issues.filter((i) => i.source === "scdl" && i.severity === "error");
        if (bad.length > 0) throw new HttpError(409, "SCDL にエラーがあるため、SysML として書き出せません。先にエラーを解消してください", bad.slice(0, 20).map((i) => `${i.code}: ${i.message}`));
        const pkg = `ScdlView_${id.replace(/-/g, "_")}`;
        return attachment(reply, `${id}-scdl.sysml`, "text/plain", exportSysml(a.scdl, { packageName: pkg }));
      }
      case "analysis.json": return attachment(reply, `${id}-analysis.json`, "application/json", JSON.stringify(await needAnalysis(id), null, 2));
      default: throw new HttpError(404, "不明な出力です");
    }
  });

  // --- AI アシスタント(提案 → 承認。ADR-0005) ---
  app.post("/api/projects/:id/ai/chat", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ message: z.string().min(1).max(2000) }).strict().parse(req.body);
    const actor = actorOf(req);
    if (!aiLimiter.allow(actor)) throw new HttpError(429, "AI へのリクエストが多すぎます。しばらくしてから再試行してください");
    const { p, out } = await requireAnalysis(id);
    if (!out.analysis) throw new HttpError(409, "モデルにエラーがあるため、AI 支援を使えません。先にモデルのエラーを直してください");
    const refs = new RefIndex(await store.refs(id));
    const result = await ai.propose({ message: body.message, projectName: id, analysis: out.analysis, safety: p.safety, refs });
    const now = new Date().toISOString();
    const proposals: Proposal[] = result.proposals.map((d) => ({ ...d, id: `P-${randomUUID().slice(0, 8)}`, status: "pending", createdAt: now, provider: result.provider, requestedBy: actor }));
    if (proposals.length)
      await store.updateProposals<Proposal, void>(id, (list) => ({ list: [...list, ...proposals], result: undefined }));
    await store.audit(id, {
      actor,
      action: "ai.chat",
      details: { provider: result.provider, question: body.message.slice(0, 500), proposals: proposals.map((x) => x.id), citations: result.citations.length },
    });
    return { reply: result.reply, citations: result.citations, proposals, ...(result.dropped ? { dropped: result.dropped } : {}), provider: result.provider };
  });

  app.get("/api/projects/:id/ai/proposals", async (req) => ({
    proposals: await store.readProposals<Proposal>(idParam.parse(req.params).id),
  }));

  const decide = async (id: string, pid: string, status: "applied" | "rejected", actor: string) =>
    store.updateProposals<Proposal, Proposal>(id, (list) => {
      const p = list.find((x) => x.id === pid);
      if (!p) throw new HttpError(404, `提案が見つかりません: ${pid}`);
      if (p.status !== "pending") throw new HttpError(409, `この提案は既に ${p.status === "applied" ? "適用" : "却下"} 済みです`);
      p.status = status;
      p.decidedAt = new Date().toISOString();
      p.decidedBy = actor;
      return { list, result: p };
    });

  app.post("/api/projects/:id/ai/proposals/:pid/apply", async (req) => {
    const { id, pid } = z.object({ id: z.string(), pid: z.string() }).parse(req.params);
    const actor = actorOf(req);
    const proposal = (await store.readProposals<Proposal>(id)).find((x) => x.id === pid);
    if (!proposal) throw new HttpError(404, `提案が見つかりません: ${pid}`);
    if (proposal.status !== "pending") throw new HttpError(409, "この提案は既に処理済みです");
    if (config.aiSeparateApprover && config.tokens.length > 0 && proposal.requestedBy === actor)
      throw new HttpError(403, "AI の提案は、依頼した人とは別の人が承認してください(FUSAMOD_AI_SEPARATE_APPROVER)");
    const p = await store.read(id);
    const before = await analysis.analyze(p.model, p.safety, p.graph);
    const applied = applyOperations(p.safety, proposal.operations);
    if (!applied.ok) throw new HttpError(422, "提案を適用できません", applied.errors);
    const after = await analysis.analyze(p.model, applied.data, p.graph);
    // 適用でエラーが増える提案は、承認されても適用しない
    const key = (i: { code: string; ref?: string | undefined }) => `${i.code}|${i.ref ?? ""}`;
    const existing = new Set((before.analysis?.issues ?? []).filter((i) => i.severity === "error").map(key));
    const added = (after.analysis?.issues ?? []).filter((i) => i.severity === "error" && !existing.has(key(i)));
    if (added.length > 0) throw new HttpError(422, "この提案を適用すると、新しいエラーが発生するため適用しません", added.map((i) => `${i.code}: ${i.message}`));
    // 来歴を safety.json に残す(提案者・承認者・時刻)。履歴にも残る
    const change = { proposalId: pid, title: proposal.title.slice(0, 5000), provider: `${proposal.provider.name}${proposal.provider.model ? `/${proposal.provider.model}` : ""}`, requestedBy: proposal.requestedBy ?? "不明", approvedBy: actor, at: new Date().toISOString(), operations: proposal.operations.length };
    const withProvenance = { ...applied.data, aiChanges: [...(applied.data.aiChanges ?? []), change].slice(-500) };
    await store.saveSafety(id, withProvenance, actor, `AI 提案を適用: ${proposal.title}`, p.revision);
    const done = await decide(id, pid, "applied", actor);
    await store.audit(id, { actor, action: "ai.apply", details: { proposal: pid, title: proposal.title, provider: proposal.provider, operations: proposal.operations.length } });
    const fresh = await requireAnalysis(id);
    return { proposal: done, ...view(id, fresh.p, fresh.out) };
  });

  app.post("/api/projects/:id/ai/proposals/:pid/reject", async (req) => {
    const { id, pid } = z.object({ id: z.string(), pid: z.string() }).parse(req.params);
    const actor = actorOf(req);
    const done = await decide(id, pid, "rejected", actor);
    await store.audit(id, { actor, action: "ai.reject", details: { proposal: pid, title: done.title } });
    return { proposal: done };
  });

  // --- Web UI(ビルド済みなら配信) ---
  if (config.webDist && existsSync(config.webDist)) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: "/",
      // ハッシュ付きの資産は長期キャッシュ、index.html は毎回確認する
      cacheControl: false,
      setHeaders: (res, path) => res.header("Cache-Control", /[\\/]assets[\\/]/.test(path) ? "public, max-age=31536000, immutable" : "no-cache"),
    });
    app.setNotFoundHandler((req, reply) => {
      const p = normalizedPath(req.url);
      if (req.method === "GET" && p !== null && !isApiPath(p)) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "見つかりません" });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "見つかりません" }));
  }
  return app;
}
