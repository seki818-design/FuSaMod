import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AiProviderError, ClaudeProvider, TOOL_NAME, mapSdkError, type MessagesClient } from "../src/index.js";
import { ctx } from "./helpers.js";

type Block = Record<string, unknown>;
const message = (content: Block[], extra: Record<string, unknown> = {}) =>
  ({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content, stop_reason: "tool_use", stop_details: null, usage: {}, ...extra }) as never;
const tool = (input: unknown): Block => ({ type: "tool_use", id: "tu_1", name: TOOL_NAME, input });

function fake(res: unknown | (() => never)) {
  const calls: Record<string, unknown>[] = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        async create(params) {
          calls.push(params);
          if (typeof res === "function") (res as () => never)();
          return res as never;
        },
      },
    },
  };
  return { client, calls };
}

const goodOp = { op: "addFailure", failure: { id: "AI-1", description: "x", functionId: "f" } };

describe("ClaudeProvider: リクエストの形", () => {
  it("公式の推奨に沿った呼び出し(強制 tool_choice を使わない・フォールバック・サンプリング指定なし)", async () => {
    const { client, calls } = fake(message([tool({ reply: "ok", proposals: [] })]));
    await new ClaudeProvider({ client }).propose(ctx("安全状態は?"));
    const c = calls[0]!;
    expect(c["model"]).toBe("claude-sonnet-5-5");
    // claude-sonnet-5-5 は tool_choice any/tool を 400 で拒否する。auto のみ
    expect(c["tool_choice"]).toEqual({ type: "auto" });
    expect(c["betas"]).toEqual(["server-side-fallback-2026-07-01"]);
    expect(c["fallbacks"]).toBe("default");
    for (const k of ["temperature", "top_p", "top_k", "thinking"]) expect(c).not.toHaveProperty(k);
    expect(c["max_tokens"]).toBe(4000);
    expect((c["tools"] as { name: string }[])[0]!.name).toBe(TOOL_NAME);
    // システムプロンプトは固定。可変のデータは user 側で <untrusted> に囲む
    expect(c["system"]).not.toContain("EvPowertrainDemo");
    const user = ((c["messages"] as { content: string }[])[0]!).content;
    expect(user).toContain("<untrusted>");
    expect(user).toContain("EvPowertrainDemo");
  });
  it("フォールバックを無効にできる", async () => {
    const { client, calls } = fake(message([tool({ reply: "ok", proposals: [] })]));
    await new ClaudeProvider({ client, fallbacks: false }).propose(ctx("x"));
    expect(calls[0]).not.toHaveProperty("betas");
    expect(calls[0]).not.toHaveProperty("fallbacks");
  });
  it("プロジェクトの文脈は上限で打ち切って送る", async () => {
    const { client, calls } = fake(message([tool({ reply: "ok", proposals: [] })]));
    await new ClaudeProvider({ client, maxContextChars: 300 }).propose(ctx("x"));
    const user = ((calls[0]!["messages"] as { content: string }[])[0]!).content;
    expect(user).toContain("長いため途中で打ち切り");
    expect(user.length).toBeLessThan(4000);
  });
  it("API キーが無ければ明示的に失敗する", () => {
    expect(() => new ClaudeProvider({})).toThrow(AiProviderError);
  });
});

describe("ClaudeProvider: 応答の検証", () => {
  it("提案の操作をスキーマで検証し、正しいものだけを返す", async () => {
    const { client } = fake(
      message([
        tool({
          reply: "提案します",
          proposals: [
            { title: "良い提案", rationale: "r", operations: [goodOp] },
            { title: "悪い提案(未知の操作)", rationale: "r", operations: [goodOp, { op: "deleteEverything" }] },
            { title: "悪い提案(型が違う)", rationale: "r", operations: [{ op: "setSeverity", failureId: "FE-1", severity: 99 }] },
          ],
        }),
      ]),
    );
    const r = await new ClaudeProvider({ client }).propose(ctx("x"));
    expect(r.proposals.map((p) => p.title)).toEqual(["良い提案"]);
    expect(r.dropped).toHaveLength(2);
    expect(r.dropped![0]).toContain("悪い提案(未知の操作)");
    expect(r.provider).toEqual({ name: "claude", model: "claude-sonnet-5-5" });
  });

  it("実在しない資料・資料に無い引用を除外し、実在する引用だけ残す", async () => {
    const quote = "独立監視マイコンは、VCU とは別の電源";
    const { client } = fake(
      message([
        tool({
          reply: "独立しています",
          proposals: [
            {
              title: "p",
              rationale: "r",
              operations: [goodOp],
              citations: [
                { source: "システム設計方針.md", quote },
                { source: "存在しない資料.md", quote: "x" },
                { source: "システム設計方針.md", quote: "資料に書かれていない作り話の引用文です、これは存在しません" },
              ],
            },
          ],
        }),
      ]),
    );
    const r = await new ClaudeProvider({ client }).propose(ctx("独立監視マイコンの電源は別ですか"));
    expect(r.proposals[0]!.citations).toHaveLength(1);
    expect(r.proposals[0]!.citations[0]!.source).toBe("システム設計方針.md");
    expect(r.dropped!.join()).toContain("存在しない資料");
    expect(r.dropped!.join()).toContain("資料に見つからない引用");
  });

  it("ツールが使われず、文章のみの応答なら、説明のみを返す", async () => {
    const { client } = fake(message([{ type: "text", text: "説明です" }], { stop_reason: "end_turn" }));
    const r = await new ClaudeProvider({ client }).propose(ctx("x"));
    expect(r.reply).toBe("説明です");
    expect(r.proposals).toEqual([]);
    expect(r.dropped![0]).toContain("説明のみ");
  });

  it("安全機能による拒否・出力の途中終了・形式不正・空の応答は、利用者向けのエラーにする", async () => {
    const run = (res: unknown) => new ClaudeProvider({ client: fake(res).client }).propose(ctx("x"));
    await expect(run(message([], { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } }))).rejects.toThrow(/安全機能.*cyber/);
    await expect(run(message([{ type: "text", text: "..." }], { stop_reason: "max_tokens" }))).rejects.toThrow(/途中で終了/);
    await expect(run(message([tool({ reply: 5 })]))).rejects.toThrow(/形式が不正/);
    await expect(run(message([], { stop_reason: "end_turn" }))).rejects.toThrow(/回答が得られません/);
  });
});

describe("エラーの写像(キーや内部情報を含めない)", () => {
  const gen = (status: number) => Anthropic.APIError.generate(status, { error: { type: "x", message: "secret-detail sk-ant-xxx" } }, "secret-detail sk-ant-xxx", new Headers());
  it.each([
    [401, /認証/, false],
    [403, /認証/, false],
    [429, /リクエスト制限/, true],
    [400, /受け付けませんでした/, false],
    [500, /HTTP 500/, true],
    [404, /HTTP 404/, false],
  ])("HTTP %i", (status, re, retryable) => {
    const e = mapSdkError(gen(status));
    expect(e.message).toMatch(re);
    expect(e.retryable).toBe(retryable);
    expect(e.message).not.toContain("secret-detail");
    expect(e.message).not.toContain("sk-ant");
  });
  it("接続エラーとタイムアウト", () => {
    expect(mapSdkError(new Anthropic.APIConnectionError({ message: "boom" })).message).toMatch(/接続できません/);
    expect(mapSdkError(new Anthropic.APIConnectionTimeoutError()).message).toMatch(/タイムアウト/);
    expect(mapSdkError(new Error("x")).message).toBe("AI の呼び出しに失敗しました。");
  });
  it("API の失敗は呼び出し側に写像されて伝わる", async () => {
    const { client } = fake(() => {
      throw gen(429);
    });
    await expect(new ClaudeProvider({ client }).propose(ctx("x"))).rejects.toMatchObject({ retryable: true });
  });
});
