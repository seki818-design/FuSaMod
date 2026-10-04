import { useEffect, useRef, useState } from "react";
import { addElement, deleteElement, editBlockReason, renameElementTo, useStore } from "../store.js";

type Mode = "part" | "function" | "rename" | "delete" | undefined;

function labelOf(mode: Mode, name: string | undefined): string {
  if (mode === "function") return `「${name ?? ""}」の機能の名前`;
  if (mode === "rename") return "新しい名前";
  if (mode === "delete") return "";
  return name !== undefined ? `「${name}」の中に追加する部品の名前` : "最上位に追加する部品の名前";
}

/** 要素の追加・名前変更・削除。ダイアグラムの上とエクスプローラで共通。モデルのテキストを書き換え、すぐ再解析する。 */
export function ElementActions({ compact = false }: { compact?: boolean }) {
  const sel = useStore((s) => s.selectedElementId);
  const a = useStore((s) => s.analysis);
  const why = useStore((s) => editBlockReason(s, undefined));
  const whySel = useStore((s) => (s.selectedElementId ? editBlockReason(s, s.selectedElementId) : "要素を選択してください"));
  const [mode, setMode] = useState<Mode>(undefined);
  const [text, setText] = useState("");
  const [refs, setRefs] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode && mode !== "delete") input.current?.focus(); // フォームを開いたら、入力欄に移る
  }, [mode]);
  const el = a?.net.elements.find((e) => e.id === sel);
  const inner = sel && a ? a.net.elements.filter((e) => e.id.startsWith(`${sel}::`)).length : 0;
  const open = (m: Mode) => {
    setMode(m);
    setText(m === "rename" ? (el?.name ?? "") : "");
  };
  const close = () => setMode(undefined);
  const submit = () => {
    let ok = false;
    if (mode === "part") ok = addElement(sel, "part", text);
    else if (mode === "function") ok = addElement(sel, "function", text);
    else if (mode === "rename" && sel) ok = renameElementTo(sel, text, refs);
    else if (mode === "delete" && sel) ok = deleteElement(sel);
    if (ok) close();
  };
  const cls = compact ? "btn small" : "btn small";
  const label = labelOf(mode, sel ? el?.name : undefined);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" role="group" aria-label="要素の編集">
        <button className={cls} disabled={!!why} title={why ?? (sel ? "選択中の要素の中に部品を追加" : "最上位に部品を追加")} onClick={() => open("part")}>＋ 部品</button>
        <button className={cls} disabled={!!whySel} title={whySel ?? "選択中の要素に機能(perform action)を追加"} onClick={() => open("function")}>＋ 機能</button>
        <button className={cls} disabled={!!whySel} title={whySel ?? "選択中の要素の名前を変更"} onClick={() => open("rename")}>✎ 名前</button>
        <button className={`${cls} danger`} disabled={!!whySel} title={whySel ?? "選択中の要素を削除"} onClick={() => open("delete")}>🗑 削除</button>
      </div>
      {mode && (
        <form className="row" aria-label="要素の編集フォーム" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {mode === "delete" ? (
            <span role="alert">「{el?.name}」{inner > 0 ? `と内部の ${inner} 要素` : ""}を削除します。安全分析のデータにある参照は、エラーとして表示されます。</span>
          ) : (
            <>
              <input type="text" ref={input} aria-label={label} placeholder={label} value={text} maxLength={100} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") close(); }} style={{ minWidth: compact ? 120 : 220 }} />
              {mode === "rename" && <label className="row" style={{ fontSize: 12 }}><input type="checkbox" checked={refs} onChange={(e) => setRefs(e.target.checked)} />参照も書き換える</label>}
            </>
          )}
          <button className={`btn small ${mode === "delete" ? "danger" : "primary"}`} disabled={mode !== "delete" && !text.trim()}>{mode === "delete" ? "削除する" : mode === "rename" ? "変更" : "追加"}</button>
          <button type="button" className="btn small" onClick={close}>キャンセル</button>
        </form>
      )}
    </div>
  );
}
