/**
 * 図やエクスプローラからの、SysML v2 テキストの書き換え（要素の追加・名前変更・削除）。
 *
 * モデルの正はテキスト。図からの編集は、公式実装が出力した要素の位置（range / nameRange）を使って、
 * テキストを最小限だけ書き換える。位置が現在のテキストと合わないとき（解析が古い）は、書き換えずに理由を返す。
 * 書き換えたあとの解析（公式実装）は呼び出し側が行う。
 */
import type { ElementGraph, GraphElement } from "./types.js";

export type EditResult =
  | { ok: true; text: string; /** 変更の説明（画面に出す） */ summary: string; /** 追加した要素の ID（完全修飾名） */ createdQn?: string; /** 名前変更で ID（完全修飾名）が変わるときの、(旧 → 新) の接頭辞 */ idChange?: { from: string; to: string } }
  | { ok: false; reason: string };

export type NewKind = "part" | "function";

const fail = (reason: string): EditResult => ({ ok: false, reason });
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 名前としてそのままは書けない語（引用符で囲む） */
const KEYWORDS = new Set([
  "part", "action", "attribute", "item", "port", "connection", "interface", "flow", "state", "requirement", "constraint", "package", "import", "alias", "def",
  "perform", "satisfy", "verify", "allocate", "allocation", "dependency", "metadata", "ref", "in", "out", "inout", "doc", "comment", "about", "by", "to", "from",
  "first", "then", "if", "else", "for", "loop", "while", "until", "assign", "send", "accept", "via", "subject", "objective", "actor", "stakeholder", "concern",
  "abstract", "variation", "variant", "individual", "snapshot", "timeslice", "readonly", "derived", "end", "private", "public", "protected", "true", "false", "null",
  "library", "standard", "type", "feature", "specializes", "subsets", "redefines", "references", "conjugates", "chains", "inverse", "of", "as", "istype", "hastype",
  "case", "analysis", "verification", "use", "view", "viewpoint", "rendering", "enum", "occurrence", "event", "message", "succession", "bind", "exhibit", "include",
  "calc", "return", "result", "expose", "filter", "language", "rep", "render", "all", "meta", "new", "default", "do", "entry", "exit", "decide", "merge", "fork", "join",
]);

/** 名前を SysML のテキストに書ける形にする（識別子でない・予約語なら、単一引用符で囲む）。使えない名前は undefined。 */
export function encodeName(name: string): string | undefined {
  const n = name.trim();
  if (n.length === 0 || n.length > 100 || /[\r\n\t]/.test(n)) return undefined;
  if (IDENT.test(n) && !KEYWORDS.has(n)) return n;
  return `'${n.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** テキスト上の名前（引用符つき）から、名前そのものを取り出す。 */
export function decodeName(raw: string): string {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/\\(.)/g, "$1");
  return raw;
}

// ----- 字句の走査（コメント・文字列・引用名を飛ばす） -----

type Span = { start: number; end: number; kind: "code" | "skip" };

/** テキストを、コード部分と、飛ばす部分（コメント・文字列・引用名）に分ける。 */
function spans(text: string): Span[] {
  const out: Span[] = [];
  let i = 0;
  let codeStart = 0;
  const flush = (to: number) => {
    if (to > codeStart) out.push({ start: codeStart, end: to, kind: "code" });
  };
  while (i < text.length) {
    const c = text[i]!;
    const n = text[i + 1];
    let end = -1;
    if (c === "/" && n === "/") {
      const nl = text.indexOf("\n", i);
      end = nl < 0 ? text.length : nl;
    } else if (c === "/" && n === "*") {
      const close = text.indexOf("*/", i + 2);
      end = close < 0 ? text.length : close + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      end = Math.min(text.length, j + 1);
    }
    if (end < 0) {
      i++;
      continue;
    }
    flush(i);
    out.push({ start: i, end, kind: "skip" });
    i = end;
    codeStart = end;
  }
  flush(text.length);
  return out;
}

/** 宣言 [start, end) の本体の `{` と `}` の位置。本体が無い（`;` で終わる）なら undefined。 */
function bodyOf(text: string, start: number, end: number): { open: number; close: number } | undefined {
  let depth = 0;
  for (const sp of spans(text.slice(start, end))) {
    if (sp.kind !== "code") continue;
    const code = text.slice(start + sp.start, start + sp.end);
    for (let k = 0; k < code.length; k++) {
      const ch = code[k]!;
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      else if (ch === "{" && depth === 0) {
        const close = end - 1;
        return text[close] === "}" ? { open: start + sp.start + k, close } : undefined;
      }
    }
  }
  return undefined;
}

const lineStart = (text: string, pos: number) => text.lastIndexOf("\n", pos - 1) + 1;
const indentAt = (text: string, pos: number) => /^[ \t]*/.exec(text.slice(lineStart(text, pos)))![0];

// ----- 検査 -----

function find(graph: ElementGraph, qn: string): GraphElement | undefined {
  return graph.elements.find((e) => e.qualifiedName === qn);
}

/** 図から編集できるか（型から展開された要素・位置のない要素・テキストと合わない要素は不可）。 */
export function editability(text: string, graph: ElementGraph, qn: string): { ok: true; el: GraphElement } | { ok: false; reason: string } {
  const el = find(graph, qn);
  if (!el) return { ok: false, reason: "型（定義）から展開された要素です。定義の側で編集してください" };
  if (!el.range || !el.nameRange) return { ok: false, reason: "この要素はテキスト上の位置がないため、図から編集できません（テキストで編集してください）" };
  const [ns, ne] = el.nameRange;
  const [rs, re] = el.range;
  if (ne > text.length || re > text.length || decodeName(text.slice(ns, ne)) !== (el.name ?? "")) return { ok: false, reason: "モデルのテキストが変更されています。解析が終わってから、もう一度操作してください" };
  if (rs > ns || ne > re) return { ok: false, reason: "要素の位置が不正です" };
  return { ok: true, el };
}

const childrenOf = (graph: ElementGraph, qn: string) => graph.elements.filter((e) => e.owner === qn);

/** 追加できる先（最上位に追加する場合の、受け皿のパッケージ）を決める。 */
function rootContainer(graph: ElementGraph): GraphElement | undefined {
  const top = graph.elements.find((e) => e.kind === "PartUsage" && e.owner && find(graph, e.owner)?.kind === "Package");
  return (top?.owner ? find(graph, top.owner) : undefined) ?? graph.elements.find((e) => e.kind === "Package" && e.range);
}

// ----- 追加 -----

/** 要素の中に、部品または機能を追加する。parentQn が undefined なら、最上位（パッケージ直下）に部品を追加する。 */
export function addChild(text: string, graph: ElementGraph, parentQn: string | undefined, kind: NewKind, rawName: string): EditResult {
  const enc = encodeName(rawName);
  if (!enc) return fail("名前を入力してください（100 文字まで、改行は使えません）");
  const name = decodeName(enc);
  let parent: GraphElement | undefined;
  if (parentQn === undefined) {
    if (kind === "function") return fail("機能は、要素を選んでから、その中に追加してください");
    parent = rootContainer(graph);
    if (!parent) return fail("追加先のパッケージが見つかりません");
  } else {
    const chk = editability(text, graph, parentQn);
    if (!chk.ok) return fail(chk.reason);
    parent = chk.el;
  }
  if (childrenOf(graph, parent.qualifiedName).some((e) => e.name === name)) return fail(`同じ名前の要素が既にあります: ${name}`);
  if (!parent.range) return fail("追加先の位置が分かりません");
  const [rs, re] = parent.range;
  const stmt = kind === "part" ? `part ${enc};` : `perform action ${enc};`;
  const body = bodyOf(text, rs, re);
  const parentIndent = indentAt(text, rs);
  if (body) {
    const inner = text.slice(body.open + 1, body.close);
    const sample = /\n([ \t]+)\S/.exec(inner);
    const indent = sample ? sample[1]! : `${parentIndent}    `;
    const ls = lineStart(text, body.close);
    const closeOnOwnLine = text.slice(ls, body.close).trim() === "";
    const out = closeOnOwnLine
      ? `${text.slice(0, ls)}${indent}${stmt}\n${text.slice(ls)}`
      : `${text.slice(0, body.close)}\n${indent}${stmt}\n${parentIndent}${text.slice(body.close)}`;
    return { ok: true, text: out, createdQn: `${parent.qualifiedName}::${name}`, summary: `${parent.name ?? "最上位"} に ${kind === "part" ? "部品" : "機能"}「${name}」を追加しました` };
  }
  // 本体が無い（`part x;`）: `;` を本体に置き換える
  const semi = re - 1;
  if (text[semi] !== ";") return fail("追加先の宣言の形が想定と異なるため、図から追加できません（テキストで編集してください）");
  const indent = `${parentIndent}    `;
  const out = `${text.slice(0, semi)} {\n${indent}${stmt}\n${parentIndent}}${text.slice(re)}`;
  return { ok: true, text: out, createdQn: `${parent.qualifiedName}::${name}`, summary: `${parent.name ?? "最上位"} に ${kind === "part" ? "部品" : "機能"}「${name}」を追加しました` };
}

// ----- 名前変更 -----

/** 宣言名と同じ名前の識別子の出現位置（コメント・文字列・引用名の外）。宣言そのものを含む。 */
function occurrences(text: string, name: string): number[] {
  const out: number[] = [];
  if (!IDENT.test(name)) return out;
  for (const sp of spans(text)) {
    if (sp.kind !== "code") continue;
    const code = text.slice(sp.start, sp.end);
    const re = new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`, "g");
    for (let m = re.exec(code); m; m = re.exec(code)) out.push(sp.start + m.index);
  }
  return out;
}

/**
 * 名前変更。宣言の名前を書き換える。updateReferences=true で、同じ名前の他の出現（参照）も書き換える。
 * ただし、同じ名前の宣言が他にもある（どれを指すか決められない）ときは、参照を書き換えず、その旨を返す。
 */
export function renameElement(text: string, graph: ElementGraph, qn: string, rawNew: string, updateReferences = true): EditResult {
  const chk = editability(text, graph, qn);
  if (!chk.ok) return fail(chk.reason);
  const el = chk.el;
  const enc = encodeName(rawNew);
  if (!enc) return fail("名前を入力してください（100 文字まで、改行は使えません）");
  const newName = decodeName(enc);
  const oldName = el.name ?? "";
  if (newName === oldName) return fail("名前が変わっていません");
  if (graph.elements.some((e) => e.owner === el.owner && e.name === newName && e.qualifiedName !== qn)) return fail(`同じ名前の要素が既にあります: ${newName}`);
  const [ns, ne] = el.nameRange!;
  const sameName = graph.elements.filter((e) => e.name === oldName && e.range).length;
  const edits: { at: number; len: number }[] = [{ at: ns, len: ne - ns }];
  let refs = 0;
  let note = "";
  if (updateReferences) {
    if (sameName > 1) note = `（同じ名前「${oldName}」の宣言が他にもあるため、参照は書き換えていません）`;
    else
      for (const at of occurrences(text, oldName)) {
        if (at === ns || (at >= ns && at < ne)) continue;
        edits.push({ at, len: oldName.length });
        refs++;
      }
  }
  let out = text;
  for (const e of edits.sort((x, y) => y.at - x.at)) out = `${out.slice(0, e.at)}${enc}${out.slice(e.at + e.len)}`;
  const from = qn;
  const to = `${qn.slice(0, qn.length - lastSegment(qn).length)}${newName}`;
  return {
    ok: true,
    text: out,
    summary: `「${oldName}」を「${newName}」に変更しました${refs > 0 ? `（参照 ${refs} 件も書き換え）` : ""}${note}`,
    idChange: { from, to },
  };
}

const lastSegment = (qn: string) => qn.slice(qn.lastIndexOf("::") + 2);

// ----- 削除 -----

/** 要素（とその中身）を削除する。 */
export function removeElement(text: string, graph: ElementGraph, qn: string): EditResult {
  const chk = editability(text, graph, qn);
  if (!chk.ok) return fail(chk.reason);
  if (chk.el.kind === "Package") return fail("パッケージは図から削除できません（テキストで編集してください）");
  const [rs, re] = chk.el.range!;
  let a = rs;
  let b = re;
  // 行を丸ごと使っている宣言は、前の空白と後ろの改行も一緒に消す
  const ls = lineStart(text, rs);
  const after = /^[ \t]*\r?\n?/.exec(text.slice(re))![0];
  if (text.slice(ls, rs).trim() === "" && (after.includes("\n") || re + after.length >= text.length)) {
    a = ls;
    b = re + after.length;
  }
  const n = graph.elements.filter((e) => e.qualifiedName.startsWith(`${qn}::`)).length;
  return { ok: true, text: text.slice(0, a) + text.slice(b), summary: `「${chk.el.name ?? qn}」${n > 0 ? `と内部の ${n} 要素` : ""}を削除しました` };
}

// ----- 安全分析データの ID の付け替え -----

/** 名前変更で変わった要素 ID（完全修飾名の接頭辞）を、安全分析データの全体で付け替える。aiChanges（来歴）は触らない。 */
export function remapIds<T>(data: T, from: string, to: string): T {
  const map = (s: string) => (s === from ? to : s.startsWith(`${from}::`) ? `${to}${s.slice(from.length)}` : s);
  const walk = (v: unknown, key?: string): unknown => {
    if (key === "aiChanges") return v;
    if (typeof v === "string") return map(v);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [map(k), walk(x, k)]));
    return v;
  };
  return walk(data) as T;
}
