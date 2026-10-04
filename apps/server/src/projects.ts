import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { emptySafetyData, parseSafetyData, type SafetyData } from "@fusamod/analysis";
import type { ElementGraph } from "@fusamod/sysml-graph";

export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Windows の予約名(ディレクトリ名にすると問題を起こす)と、本ツールが内部で使う名前 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** 改行は LF にそろえる（Windows の CRLF のままだと、解析時の文字位置が画面のテキストとずれ、図からの編集ができなくなる） */
const lf = (t: string) => t.replace(/\r\n?/g, "\n");

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
  /** 安全分析データ(safety.json)のハッシュ。途中で落ちた保存を検出して、確定済みの内容に戻すために使う */
  safetySha256?: string;
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
  /** 直前の行のハッシュ(ハッシュ連鎖。改ざん・欠落を検出する) */
  prev?: string;
}

/** 残す履歴の数(環境変数 FUSAMOD_HISTORY_KEEP で変更)。超えた分は古い順に削除する。 */
const HISTORY_KEEP = Math.max(10, Number(process.env["FUSAMOD_HISTORY_KEEP"] ?? 500) || 500);
const MAX_MODEL_BYTES = 2 * 1024 * 1024;

const GENESIS = "genesis";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** 1 プロジェクト = 1 ディレクトリ(model.sysml / safety.json / model.graph.json / refs / .history / audit.jsonl)。 */
export class ProjectStore {
  private locks = new Map<string, Promise<unknown>>();
  constructor(readonly root: string) {}

  /** ID を検証し、ルート配下の絶対パスを返す(パストラバーサル対策)。 */
  dir(id: string): string {
    if (!PROJECT_ID.test(id) || RESERVED.test(id)) throw new HttpError(400, "プロジェクト ID は英小文字・数字・ハイフンで、64 文字以内です(con、aux、nul など OS の予約名は使えません)");
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

  /** 最新リビジョン(ディレクトリ名は 0 埋めの連番なので、一覧を読むだけで最新の 1 件に着ける)。 */
  async latestMeta(id: string): Promise<RevisionMeta | undefined> {
    const hd = join(this.dir(id), ".history");
    if (!(await this.exists(hd))) return undefined;
    const names = (await readdir(hd)).filter((n) => /^\d{6}$/.test(n)).sort().reverse();
    for (const name of names) {
      try {
        return JSON.parse(await readFile(join(hd, name, "meta.json"), "utf8")) as RevisionMeta;
      } catch {
        /* 壊れた履歴は飛ばして、その前のものを使う */
      }
    }
    return undefined;
  }

  /** メタを読めない履歴を `.corrupt-<名前>-<時刻>` に隔離する(削除はしない。原因調査用)。監査ログに残す。 */
  private async quarantineBroken(id: string) {
    const broken = await this.brokenHistory(id);
    const hd = join(this.dir(id), ".history");
    for (const n of broken) await rename(join(hd, n), join(hd, `.corrupt-${n}-${Date.now()}`));
    if (broken.length > 0) await this.audit(id, { actor: "system", action: "history.quarantine", details: { dirs: broken } });
  }

  /** メタを読めない履歴のディレクトリ名。 */
  private async brokenHistory(id: string): Promise<string[]> {
    const hd = join(this.dir(id), ".history");
    if (!(await this.exists(hd))) return [];
    const out: string[] = [];
    for (const n of (await readdir(hd)).filter((x) => /^\d{6}$/.test(x))) {
      try {
        JSON.parse(await readFile(join(hd, n, "meta.json"), "utf8"));
      } catch {
        out.push(n);
      }
    }
    return out;
  }

  async history(id: string): Promise<RevisionMeta[]> {
    const hd = join(this.dir(id), ".history");
    if (!(await this.exists(hd))) return [];
    const metas: RevisionMeta[] = [];
    for (const name of (await readdir(hd)).filter((n) => /^\d{6}$/.test(n))) {
      try {
        metas.push(JSON.parse(await readFile(join(hd, name, "meta.json"), "utf8")) as RevisionMeta);
      } catch {
        /* 壊れた履歴は無視する */
      }
    }
    return metas.sort((a, b) => b.revision - a.revision);
  }

  /**
   * 現在のプロジェクト。保存は「履歴(確定)→現在のファイル」の順に書くので、途中で落ちて両者が食い違っていたら、
   * 確定済みの履歴の内容を返す(次の保存で現在のファイルも揃う)。
   */
  async read(id: string): Promise<{ model: string; safety: SafetyData; revision: number; graph?: ElementGraph; notice?: string }> {
    const d = this.dir(id);
    if (!(await this.exists(join(d, "model.sysml")))) throw new HttpError(404, `プロジェクトが見つかりません: ${id}`);
    const meta = await this.latestMeta(id);
    let src = d;
    let notice: string | undefined;
    let model = await readFile(join(d, "model.sysml"), "utf8");
    let safetyText = (await this.exists(join(d, "safety.json"))) ? await readFile(join(d, "safety.json"), "utf8") : undefined;
    // 改行コードの違い（Windows の CRLF）だけなら、書き換えとは見なさない
    const same = (stored: string | undefined, text: string) => stored === sha(text) || stored === sha(lf(text));
    if (meta && (!same(meta.modelSha256, model) || (meta.safetySha256 !== undefined && safetyText !== undefined && !same(meta.safetySha256, safetyText)))) {
      src = join(d, ".history", String(meta.revision).padStart(6, "0"));
      notice = `現在のファイルが、確定済みの履歴(リビジョン ${meta.revision})と一致しないため、履歴の内容を読み込みました。ファイルを直接書き換えた場合、その変更は反映されません`;
      model = await readFile(join(src, "model.sysml"), "utf8");
      safetyText = await readFile(join(src, "safety.json"), "utf8");
    }
    model = lf(model);
    let safety = emptySafetyData();
    if (safetyText !== undefined) {
      let raw: unknown;
      try {
        raw = JSON.parse(safetyText);
      } catch {
        throw new HttpError(500, "safety.json が JSON として壊れています");
      }
      const r = parseSafetyData(raw);
      if (!r.ok) throw new HttpError(500, "safety.json の内容が不正です", r.errors);
      safety = r.data;
    }
    let graph: ElementGraph | undefined;
    try {
      const g = JSON.parse(await readFile(join(src, "model.graph.json"), "utf8")) as ElementGraph & { _modelSha256?: string };
      if (g._modelSha256 === undefined || g._modelSha256 === sha(model)) graph = g;
    } catch {
      /* キャッシュなし */
    }
    const broken = await this.brokenHistory(id);
    const quarantined = (await this.exists(join(d, ".history"))) ? (await readdir(join(d, ".history"))).filter((n) => n.startsWith(".corrupt-")).length : 0;
    if (broken.length === 0 && quarantined > 0) notice = `${notice ? `${notice}。` : ""}隔離された壊れた履歴が ${quarantined} 件あります(.history/.corrupt-*。原因の調査後に削除してください)`;
    if (broken.length > 0) notice = `${notice ? `${notice}。` : ""}壊れた履歴があります(${broken.join("、")}): 最新の有効なリビジョンから続けます`;
    return { model, safety, revision: meta?.revision ?? 0, ...(graph ? { graph } : {}), ...(notice ? { notice } : {}) };
  }

  async create(id: string, rawModel: string, actor: string): Promise<void> {
    const model = lf(rawModel);
    const d = this.dir(id);
    if (await this.exists(d)) throw new HttpError(409, `プロジェクトは既に存在します: ${id}`);
    if (Buffer.byteLength(model) > MAX_MODEL_BYTES) throw new HttpError(413, "モデルが大きすぎます");
    await mkdir(d, { recursive: true });
    const safety = JSON.stringify(emptySafetyData(), null, 2) + "\n";
    await this.commit(id, { model, safety }, { kind: "create", actor, message: "プロジェクトを作成" });
    await this.audit(id, { actor, action: "project.create" });
  }

  /**
   * 1 リビジョンを確定する。先に履歴ディレクトリを一時名で書いて rename で確定し(ここが確定点)、
   * そのあと現在のファイルを揃える。確定前に落ちれば何も変わらず、確定後に落ちても read が確定済みの内容を返す。
   */
  private async commit(
    id: string,
    c: { model: string; safety: string; graph?: string | undefined },
    m: Pick<RevisionMeta, "kind" | "actor" | "message">,
  ): Promise<RevisionMeta> {
    const d = this.dir(id);
    await this.ensureBaseline(id, m.kind);
    const hd = join(d, ".history");
    await mkdir(hd, { recursive: true });
    await this.quarantineBroken(id);
    // 版番号は、メタが壊れていても衝突しないよう、ディレクトリ名の最大値から決める
    const maxDir = Math.max(0, ...(await readdir(hd)).filter((n) => /^\d{6}$/.test(n)).map(Number));
    const revision = Math.max(maxDir, (await this.latestMeta(id))?.revision ?? 0) + 1;
    const tmp = join(hd, `.tmp-${randomUUID()}`);
    await mkdir(tmp);
    const meta: RevisionMeta = { revision, ts: new Date().toISOString(), modelSha256: sha(c.model), safetySha256: sha(c.safety), ...m };
    await writeFile(join(tmp, "model.sysml"), c.model, "utf8");
    await writeFile(join(tmp, "safety.json"), c.safety, "utf8");
    if (c.graph !== undefined) await writeFile(join(tmp, "model.graph.json"), c.graph, "utf8");
    await writeFile(join(tmp, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
    await rename(tmp, join(hd, String(revision).padStart(6, "0"))); // 確定
    await this.atomicWrite(join(d, "model.sysml"), c.model);
    await this.atomicWrite(join(d, "safety.json"), c.safety);
    if (c.graph !== undefined) await this.atomicWrite(join(d, "model.graph.json"), c.graph);
    else await rm(join(d, "model.graph.json"), { force: true });
    const pruned = await this.prune(id);
    if (pruned > 0) await this.audit(id, { actor: "system", action: "history.prune", details: { removed: pruned, keep: HISTORY_KEEP } });
    return meta;
  }

  /** 履歴が無いプロジェクト(手で置いたもの)は、最初の保存の前に、元の内容を版 1 として残す。 */
  private async ensureBaseline(id: string, kind: RevisionMeta["kind"]) {
    if (kind === "create") return;
    const d = this.dir(id);
    const hd = join(d, ".history");
    if ((await this.exists(hd)) && (await readdir(hd)).some((n) => /^\d{6}$/.test(n))) return;
    if (!(await this.exists(join(d, "model.sysml")))) return;
    const model = await readFile(join(d, "model.sysml"), "utf8");
    const safety = (await this.exists(join(d, "safety.json"))) ? await readFile(join(d, "safety.json"), "utf8") : JSON.stringify(emptySafetyData(), null, 2) + "\n";
    const graph = (await this.exists(join(d, "model.graph.json"))) ? await readFile(join(d, "model.graph.json"), "utf8") : undefined;
    await mkdir(hd, { recursive: true });
    const rd = join(hd, "000001");
    const tmp = join(hd, `.tmp-${randomUUID()}`);
    await mkdir(tmp);
    const meta: RevisionMeta = { revision: 1, ts: new Date().toISOString(), actor: "system", message: "最初の保存の前の内容(取り込み)", kind: "create", modelSha256: sha(model), safetySha256: sha(safety) };
    await writeFile(join(tmp, "model.sysml"), model, "utf8");
    await writeFile(join(tmp, "safety.json"), safety, "utf8");
    if (graph !== undefined) await writeFile(join(tmp, "model.graph.json"), graph, "utf8");
    await writeFile(join(tmp, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
    await rename(tmp, rd);
  }

  /** 古い履歴の削除と、確定前に落ちた一時ディレクトリの掃除。 */
  private async prune(id: string): Promise<number> {
    const hd = join(this.dir(id), ".history");
    const all = await readdir(hd);
    for (const t of all.filter((n) => n.startsWith(".tmp-"))) await rm(join(hd, t), { recursive: true, force: true });
    const nums = all.filter((n) => /^\d{6}$/.test(n)).sort();
    const old = nums.slice(0, Math.max(0, nums.length - HISTORY_KEEP));
    for (const o of old) await rm(join(hd, o), { recursive: true, force: true });
    return old.length;
  }

  private checkBase(current: number, base: number | undefined) {
    if (base !== undefined && base !== current)
      throw new HttpError(409, `他の更新と競合しました(現在のリビジョン ${current}、指定 ${base})。再読み込みしてください`, { currentRevision: current });
  }

  async saveModel(id: string, rawText: string, actor: string, message: string, baseRevision: number | undefined, graph?: ElementGraph): Promise<RevisionMeta> {
    const text = lf(rawText);
    if (Buffer.byteLength(text) > MAX_MODEL_BYTES) throw new HttpError(413, "モデルが大きすぎます");
    return this.withLock(id, async () => {
      const cur = await this.read(id); // 存在確認と、確定済みの内容の取得
      this.checkBase(cur.revision, baseRevision);
      const safety = JSON.stringify(cur.safety, null, 2) + "\n";
      const g = graph ? JSON.stringify({ ...graph, _modelSha256: sha(text) }, null, 2) + "\n" : undefined;
      const meta = await this.commit(id, { model: text, safety, graph: g }, { kind: "model", actor, message });
      await this.audit(id, { actor, action: "model.save", details: { revision: meta.revision, message } });
      return meta;
    });
  }

  async saveSafety(id: string, data: SafetyData, actor: string, message: string, baseRevision: number | undefined): Promise<RevisionMeta> {
    return this.withLock(id, async () => {
      const cur = await this.read(id);
      this.checkBase(cur.revision, baseRevision);
      const g = cur.graph ? JSON.stringify({ ...cur.graph, _modelSha256: sha(cur.model) }, null, 2) + "\n" : undefined;
      const meta = await this.commit(id, { model: cur.model, safety: JSON.stringify(data, null, 2) + "\n", graph: g }, { kind: "safety", actor, message });
      await this.audit(id, { actor, action: "safety.save", details: { revision: meta.revision, message } });
      return meta;
    });
  }

  async restore(id: string, revision: number, actor: string): Promise<RevisionMeta> {
    return this.withLock(id, async () => {
      const rd = join(this.dir(id), ".history", String(revision).padStart(6, "0"));
      if (!(await this.exists(rd))) throw new HttpError(404, `リビジョン ${revision} が見つかりません`);
      const graph = (await this.exists(join(rd, "model.graph.json"))) ? await readFile(join(rd, "model.graph.json"), "utf8") : undefined;
      // AI の適用履歴(来歴)は、復元しても消えない: 現在の aiChanges を、復元する内容に引き継ぐ
      const cur = await this.read(id);
      let safety = await readFile(join(rd, "safety.json"), "utf8");
      if (cur.safety.aiChanges?.length) {
        const restored = JSON.parse(safety) as Record<string, unknown>;
        restored["aiChanges"] = cur.safety.aiChanges;
        safety = JSON.stringify(restored, null, 2) + "\n";
      }
      const meta = await this.commit(
        id,
        { model: await readFile(join(rd, "model.sysml"), "utf8"), safety, graph },
        { kind: "restore", actor, message: `リビジョン ${revision} に戻す` },
      );
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

  /**
   * 追記専用の監査ログ(JSON Lines)。各行に直前の行の SHA-256 を持たせ(ハッシュ連鎖)、
   * 途中の行の改ざん・削除を verifyAudit で検出できる。末尾の削除や全面的な作り直しは、外部へのバックアップ・転送で補う必要がある。
   */
  async audit(id: string, e: Omit<AuditEvent, "ts" | "prev">): Promise<void> {
    await this.withLock(`${id}:audit`, () => this.appendChained(join(this.dir(id), "audit.jsonl"), e));
  }

  /** 直前の行のハッシュ(ファイルごと)。毎回ファイル全体を読み直さないための記憶。外部で書き換えられた場合に備え、サイズが合わなければ読み直す。 */
  private lastHash = new Map<string, { size: number; hash: string }>();

  private async appendChained(p: string, e: Omit<AuditEvent, "ts" | "prev">): Promise<void> {
    const size = (await this.exists(p)) ? (await stat(p)).size : 0;
    let prev = GENESIS;
    const cached = this.lastHash.get(p);
    if (size > 0) {
      if (cached && cached.size === size) prev = cached.hash;
      else {
        const last = (await readFile(p, "utf8")).split("\n").filter(Boolean).at(-1);
        prev = last ? sha(last) : GENESIS;
      }
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), ...e, prev } satisfies AuditEvent);
    await appendFile(p, line + "\n", "utf8");
    this.lastHash.set(p, { size: size + Buffer.byteLength(line) + 1, hash: sha(line) });
  }

  /** サーバー全体の監査ログ(認証失敗など、プロジェクトに属さない出来事)。ハッシュ連鎖は project の audit と同じ。 */
  async auditGlobal(e: Omit<AuditEvent, "ts" | "prev">): Promise<void> {
    await this.withLock("_server:audit", async () => {
      await mkdir(this.root, { recursive: true });
      await this.appendChained(join(this.root, "_server-audit.jsonl"), e);
    });
  }

  /** 監査ログの連鎖を検証する。 */
  async verifyAudit(id: string): Promise<{ ok: boolean; lines: number; brokenAtLine?: number }> {
    const p = join(this.dir(id), "audit.jsonl");
    if (!(await this.exists(p))) return { ok: true, lines: 0 };
    const lines = (await readFile(p, "utf8")).split("\n").filter(Boolean);
    let prev = GENESIS;
    for (let i = 0; i < lines.length; i++) {
      let e: AuditEvent;
      try {
        e = JSON.parse(lines[i]!) as AuditEvent;
      } catch {
        return { ok: false, lines: lines.length, brokenAtLine: i + 1 };
      }
      // 連鎖の導入前に書かれた行(prev なし)は、先頭の連続部分に限って許す
      if (e.prev === undefined && prev === GENESIS) {
        prev = sha(lines[i]!);
        continue;
      }
      if (e.prev !== prev) return { ok: false, lines: lines.length, brokenAtLine: i + 1 };
      prev = sha(lines[i]!);
    }
    return { ok: true, lines: lines.length };
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
      if (!Array.isArray(v)) throw new Error("not an array");
      return v as T[];
    } catch {
      // 提案は承認前の一時的なデータなので、壊れていたら退避して空から続ける(保存済みの安全分析データには影響しない)
      const moved = `${p}.corrupt-${Date.now()}`;
      await rename(p, moved);
      await this.audit(id, { actor: "system", action: "proposals.corrupt", details: { movedTo: moved.split(/[\\/]/).pop() } });
      return [];
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
        const model = lf(await readFile(join(d, "model.sysml"), "utf8"));
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
