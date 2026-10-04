import { useEffect, useRef, useState } from "react";
import type { Proposal } from "../api.js";
import { applyProposal, rejectProposal, sendChat, useStore } from "../store.js";

const OP_LABEL: Record<string, string> = {
  addFailure: "故障ノードを追加", addLink: "故障リンクを追加", setLinkRatings: "評価値・管理を設定", setSeverity: "重大度を設定", addHazardEvent: "ハザード事象を追加",
  addSafetyGoal: "安全目標を追加", addIntendedFunction: "意図機能を追加", addMechanism: "安全機構を追加", addPair: "ペアを追加", addSafetyRequirement: "安全要求を追加",
  addDecomposition: "ASIL 分解を追加", addSignalFlow: "信号フローを追加",
};

export function describeOp(op: Record<string, unknown>): string {
  const o = op as Record<string, Record<string, unknown> | string | number | undefined>;
  const detail =
    (o["failure"] as { description?: string } | undefined)?.description ??
    (o["link"] ? `${(o["link"] as { causeId: string }).causeId} → ${(o["link"] as { effectId: string }).effectId}` : undefined) ??
    (o["linkId"] as string | undefined) ??
    (o["failureId"] as string | undefined) ??
    "";
  return `${OP_LABEL[String(op["op"])] ?? String(op["op"])}${detail ? `: ${detail}` : ""}`;
}

function ProposalCard({ p }: { p: Proposal }) {
  return (
    <div className="proposal" role="group" aria-label={`提案: ${p.title}`}>
      <strong>{p.title}</strong>
      <div className="muted">{p.provider.name}{p.provider.model ? `(${p.provider.model})` : ""} · {p.status === "pending" ? "承認待ち" : p.status === "applied" ? `適用済み(${p.decidedBy ?? ""})` : `却下(${p.decidedBy ?? ""})`}</div>
      <div style={{ fontSize: 13 }}>{p.rationale}</div>
      <ul>{p.operations.map((o, i) => <li key={i}>{describeOp(o)}</li>)}</ul>
      {p.status === "pending" && (
        <div className="row">
          <button className="btn small primary" onClick={() => void applyProposal(p.id)}>承認して適用</button>
          <button className="btn small" onClick={() => void rejectProposal(p.id)}>却下</button>
        </div>
      )}
    </div>
  );
}

const CHIPS = ["図の要約", "変更の影響分析", "安全の観点でレビュー", "FMEA を実施して", "ASIL D の分解を教えて"];

export function AiPanel() {
  const chat = useStore((s) => s.chat);
  const proposals = useStore((s) => s.proposals);
  const busy = useStore((s) => s.busy.chatting);
  const ready = useStore((s) => s.analysis !== null);
  const sel = useStore((s) => s.selectedElementId);
  const selName = useStore((s) => s.analysis?.net.elements.find((e) => e.id === s.selectedElementId)?.name);
  const aiMode = useStore((s) => s.health?.ai);
  const modelOk = useStore((s) => s.modelOk);
  const sysmlError = useStore((s) => s.sysmlError);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // effect は何も返さない（ブラウザの拡張機能などが scrollIntoView の戻り値を変えても、クリーンアップとして呼ばれてエラーにならないように）
    end.current?.scrollIntoView?.({ block: "end" });
  }, [chat.length, busy]);
  const submit = () => { if (text.trim()) { void sendChat(text); setText(""); } };
  return (
    <section className="panel" aria-label="AI との対話スペース">
      <header><h2>AI との対話スペース</h2><div className="grow" /><span className="badge undet" title="AI の提案は、承認するまでデータに反映されません">承認制</span></header>
      {!ready && (
        <div className="banner" role="note">
          AI を使うには、モデルを解析できている必要があります。{sysmlError ? `(${sysmlError})` : modelOk ? "" : "モデルにエラーがあります。テキストで修正してください。"}
        </div>
      )}
      {ready && aiMode === "rule-based" && (
        <details className="banner" role="note">
          <summary>いまの AI は簡易版(ルール)です — 自由な質問・文章生成には Claude への接続が必要です</summary>
          <p style={{ margin: "6px 0 0" }}>
            できること: 参照資料の検索(出典つき)、「FMEA を実施して」「ASIL D の分解を教えて」「変更の影響分析」などの決まった依頼。<br />
            自由な依頼を使うには、サーバーの起動前に環境変数を設定します(PowerShell の例):<br />
            <code>$env:FUSAMOD_AI_PROVIDER="claude"; $env:ANTHROPIC_API_KEY="取得したキー"</code><br />
            この設定にすると、モデルと参照資料の抜粋が外部の API に送信されます。
          </p>
        </details>
      )}
      <div className="chat" role="log" aria-live="polite" aria-label="対話の履歴">
        {chat.length === 0 && <div className="muted">質問や依頼を入力してください。例: 「{selName ?? "motor"} の FMEA を実施して」「安全状態は何ですか」(参照資料に根拠がある場合は、出典つきで答えます)</div>}
        {chat.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
            <div>{m.text}</div>
            {m.citations?.slice(0, 3).map((c, i) => <div className="cite" key={i}>出典: {c.source}{c.lines ? `(${c.lines[0]}〜${c.lines[1]} 行)` : ""}<br />{c.quote}</div>)}
            {m.dropped?.map((d, i) => <div className="muted" key={i}>※ {d}</div>)}
            {m.proposalIds?.map((id) => { const p = proposals.find((x) => x.id === id); return p ? <ProposalCard key={id} p={p} /> : null; })}
          </div>
        ))}
        {busy && <div className="msg assistant muted" role="status">考え中…</div>}
        <div ref={end} />
      </div>
      <div className="chips" aria-label="クイックアクション">
        {CHIPS.map((c) => <button key={c} className="chip" disabled={!ready || busy} onClick={() => void sendChat(sel && c.includes("FMEA") && selName ? `${selName} の FMEA を実施して` : c)}>{c}</button>)}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input type="text" aria-label="AI への質問" placeholder="質問を入力してください…" value={text} onChange={(e) => setText(e.target.value)} disabled={!ready} maxLength={2000} />
        <button className="btn primary" disabled={!text.trim() || busy || !ready}>送信</button>
      </form>
    </section>
  );
}
