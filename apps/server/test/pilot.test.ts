import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { codeOnly, libraryPlan, untar, zipEntry } from "../src/sysml/pilot.js";

/** 最小の tar を作る（ustar。長い名前は pax ヘッダー） */
function tarHeader(name: string, size: number, type = "0"): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write("0000644\0", 100);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write(type, 156);
  h.write("ustar\0" + "00", 257);
  return h;
}
const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
const entry = (name: string, body: string, type = "0") => Buffer.concat([tarHeader(name, Buffer.byteLength(body), type), pad(Buffer.from(body))]);
async function* chunks(b: Buffer, n: number) {
  for (let i = 0; i < b.length; i += n) yield b.subarray(i, i + n);
}

describe("tar の展開（取得したパッケージを Node だけで開く）", () => {
  it("必要なファイルだけを書き出し、それ以外は読み飛ばす。細かく分割された入力でも同じ結果", async () => {
    const root = mkdtempSync(join(tmpdir(), "fusamod-tar-"));
    try {
      const tar = Buffer.concat([entry("a/keep.txt", "hello"), entry("a/skip.bin", "x".repeat(1300)), entry("a/keep2.txt", "日本語"), Buffer.alloc(1024)]);
      for (const n of [7, 512, 100_000]) {
        const written: string[] = [];
        const count = await untar(chunks(tar, n), (p) => (p.includes("keep") ? join(root, `${n}`, p) : undefined));
        written.push(readFileSync(join(root, `${n}`, "a/keep.txt"), "utf8"), readFileSync(join(root, `${n}`, "a/keep2.txt"), "utf8"));
        expect(count).toBe(2);
        expect(written).toEqual(["hello", "日本語"]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("pax の長い名前に対応する", async () => {
    const root = mkdtempSync(join(tmpdir(), "fusamod-tar-"));
    try {
      const long = `dir/${"d".repeat(120)}/file.txt`;
      const rec = ` path=${long}\n`;
      const paxBody = `${String(rec.length + String(rec.length).length)}${rec}`;
      const tar = Buffer.concat([entry("PaxHeader", paxBody, "x"), entry("short", "body"), Buffer.alloc(1024)]);
      let seen = "";
      await untar(chunks(tar, 300), (p) => { seen = p; return join(root, "out.txt"); });
      expect(seen).toBe(long);
      expect(readFileSync(join(root, "out.txt"), "utf8")).toBe("body");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("zip から目的のエントリを取り出す", () => {
  function zip(name: string, data: Buffer, deflate: boolean): Buffer {
    const body = deflate ? deflateRawSync(data) : data;
    const nm = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(deflate ? 8 : 0, 10);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nm.length, 28);
    cd.writeUInt32LE(0, 42);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(46 + nm.length, 12);
    eocd.writeUInt32LE(30 + nm.length + body.length, 16);
    return Buffer.concat([local, nm, body, cd, nm, eocd]);
  }
  it("無圧縮と deflate の両方を読める。無い名前は例外", () => {
    const data = Buffer.from("payload-1234567890".repeat(20));
    for (const d of [false, true]) expect(zipEntry(zip("pkg-x.tar.zst", data, d), (n) => n.startsWith("pkg-")).equals(data)).toBe(true);
    expect(() => zipEntry(zip("other", data, false), (n) => n.startsWith("pkg-"))).toThrow();
    expect(() => zipEntry(Buffer.from("not a zip"), () => true)).toThrow();
  });
});

describe("変換に追加するライブラリの判断（コメントや文字列では反応しない）", () => {
  it("コメント・文字列・引用名を除いたコードだけを見る。文字列内の // や行コメント内の /* に惑わされない（N15）", () => {
    const t = '// generated from docs/*.md\npackage S5 {\n  part src { attribute u = "http://example.org/b"; }\n  private import SCDL::*;   /* end */\n  part p { @ScdlElement { title = "p"; } }\n}\n';
    expect(libraryPlan(t).scdl).toBe(true);
    expect(codeOnly(t)).not.toContain("example.org");
    expect(codeOnly(t)).toContain("import SCDL");
  });
  it("コメントや文字列に SCDL / [RFC] と書いただけでは取り込まない。単位式・ISQ の import では取り込む", () => {
    expect(libraryPlan("// SCDL の説明\n/* 3 [RFC] */ package C { part p; attribute n = \"@ScdlElement\"; }")).toEqual({ units: false, scdl: false });
    expect(libraryPlan("package C { private import ISQ::*; }").units).toBe(true);
    expect(libraryPlan("package C { attribute m = 5 [kg]; }").units).toBe(true);
  });
  it("SCDL 自身を定義するモデルには、SCDL を重ねて取り込まない", () => {
    expect(libraryPlan("library package SCDL {\n part def X;\n}\n @ScdlElement").scdl).toBe(false);
  });
});
