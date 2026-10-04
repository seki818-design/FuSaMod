import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { dismissToast, exitViewMax, login, useStore } from "../store.js";

/** 画面の描画中に起きた予期しないエラーを捕まえ、真っ白にせず、原因と戻り方を表示する。 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error; info?: string }> {
  override state: { error?: Error; info?: string } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("画面の描画でエラー", error, info.componentStack);
    this.setState({ info: info.componentStack?.split("\n").slice(0, 8).join("\n") });
  }
  override render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="empty" role="alert" style={{ padding: 16, textAlign: "left" }}>
        <h2>画面の表示中にエラーが発生しました</h2>
        <p>{error.message}</p>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 220, overflow: "auto" }}>{error.stack?.split("\n").slice(0, 6).join("\n")}{info ? `\n--\n${info}` : ""}</pre>
        <div className="row">
          <button className="btn primary" onClick={() => { exitViewMax(); this.setState({ error: undefined, info: undefined }); }}>画面を元に戻す</button>
          <button className="btn" onClick={() => location.reload()}>再読み込み</button>
          <span className="muted">このメッセージ（上の文面）を、開発者に伝えてください。</span>
        </div>
      </div>
    );
  }
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="region" aria-label="通知" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          <div className="row"><span style={{ flex: 1 }}>{t.text}</span><button className="btn small" onClick={() => dismissToast(t.id)} aria-label="通知を閉じる">✕</button></div>
          {t.details && <ul>{t.details.slice(0, 8).map((d, i) => <li key={i}>{d}</li>)}</ul>}
        </div>
      ))}
    </div>
  );
}

export function LoginDialog() {
  const need = useStore((s) => s.needLogin);
  const [t, setT] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (need) input.current?.focus(); // ダイアログを開いたとき、入力欄にフォーカスする
  }, [need]);
  if (!need) return null;
  return (
    <div className="dialog-back" role="presentation">
      <form className="dialog stack" role="dialog" aria-modal="true" aria-labelledby="login-title" onSubmit={(e) => { e.preventDefault(); void login(t); }}>
        <h2 id="login-title" style={{ margin: 0 }}>認証が必要です</h2>
        <p className="muted" style={{ margin: 0 }}>管理者から配布されたアクセストークンを入力してください。トークンは、このブラウザのタブにだけ保存されます。</p>
        <input ref={input} type="password" aria-label="アクセストークン" value={t} onChange={(e) => setT(e.target.value)} />
        <button className="btn primary" disabled={!t.trim()}>ログイン</button>
      </form>
    </div>
  );
}
