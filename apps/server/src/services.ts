import { analyzeProject, parseSafetyData, type ProjectAnalysis, type SafetyData } from "@fusamod/analysis";
import type { ElementGraph } from "@fusamod/sysml-graph";
import { sha256 } from "./sysml/snapshot-service.js";
import { SysmlBusyError, SysmlTimeoutError, SysmlUnavailableError, type SysmlDiagnostic, type SysmlResult, type SysmlService } from "./sysml/types.js";
import { HttpError } from "./projects.js";

class Lru<V> {
  private m = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: string, v: V) {
    this.m.delete(k);
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
}

export interface AnalysisOutcome {
  /** SysML の解析結果。ok=false のときは diagnostics にエラー */
  diagnostics: SysmlDiagnostic[];
  modelOk: boolean;
  /** SysML を解析できなかった(サービス停止など)ときの説明 */
  sysmlError?: string;
  /** 解析自体が失敗した(タイムアウト・サービス停止)。モデルの誤りではない */
  sysmlFailure?: "timeout" | "unavailable" | "busy";
  graph?: ElementGraph;
  /** モデルが解析できたときのみ */
  analysis?: ProjectAnalysis;
}

/** SysML サービスと安全分析を組み合わせた解析。モデル・安全データのハッシュでキャッシュする。 */
export class AnalysisService {
  private sysmlCache = new Lru<SysmlResult>(64);
  private analysisCache = new Lru<ProjectAnalysis>(64);
  private lastUnavailable = 0;
  /** タイムアウトしたモデル（ハッシュ）→ いつまで再試行しないか。重いモデルを開くたびに共有の Java を長く占有しないため */
  private timedOut = new Map<string, { until: number; error: string }>();

  constructor(
    private readonly sysml: SysmlService,
    private readonly log: (m: string) => void = () => {},
  ) {}

  get mode() {
    return this.sysml.mode;
  }

  async parseModel(text: string, knownGraph?: ElementGraph): Promise<{ result?: SysmlResult; error?: string; failure?: "timeout" | "unavailable" | "busy" }> {
    const key = sha256(text);
    const cached = this.sysmlCache.get(key);
    if (cached) return { result: cached };
    if (knownGraph) {
      const r: SysmlResult = { ok: true, diagnostics: [], graph: knownGraph };
      this.sysmlCache.set(key, r);
      return { result: r };
    }
    const bad = this.timedOut.get(key);
    if (bad && Date.now() < bad.until) return { error: `${bad.error}(同じモデルは、しばらく再解析しません。モデルを変更すると再試行します)`, failure: "timeout" };
    try {
      const r = await this.sysml.analyze(text);
      if (r.ok) this.sysmlCache.set(key, r); // エラー結果はキャッシュしない
      return { result: r };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`SysML 解析に失敗: ${msg}`);
      if (e instanceof SysmlUnavailableError) this.lastUnavailable = Date.now();
      if (e instanceof SysmlTimeoutError) {
        this.timedOut.set(key, { until: Date.now() + 5 * 60_000, error: msg });
        if (this.timedOut.size > 64) this.timedOut.delete(this.timedOut.keys().next().value as string);
      }
      return { error: msg, failure: e instanceof SysmlTimeoutError ? "timeout" : e instanceof SysmlBusyError ? "busy" : "unavailable" };
    }
  }

  async analyze(modelText: string, safety: SafetyData, knownGraph?: ElementGraph): Promise<AnalysisOutcome> {
    const { result, error, failure } = await this.parseModel(modelText, knownGraph);
    if (!result) return { diagnostics: [], modelOk: false, sysmlError: error ?? "SysML を解析できません", sysmlFailure: failure ?? "unavailable" };
    if (!result.ok || !result.graph)
      return { diagnostics: result.diagnostics, modelOk: false, ...(result.exception ? { sysmlError: result.exception } : {}) };
    const key = `${sha256(modelText)}:${sha256(JSON.stringify(safety))}`;
    let analysis = this.analysisCache.get(key);
    if (!analysis) {
      analysis = analyzeProject(result.graph, safety);
      this.analysisCache.set(key, analysis);
    }
    return { diagnostics: result.diagnostics, modelOk: true, graph: result.graph, analysis };
  }
}

/** 入力の安全データを検証する。不正なら 400。 */
export function requireSafety(input: unknown): SafetyData {
  const r = parseSafetyData(input);
  if (!r.ok) throw new HttpError(400, "安全分析データが不正です", r.errors);
  return r.data;
}

/** 主たる SysML サービスが使えない場合に、保存済みグラフのサービスへ切り替える(一定時間は主を試さない)。 */
export class FallbackSysmlService implements SysmlService {
  private downUntil = 0;
  constructor(
    private readonly primary: SysmlService,
    private readonly fallback: SysmlService,
    private readonly log: (m: string) => void = () => {},
    private readonly retryMs = 60_000,
  ) {}
  get mode() {
    return Date.now() < this.downUntil ? this.fallback.mode : this.primary.mode;
  }
  async analyze(text: string): Promise<SysmlResult> {
    if (Date.now() >= this.downUntil) {
      try {
        return await this.primary.analyze(text);
      } catch (e) {
        if (!(e instanceof SysmlUnavailableError)) throw e;
        this.downUntil = Date.now() + this.retryMs;
        this.log(`Java の SysML サービスが使えないため、保存済みグラフに切り替えます: ${e.message}`);
      }
    }
    return this.fallback.analyze(text);
  }
  async close() {
    await Promise.allSettled([this.primary.close(), this.fallback.close()]);
  }
}
