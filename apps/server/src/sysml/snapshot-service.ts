import { createHash } from "node:crypto";
import type { ElementGraph } from "@fusamod/sysml-graph";
import { SysmlUnavailableError, type SysmlResult, type SysmlService } from "./types.js";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * 保存済みの要素グラフだけで答える(Java が無い環境用)。
 * モデルのテキストが、グラフを生成した時点のテキストと一致するときだけ解析結果を返し、
 * 変更されたテキストは解析できない(古いグラフを黙って返さない)。
 */
export class SnapshotSysmlService implements SysmlService {
  readonly mode = "snapshot" as const;
  constructor(private readonly lookup: (textHash: string) => Promise<ElementGraph | undefined>) {}

  async analyze(text: string): Promise<SysmlResult> {
    const g = await this.lookup(sha256(text));
    if (!g)
      throw new SysmlUnavailableError(
        "Java(公式パイロット実装)が使えないため、保存済みのモデル以外は解析できません。Java 21 以上を用意するか、FUSAMOD_SYSML=java を設定してください。",
      );
    return { ok: true, diagnostics: [], graph: g };
  }
  async close(): Promise<void> {}
}
