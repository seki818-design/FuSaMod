import { analysisSummaryText } from "./context.js";
import { toCitation } from "./rag.js";
import {
  asilRank,
  determineAsil,
  impactOfFailureChange,
  type Asil,
  type ElementId,
} from "@fusamod/safety-core";
import { VIEWPOINTS, impactOfRequirementChange, levelLabel } from "@fusamod/analysis";
import type { Operation } from "./operations.js";
import type { AiContext, AiProvider, AiResult, ProposalDraft } from "./types.js";

const PROVIDER = { name: "rule-based" } as const;
const NOTE = "※ 提案は未確定です。内容を確認し、承認した場合にだけデータに反映されます。";

const has = (s: string, ...words: string[]) => words.some((w) => s.toLowerCase().includes(w.toLowerCase()));

const LOSS = /(出ない|出力しない|喪失|発生しない|失)/;
const EXCESS = /(過大|過剰|過電流|超過|意図しない)/;
const classify = (s: string): "loss" | "excess" | undefined => {
  const l = LOSS.test(s);
  const e = EXCESS.test(s);
  return l === e ? undefined : l ? "loss" : "excess";
};

/**
 * LLM を使わない、決定的な支援。ガイドワードによる故障モード候補の提案、変更影響の説明、要約、レビュー、
 * ASIL 分解の説明、HARA の ASIL 判定、参照資料の根拠つき回答を行う。ネットワークに出ないため、
 * 機密のプロジェクトでも使える。提案の確定は人が行う(承認するまでデータは変わらない)。
 */
export class RuleBasedProvider implements AiProvider {
  readonly name = PROVIDER.name;

  async propose(ctx: AiContext): Promise<AiResult> {
    const m = ctx.message;
    if (has(m, "fmea", "故障モード")) return this.fmea(ctx);
    if (has(m, "影響分析", "影響", "impact")) return this.impact(ctx);
    if (has(m, "要約", "概要", "summary", "まとめ")) return this.summary(ctx);
    if (has(m, "レビュー", "review", "チェック")) return this.review(ctx);
    if (has(m, "デコンポ", "分解", "decomposition")) return this.decomposition(ctx);
    if (/S\s*([0-3])\D{0,6}E\s*([0-4])\D{0,6}C\s*([0-3])/i.test(m) || has(m, "asil", "ハザード", "hara")) return this.hara(ctx);
    return this.answerFromRefs(ctx);
  }

  private result(reply: string, extra: Partial<AiResult> = {}): AiResult {
    return { reply, citations: [], proposals: [], provider: { ...PROVIDER }, ...extra };
  }

  private fmea(ctx: AiContext): AiResult {
    const { net } = ctx.analysis;
    const msg = ctx.message.toLowerCase();
    const mentioned = new Set<ElementId>(net.elements.filter((e) => msg.includes(e.name.toLowerCase())).map((e) => e.id));
    const depth = (fid: string): number => {
      let d = 0;
      for (let f = net.functions.find((x) => x.id === fid); f?.parentFunctionId && d < 50; d++) f = net.functions.find((x) => x.id === f!.parentFunctionId);
      return d;
    };
    const lacking = net.functions
      .filter((f) => !ctx.safety.failures.some((x) => x.functionId === f.id))
      .filter((f) => mentioned.size === 0 || mentioned.has(f.ownerId))
      .sort((a, b) => depth(a.id) - depth(b.id))
      .slice(0, 6);
    if (lacking.length === 0)
      return this.result(
        mentioned.size > 0
          ? "指定された要素の機能には、すでに故障モードが定義されています。追加の提案はありません。"
          : "すべての機能に故障モードが定義されています。追加の提案はありません。",
      );

    const used = new Set(ctx.safety.failures.map((f) => f.id));
    let n = 0;
    const nextId = () => {
      for (;;) {
        const id = `AI-FM-${String(++n).padStart(3, "0")}`;
        if (!used.has(id) && !ctx.safety.links.some((l) => l.id === `AI-L-${String(n).padStart(3, "0")}`)) return (used.add(id), id);
      }
    };
    const ops: Operation[] = [];
    const added = new Map<string, { id: string; description: string }[]>(); // functionId → 今回追加した故障
    const linked: string[] = [];
    const notLinked: string[] = [];
    for (const f of lacking) {
      const param = (ctx.analysis.derived.parameters[f.id] ?? []).find((p) => p.direction !== "in" && p.name)?.name;
      const base = param ? `${f.name}: 出力「${param}」` : `${f.name}: `;
      for (const [cls, label] of [["loss", "機能喪失"], ["excess", "過大"]] as const) {
        const id = nextId();
        const description = `${base}${label}`;
        ops.push({ op: "addFailure", failure: { id, description, functionId: f.id } });
        added.set(f.id, [...(added.get(f.id) ?? []), { id, description }]);
        // 親機能の同種の故障モードへのリンク(同種が一意に決まる場合のみ)
        const parentId = f.parentFunctionId;
        if (!parentId) continue;
        // 安全機構の機能は、喪失しても上位の機能が直ちに失われるわけではない(潜在故障)ため、リンクは人が決める
        if (ctx.safety.mechanisms.some((x) => x.elementId === f.ownerId)) {
          notLinked.push(description);
          continue;
        }
        const parents = [
          ...ctx.safety.failures.filter((x) => x.functionId === parentId).map((x) => ({ id: x.id, description: x.description })),
          ...(added.get(parentId) ?? []),
        ].filter((x) => classify(x.description) === cls);
        if (parents.length === 1) {
          ops.push({ op: "addLink", link: { id: `AI-L-${String(n).padStart(3, "0")}`, causeId: id, effectId: parents[0]!.id } });
          linked.push(`${description} → ${parents[0]!.description}`);
        } else notLinked.push(description);
      }
    }
    const el = new Set(lacking.map((f) => net.elements.find((e) => e.id === f.ownerId)?.name ?? f.ownerId));
    const draft: ProposalDraft = {
      title: `故障モード候補を追加(${[...el].join("・")}、${ops.filter((o) => o.op === "addFailure").length} 件)`,
      rationale:
        "ガイドワード(機能喪失・過大)による故障モードの叩き台です。重大度・発生度・検出度・管理は設定していません(根拠なく評価値を作らないため)。" +
        "上位機能に同種の故障モードが一意にある場合だけ、原因→影響のリンクを提案しました。" +
        `リンクを付けたもの ${linked.length} 件、付けなかったもの ${notLinked.length} 件(親機能に同種の故障モードが無い/複数ある、または安全機構の機能で潜在故障として別途検討が必要)。` +
        "内容は FMEA の担当者と安全の専門家が確認してください。",
      operations: ops,
      citations: [],
    };
    const reply = [
      `故障モードが未定義の機能 ${lacking.length} 件に対して、故障モード候補 ${ops.filter((o) => o.op === "addFailure").length} 件を提案します。`,
      "",
      ...lacking.map((f) => `- ${net.elements.find((e) => e.id === f.ownerId)?.name}: ${f.name}`),
      "",
      linked.length ? `リンクを付ける提案:\n${linked.map((l) => `- ${l}`).join("\n")}` : "リンクの提案はありません(親機能に同種の故障モードが無い、または複数あります)。",
      notLinked.length ? `\nリンクは人が決めてください: ${notLinked.length} 件` : "",
      "",
      NOTE,
    ].join("\n");
    return this.result(reply, { proposals: [draft] });
  }

  private impact(ctx: AiContext): AiResult {
    const { net } = ctx.analysis;
    const req = this.requirementImpact(ctx);
    if (req) return req;
    const ids = new Set<string>();
    for (const f of net.failures) if (ctx.message.includes(f.id)) ids.add(f.id);
    if (ids.size === 0) {
      const msg = ctx.message.toLowerCase();
      for (const e of net.elements.filter((x) => msg.includes(x.name.toLowerCase())))
        for (const f of net.failures) if (net.functions.find((x) => x.id === f.functionId)?.ownerId === e.id) ids.add(f.id);
    }
    if (ids.size === 0) return this.result("影響を調べる対象が分かりません。故障ノードの ID(例: FM-PT-1)か、構造要素の名前(例: motor)を含めて質問してください。");
    const affected = new Set<ElementId>();
    const lines: string[] = [];
    for (const id of ids) {
      const r = impactOfFailureChange(net, id);
      r.affectedElements.forEach((e) => affected.add(e));
      const fd = net.failures.find((f) => f.id === id)!;
      lines.push(`- ${id}「${fd.description}」: 上位への波及 ${r.upstream.length} 件、下位の原因 ${r.downstream.length} 件`);
    }
    const names = [...affected].map((e) => net.elements.find((x) => x.id === e)?.name ?? e);
    return this.result(
      [`変更の影響を受ける FMEA は ${affected.size} 件です: ${names.join("、")}`, "", ...lines, "", "これらの FMEA の該当行を再確認してください(故障ネットの上位・下位のリンクをたどって求めています)。"].join("\n"),
    );
  }

  /** 要求の ID(安全要求、または SysML 要求の名前)が質問に含まれていれば、要求変更の影響を答える。 */
  private requirementImpact(ctx: AiContext): AiResult | undefined {
    const a = ctx.analysis;
    const msg = ctx.message;
    const ids = [...a.trace.rows.map((r) => ({ id: r.id, label: r.label }))].filter((r) => msg.includes(r.label) || msg.includes(r.id));
    const hit = ids.sort((p, q) => q.label.length - p.label.length)[0];
    if (!hit) return undefined;
    const r = impactOfRequirementChange(a, ctx.safety, hit.id);
    if (!r) return undefined;
    const nm = (id: string) => a.net.elements.find((e) => e.id === id)?.name ?? id;
    const lines = [
      `要求 ${hit.label} を変更したときに、影響しうる範囲(機械的にたどった結果。影響の有無は人が判断してください):`,
      `- 下位の要求: ${r.requirements.map((x) => x.split("::").pop()).join("、") || "なし"} / 上位(整合の確認): ${r.upstream.map((x) => x.split("::").pop()).join("、") || "なし"} / 分解の相手: ${r.partners.join("、") || "なし"}`,
      `- 構造要素: ${r.elements.map(nm).join("、") || "なし"}`,
      `- 機能 ${r.functions.length} 件、故障ノード ${r.failures.length} 件`,
      `- 見直す FMEA: ${r.fmeaElements.map(nm).join("、") || "なし"}`,
      `- 意図機能: ${r.intendedFunctions.join("、") || "なし"} / 安全機構: ${r.mechanisms.join("、") || "なし"} / ペア: ${r.pairs.join("、") || "なし"} / 分解: ${r.decompositions.join("、") || "なし"}`,
      "",
      "経路:",
      ...r.reasons.slice(0, 12).map((x) => `- ${x}`),
    ];
    return this.result(lines.join("\n"));
  }

  private summary(ctx: AiContext): AiResult {
    return this.result(analysisSummaryText(ctx.analysis, ctx.projectName));
  }

  private review(ctx: AiContext): AiResult {
    const a = ctx.analysis;
    const errors = a.issues.filter((i) => i.severity === "error");
    const warns = a.issues.filter((i) => i.severity === "warning");
    const fmt = (i: (typeof a.issues)[number]) =>
      `- [${VIEWPOINTS.find((v) => v.key === i.viewpoint)?.label}${i.elementId ? `/${levelLabel(a.levelOf[i.elementId] ?? "system")}` : ""}] ${i.message}${i.ref ? `(${i.ref.split("::").pop()})` : ""}`;
    const lines = [
      `安全の観点でのレビュー結果: エラー ${errors.length} 件、警告 ${warns.length} 件(自動チェックによる。専門家の確認の代わりにはなりません)。`,
      "",
      errors.length ? `■ エラー(先に直すもの)\n${errors.slice(0, 10).map(fmt).join("\n")}` : "■ エラーはありません。",
      warns.length ? `\n■ 警告(確認が必要なもの)\n${warns.slice(0, 10).map(fmt).join("\n")}` : "",
      "",
      "■ 追加で人が確認すべき点",
      "- ハザード分析(S/E/C)の根拠が運転状況と整合しているか",
      "- ASIL 分解の独立性(依存故障解析・干渉の無いこと)の根拠が十分か",
      "- 故障モードの網羅性(ガイドワードの候補を、実際の故障メカニズムで検討したか)",
      "- 安全機構の診断カバレッジと FTTI が、安全目標を満たすか",
    ];
    return this.result(lines.join("\n"));
  }

  private decomposition(ctx: AiContext): AiResult {
    const table: Record<string, string> = { D: "D(D)+QM(D) / C(D)+A(D) / B(D)+B(D)", C: "C(C)+QM(C) / B(C)+A(C)", B: "B(B)+QM(B) / A(B)+A(B)", A: "A(A)+QM(A)" };
    const mentioned = (["D", "C", "B", "A"] as Asil[]).filter((a) => new RegExp(`ASIL\\s*${a}\\b`, "i").test(ctx.message));
    const target = mentioned.length ? mentioned : (["D", "C", "B", "A"] as Asil[]);
    const lines = [
      "ASIL デコンポジション(ISO 26262-9)で許される分解の組み合わせ:",
      ...target.map((a) => `- ASIL ${a}: ${table[a]}`),
      "",
      "分解にあたっての注意:",
      "- 分解先の要素は互いに独立でなければなりません(依存故障解析・干渉の無いことの根拠が必要)。",
      "- 元の ASIL は括弧で保持します(例: B(D))。",
      "- 分解済みの要求の再分解は、専門家の確認が必要です(ツールは警告します)。",
      "",
      "本ツールは、分解の組み合わせと独立性の根拠の有無を検査します。分解してよいかの判断は人が行ってください。",
    ];
    const unalloc = ctx.safety.safetyRequirements.filter((r) => asilRank(r.asil) >= asilRank("B") && !ctx.safety.decompositions.some((d) => d.parentRequirementId === r.id) && !r.originAsil && r.level !== "safety-goal");
    if (unalloc.length) lines.push("", `分解の検討対象になりうる要求(ASIL B 以上で未分解): ${unalloc.map((r) => `${r.id}(ASIL ${r.asil})`).join("、")}`);
    return this.result(lines.join("\n"));
  }

  private hara(ctx: AiContext): AiResult {
    const mm = /S\s*([0-3])\D{0,6}E\s*([0-4])\D{0,6}C\s*([0-3])/i.exec(ctx.message);
    if (mm) {
      const s = Number(mm[1]) as 0 | 1 | 2 | 3;
      const e = Number(mm[2]) as 0 | 1 | 2 | 3 | 4;
      const c = Number(mm[3]) as 0 | 1 | 2 | 3;
      return this.result(`S${s} / E${e} / C${c} の ASIL は ${determineAsil(s, e, c)} です(ISO 26262-3 の ASIL 決定表)。S・E・C の評価の根拠は、運転状況とあわせて記録してください。`);
    }
    const g = ctx.safety.hara.goals.map((x) => `- ${x.id}: ${x.text}(ASIL ${x.asil})`);
    return this.result(["現在の安全目標:", ...(g.length ? g : ["- (未定義)"]), "", "S/E/C の組み合わせ(例: 「S3 E4 C3 の ASIL」)を質問すると、ASIL 決定表で判定します。"].join("\n"));
  }

  private answerFromRefs(ctx: AiContext): AiResult {
    const hits = ctx.refs.search(ctx.message, 3);
    if (hits.length === 0)
      return this.result(
        [
          "参照資料に、この質問の根拠となる記述が見つかりませんでした。根拠のない推測では回答しません。",
          "",
          "次のような質問ができます: 「モータの FMEA を実施して」「変更の影響分析」「図の要約」「安全の観点でレビュー」「ASIL D の分解」「S3 E4 C3 の ASIL」",
        ].join("\n"),
      );
    const citations = hits.map(toCitation);
    return this.result(
      ["参照資料から、関連する記述を示します(出典つき):", "", ...hits.map((h, i) => `${i + 1}. 『${h.chunk.source}』${h.chunk.lines[0]}〜${h.chunk.lines[1]} 行\n${h.chunk.text.split("\n").map((l) => `   > ${l}`).join("\n")}`)].join("\n"),
      { citations },
    );
  }
}

