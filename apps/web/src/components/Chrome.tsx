import { useState } from "react";
import { dismissToast, login, useStore } from "../store.js";

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
  if (!need) return null;
  return (
    <div className="dialog-back" role="presentation">
      <form className="dialog stack" role="dialog" aria-modal="true" aria-labelledby="login-title" onSubmit={(e) => { e.preventDefault(); void login(t); }}>
        <h2 id="login-title" style={{ margin: 0 }}>認証が必要です</h2>
        <p className="muted" style={{ margin: 0 }}>管理者から配布されたアクセストークンを入力してください。トークンは、このブラウザのタブにだけ保存されます。</p>
        <input type="password" aria-label="アクセストークン" autoFocus value={t} onChange={(e) => setT(e.target.value)} />
        <button className="btn primary" disabled={!t.trim()}>ログイン</button>
      </form>
    </div>
  );
}
