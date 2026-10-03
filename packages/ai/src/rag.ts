import type { Citation } from "./types.js";

export interface RefDoc {
  name: string;
  text: string;
}
export interface RefChunk {
  source: string;
  lines: [number, number];
  text: string;
}
export interface RefHit {
  chunk: RefChunk;
  score: number;
}

const CJK = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;

/** 語に分ける: 英数字の語 + CJK は 2 文字の連続(bigram)。1 文字の CJK 語は 1 文字として扱う。 */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  const lower = s.toLowerCase();
  for (const w of lower.match(/[a-z0-9_]+/g) ?? []) if (w.length >= 2) out.push(w);
  let run = "";
  const flush = () => {
    if (run.length === 1) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
    run = "";
  };
  for (const ch of lower) {
    if (CJK.test(ch)) run += ch;
    else flush();
  }
  flush();
  return out;
}

/**
 * 参照資料の簡易検索(BM25)。資料を見出し・段落で分割し、行番号つきで返す。
 * 根拠つき回答のため、結果には必ず出典(資料名・行範囲)を付ける。外部の埋め込みモデルは使わない。
 */
export class RefIndex {
  private chunks: RefChunk[] = [];
  private tf: Map<string, number>[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  constructor(docs: RefDoc[], private readonly maxChunkChars = 500) {
    for (const d of docs) this.addDoc(d);
    const total = this.tf.reduce((n, m) => n + [...m.values()].reduce((a, b) => a + b, 0), 0);
    this.avgLen = this.chunks.length ? total / this.chunks.length : 0;
  }

  get size() {
    return this.chunks.length;
  }

  private addDoc(d: RefDoc) {
    const lines = d.text.split(/\r?\n/);
    let start = 0;
    let buf: string[] = [];
    const flush = (end: number) => {
      const text = buf.join("\n").trim();
      if (text) this.push({ source: d.name, lines: [start + 1, end], text });
      buf = [];
    };
    lines.forEach((line, i) => {
      const isHeading = /^#{1,6}\s/.test(line);
      const len = buf.join("\n").length;
      if (buf.length > 0 && (isHeading || len + line.length > this.maxChunkChars || line.trim() === "")) {
        flush(i);
        start = isHeading || line.trim() !== "" ? i : i + 1;
        if (line.trim() === "") return;
      }
      if (buf.length === 0) start = i;
      buf.push(line);
    });
    flush(lines.length);
  }

  private push(c: RefChunk) {
    const tokens = tokenize(c.text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.chunks.push(c);
    this.tf.push(tf);
  }

  /**
   * 質問に関連する箇所を返す。質問の語のうち資料に現れた語の割合(coverage)が minCoverage 未満のものは、
   * 関係が薄いとみなして返さない(無関係な箇所を根拠として示さないため)。
   */
  search(query: string, k = 3, minCoverage = 0.3): RefHit[] {
    const q = [...new Set(tokenize(query))];
    if (q.length === 0 || this.chunks.length === 0) return [];
    const N = this.chunks.length;
    const k1 = 1.5;
    const b = 0.75;
    const hits: RefHit[] = [];
    this.chunks.forEach((chunk, i) => {
      const tf = this.tf[i]!;
      const len = [...tf.values()].reduce((a, c) => a + c, 0) || 1;
      let score = 0;
      let matched = 0;
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        matched++;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * len) / (this.avgLen || 1)));
      }
      if (matched / q.length >= minCoverage) hits.push({ chunk, score });
    });
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }
}

export function toCitation(h: RefHit): Citation {
  const quote = h.chunk.text.replace(/\s+/g, " ").slice(0, 200);
  return { source: h.chunk.source, lines: h.chunk.lines, quote };
}
