import { z } from "zod";
import type { ProjectAnalysis, SafetyData } from "@fusamod/analysis";
import type { RefIndex } from "./rag.js";
import { OperationSchema, type Operation } from "./operations.js";

export const CitationSchema = z.object({
  source: z.string().max(300),
  /** 資料内の行範囲(1 始まり) */
  lines: z.tuple([z.number().int(), z.number().int()]).optional(),
  quote: z.string().max(600),
});
export type Citation = z.infer<typeof CitationSchema>;

/** 承認前の提案。ProposalDraft に id・状態・時刻を付けたものがサーバーに保存される。 */
export const ProposalDraftSchema = z.object({
  title: z.string().min(1).max(200),
  /** なぜこの提案か。根拠と、人が確認すべき点 */
  rationale: z.string().max(4000),
  operations: z.array(OperationSchema).max(200),
  citations: z.array(CitationSchema).max(20).default([]),
});
export type ProposalDraft = z.infer<typeof ProposalDraftSchema>;

export interface Proposal extends ProposalDraft {
  id: string;
  status: "pending" | "applied" | "rejected";
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  /** 提案を AI に依頼した人 */
  requestedBy?: string;
  provider: { name: string; model?: string };
}

export interface AiContext {
  message: string;
  projectName: string;
  analysis: ProjectAnalysis;
  safety: SafetyData;
  refs: RefIndex;
}

export interface AiResult {
  reply: string;
  citations: Citation[];
  proposals: ProposalDraft[];
  /** 提供元の情報(監査ログ用) */
  provider: { name: string; model?: string };
  /** 提案のうち、検証で除外したものの理由 */
  dropped?: string[];
}

export interface AiProvider {
  readonly name: string;
  propose(ctx: AiContext): Promise<AiResult>;
}

export class AiProviderError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
  }
}

export type { Operation };
