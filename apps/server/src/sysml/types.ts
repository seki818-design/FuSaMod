import type { ElementGraph } from "@fusamod/sysml-graph";

export interface SysmlDiagnostic {
  severity: string;
  line?: number;
  column?: number;
  message: string;
}

export interface SysmlResult {
  /** エラー無しで解析できたか */
  ok: boolean;
  diagnostics: SysmlDiagnostic[];
  /** ok のときのみ */
  graph?: ElementGraph;
  exception?: string;
}

/** SysML v2 のモデルを解析する。実装は公式パイロット実装の常駐プロセス、または保存済みグラフ。 */
export interface SysmlService {
  readonly mode: "java" | "snapshot";
  analyze(text: string): Promise<SysmlResult>;
  close(): Promise<void>;
}

export class SysmlUnavailableError extends Error {}
/** 解析がタイムアウトした(モデルの誤りではなく、大きさや負荷の問題)。 */
export class SysmlTimeoutError extends Error {}
