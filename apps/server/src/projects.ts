import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { emptySafetyData, parseSafetyData, type SafetyData } from "@fusamod/analysis";
import type { ElementGraph } from "@fusamod/sysml-graph";

export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

export interface RevisionMeta {
  revision: number;
  ts: string;
  actor: string;
  message: string;
  kind: "model" | "safety" | "restore" | "create";
  modelSha256: string;
}

export interface ProjectSummary {
  id: string;
  revision: number;
  updated: string | undefined;
}

export interface AuditEvent {
  ts: string;
  actor: string;
  action: string;
  details?: Record<string, unknown>;
}

const HISTORY_KEEP = 100;
const MAX_MODEL_BYTES = 2 * 1024 * 1024;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** 1 プロジェクト = 1 ディレクトリ(model.sysml / safety.json / model.graph.json / refs / .history / audit.jsonl)。 */
export class ProjectStore {
  private locks = new Map<string, Promise<unknown>>();
  constructor(readonly root: string) {}

  /** ID を検証し、ルート配下の絶対パスを返す(パストラバーサル対策)。 */
  dir(id: string): string {
    if (!PROJECT_ID.test(id)) throw new HttpError(400, "プロジェクト ID は英小文字・数字・ハイフンで、64 文字以内です");
    const p = resolve(this.root, id);
    if (!p.startsWith(resolve(this.root) + sep)) throw new HttpError(400, "不正なプロジェクト ID です");
    return p;
  }

  private async exists(p: string) {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(id, next.catch(() => undefined));
    return next;
  }

  private async atomicWrite(path: string, data: string) {
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, data, "utf8");
    await rename(tmp, path);
  }

  async list(): Promise<ProjectSummary[]> {
    await mkdir(this.root, { recursive: true });
    const out: ProjectSummary[] = [];
    for (const e of await readdir(this.root, { withFileTypes: true })) {
      if (!e.isDirectory() || !PROJECT_ID.test(e.name)) continue;
      if (!(await this.exists(join(this.root, e.name, "model.sysml")))) continue;
      const meta = await this.latestMeta(e.name);
      out.push({ id: e.name, revision: meta?.revision ?? 0, updated: meta?.ts });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  async latestMeta(id: string): Promise<RevisionMeta | undefined> {
    const h = await this.history(id);
    return h[0];
  }

  async history(id: string): Promise<RevisionMeta[]> {
    const hd = join(this.dir(id), ".history");
    if (!(await this.exists(hd))) return [];
    const metas: RevisionMeta[] = [];
    for (const name of await readdir(hd)) {
      try {
        metas.push(JSON.parse(await readFile(join(hd, name, "meta.json"), "utf8")) as RevisionMeta);
      } catch {
        /* 壊れた履歴は無視する */
      }
    }
    return metas.sort((a, b) => b.revision - a.revision);
  }

  async read(id: string): Promise<{ model: string; safety: SafetyData; revision: number; graph?: ElementGraph }> {
    const d = this.dir(id);
    if (!(await this.exists(join(d, "model.sysml")))) throw new HttpError(404, `プロジェクトが見つかりません: ${id}`);
    const model = await readFile(join(d, "model.sysml"), "utf8");
    let safety = emptySafetyData();
    if (await this.exists(join(d, "safety.json"))) {
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(join(d, "safety.json"), "utf8"));
      } catch {
        throw new HttpError(500, "safety.json が JSON として壊れています");
      }
      const r = parseSafetyData(raw);
      if (!r.ok) throw new HttpError(500, "safety.json の内容が不正です", r.errors);
      safety = r.data;
    }
    const meta = await this.latestMeta(id);
    let graph: ElementGraph | undefined;
    try {
      const g = JSON.parse(await readFile(join(d, "model.graph.json"), "utf8")) as ElementGraph & { _modelSha256?: string };
      if (g._modelSha256 === undefined || g._modelSha256 === sha(model)) graph = g;
    } catch {
      /* キャッシュなし */
    }
    return { model, safety, revision: meta?.revision ?? 0, ...(graph ? { graph } : {}) };
  }

  async create(id: string, model: string, actor: string): Promise<void> {
    const d = this.dir(id);
    if (await this.exists(d)) throw new HttpError(409, `プロジェクトは既に存在します: ${id}`);
    if (Buffer.byteLength(model) > MAX_MODEL_BYTES) throw new HttpError(413, "モデルが大きすぎます");
    await mkdir(d, { recursive: true });
    await this.atomicWrite(join(d, "model.sysml"), model);
    await this.atomicWrite(join(d, "safety.json"), JSON.stringify(emptySafetyData(), null, 2) + "\n");
    await this.snapshot(id, { kind: "create", actor, message: "プロジェクトを作成" });
    await this.audit(id, { actor, action: "project.create" });
  }

  /** 履歴の 1 リビジョンを書く(現在の model.sysml / safety.json のコピー)。 */
  private async snapshot(id: string, m: Pick<RevisionMeta, "kind" | "actor" | "message">): Promise<RevisionMeta> {
    const d = this.dir(id);
    const prev = await this.latestMeta(id);
    const revision = (prev?.revision ?? 0) + 1;
    const model = await readFile(join(d, "model.sysml"), "utf8");
    const rd = join(d, ".history", String(revision).padStart(6, "0"));
    await mkdir(rd, { recursive: true });
    await writeFile(join(rd, "model.sysml"), model, "utf8");
    await writeFile(join(rd, "safety.json"), await readFile(join(d, "safety.json"), "utf8"), "utf8");
    // 解析済みのグラフも残す(復元後に、Java が無い環境でも解析できるように)
    if (await this.exists(join(d, "model.graph.json"))) await writeFile(join(rd, "model.graph.json"), await readFile(join(d, "model.graph.json"), "utf8"), "utf8");
    const meta: RevisionMeta = { revision, ts: new Date().toISOString(), modelSha256: sha(model), ...m };
    await writeFile(join(rd, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
    // 古い履歴を間引く
    const all = (await readdir(join(d, ".history"))).sort();
    for (const old of all.slice(0, Math.max(0, all.length - HISTORY_KEEP))) await rm(join(d, ".history", old), { recursive: true, force: true });
    return meta;
  }

  private checkBase(current: number, base: number | undefined) {
    if (base !== undefined && base !== current)
      throw new HttpError(409, `他の更新と競合しました(現在のリビジョン ${current}、指定 ${base})。再読み込みしてください`, { currentRevision: current });
  }

  async saveModel(id: string, text: string, actor: string, message: string, baseRevision: number | undefined, graph?: ElementGraph): Promise<RevisionMeta> {
    if (Buffer.byteLength(text) > MAX_MODEL_BYTES) throw new HttpError(413, "モデルが大きすぎます");
    return this.withLock(id, async () => {
      const cur = (await this.latestMeta(id))?.revision ?? 0;
      await this.read(id); // 存在確認
      this.checkBase(cur, baseRevision);
      const d = this.dir(id);
      await this.atomicWrite(join(d, "model.sysml"), text);
      if (graph) await this.atomicWrite(join(d, "model.graph.json"), JSON.stringify({ ...graph, _modelSha256: sha(text) }, null, 2) + "\n");
      else await rm(join(d, "model.graph.json"), { force: true });
      const meta = await this.snapshot(id, { kind: "model", actor, message });
      await this.audit(id, { actor, action: "model.save", details: { revision: meta.revision, message } });
      return meta;
    });
  }

  async saveSafety(id: string, data: SafetyData, actor: string, message: string, baseRevision: number | undefined): Promise<RevisionMeta> {
    return this.withLock(id, async () => {
      const cur = (await this.latestMeta(id))?.revision ?? 0;
      await this.read(id);
      this.checkBase(cur, baseRevision);
      await this.atomicWrite(join(this.dir(id), "safety.json"), JSON.stringify(data, null, 2) + "\n");
      const meta = await this.snapshot(id, { kind: "safety", actor, message });
      await this.audit(id, { actor, action: "safety.save", details: { revision: meta.revision, message } });
      return meta;
    });
  }

  async restore(id: string, revision: number, actor: string): Promise<RevisionMeta> {
    return this.withLock(id, async () => {
      const d = this.dir(id);
      const rd = join(d, ".history", String(revision).padStart(6, "0"));
      if (!(await this.exists(rd))) throw new HttpError(404, `リビジョン ${revision} が見つかりません`);
      await this.atomicWrite(join(d, "model.sysml"), await readFile(join(rd, "model.sysml"), "utf8"));
      await this.atomicWrite(join(d, "safety.json"), await readFile(join(rd, "safety.json"), "utf8"));
      if (await this.exists(join(rd, "model.graph.json"))) await this.atomicWrite(join(d, "model.graph.json"), await readFile(join(rd, "model.graph.json"), "utf8"));
      else await rm(join(d, "model.graph.json"), { force: true });
      const meta = await this.snapshot(id, { kind: "restore", actor, message: `リビジョン ${revision} に戻す` });
      await this.audit(id, { actor, action: "project.restore", details: { from: revision, revision: meta.revision } });
      return meta;
    });
  }

  async revision(id: string, revision: number): Promise<{ model: string; safety: string; meta: RevisionMeta }> {
    const rd = join(this.dir(id), ".history", String(revision).padStart(6, "0"));
    if (!(await this.exists(rd))) throw new HttpError(404, `リビジョン ${revision} が見つかりません`);
    return {
      model: await readFile(join(rd, "model.sysml"), "utf8"),
      safety: await readFile(join(rd, "safety.json"), "utf8"),
      meta: JSON.parse(await readFile(join(rd, "meta.json"), "utf8")) as RevisionMeta,
    };
  }

  /** 追記専用の監査ログ(JSON Lines)。 */
  async audit(id: string, e: Omit<AuditEvent, "ts">): Promise<void> {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...e } satisfies AuditEvent);
    await appendFile(join(this.dir(id), "audit.jsonl"), line + "\n", "utf8");
  }

  async readAudit(id: string, limit = 200): Promise<AuditEvent[]> {
    const p = join(this.dir(id), "audit.jsonl");
    if (!(await this.exists(p))) return [];
    const lines = (await readFile(p, "utf8")).split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEvent;
        } catch {
          return undefined;
        }
      })
      .filter((x): x is AuditEvent => x !== undefined);
  }

  /** 参照資料(refs/*.md, *.txt)。シンボリックリンクでルート外を読まないよう、実パスを確認する。 */
  async refs(id: string): Promise<{ name: string; text: string }[]> {
    const rd = join(this.dir(id), "refs");
    if (!(await this.exists(rd))) return [];
    const rootReal = await realpath(this.root);
    const out: { name: string; text: string }[] = [];
    for (const name of (await readdir(rd)).sort()) {
      if (!/\.(md|txt)$/i.test(name)) continue;
      const real = await realpath(join(rd, name));
      if (!real.startsWith(rootReal + sep)) continue;
      const st = await stat(real);
      if (!st.isFile() || st.size > 1024 * 1024) continue;
      out.push({ name, text: await readFile(real, "utf8") });
    }
    return out;
  }

  /** AI の提案(承認前・承認済み・却下)。proposals.json に保存する。 */
  async readProposals<T>(id: string): Promise<T[]> {
    const p = join(this.dir(id), "proposals.json");
    if (!(await this.exists(p))) return [];
    try {
      const v = JSON.parse(await readFile(p, "utf8")) as unknown;
      return Array.isArray(v) ? (v as T[]) : [];
    } catch {
      throw new HttpError(500, "proposals.json が壊れています");
    }
  }

  async updateProposals<T, R>(id: string, fn: (list: T[]) => { list: T[]; result: R }): Promise<R> {
    return this.withLock(`${id}:proposals`, async () => {
      const cur = await this.readProposals<T>(id);
      const { list, result } = fn(cur);
      await this.atomicWrite(join(this.dir(id), "proposals.json"), JSON.stringify(list.slice(-500), null, 2) + "\n");
      return result;
    });
  }

  /** テキストのハッシュに一致する保存済みグラフを、全プロジェクトから探す(スナップショット解析用)。 */
  async findGraphByModelHash(hash: string): Promise<ElementGraph | undefined> {
    for (const p of await this.list()) {
      try {
        const d = this.dir(p.id);
        const model = await readFile(join(d, "model.sysml"), "utf8");
        if (sha(model) !== hash) continue;
        const g = JSON.parse(await readFile(join(d, "model.graph.json"), "utf8")) as ElementGraph & { _modelSha256?: string };
        if (g._modelSha256 === undefined || g._modelSha256 === hash) return g;
      } catch {
        /* 次へ */
      }
    }
    return undefined;
  }
}
