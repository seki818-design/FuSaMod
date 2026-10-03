import { describe, expect, it } from "vitest";
import { analyzeProject, csvCell, fmeaCsv, fmeaRows, issuesCsv, reportMarkdown, toCsv, traceCsv } from "../src/index.js";
import { demoGraph, demoSafety, PT } from "./helpers.js";

const a = analyzeProject(demoGraph(), demoSafety());

describe("CSV", () => {
  it("BOM 付き・CRLF で、カンマ/引用符/改行をエスケープする", () => {
    const csv = toCsv([["a,b", 'c"d', "e\nf"]]);
    expect(csv).toBe('﻿"a,b","c""d","e\nf"\r\n');
  });
  it("数式として実行されないよう先頭の = + - @ を無害化する(数値は除く)", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("FMEA の出力", () => {
  it("AIAG-VDA の列構成で、原因ごとに 1 行", () => {
    const rows = fmeaRows(a);
    const causes = Object.values(a.fmea).flatMap((v) => v.rows).reduce((n, r) => n + Math.max(1, r.causes.length), 0);
    expect(rows).toHaveLength(causes);
    const row = rows.find((r) => r[2] === "過大トルクを出力する" && String(r[5]).includes("過大なトルク指令"))!;
    expect(row[0]).toBe("powertrain(サブシステム)");
    expect(row[3]).toBe("vehicle: 意図しない加速");
    expect(row.slice(4)).toEqual([10, "vcu: 過大なトルク指令を出力する", "ソフトウェア静的解析・MC/DC テスト", 3, "指令値の範囲チェックと独立監視", 4, 120, "H"]);
  });
  it("要素を指定して出力できる", () => {
    const csv = fmeaCsv(a, PT);
    expect(csv.startsWith("﻿構造要素(階層),")).toBe(true);
    expect(csv.split("\r\n").filter(Boolean).length).toBe(1 + fmeaRows(a, { [PT]: a.fmea[PT]! }).length);
  });
});

describe("トレース・指摘の出力とレポート", () => {
  it("トレースマトリクス CSV", () => {
    const csv = traceCsv(a);
    expect(csv).toContain("FSR-1b,安全要求,B(D)");
    expect(csv.split("\r\n")[0]).toContain("safetyMonitor");
    expect(csv).toContain("satisfy");
    expect(csv).toContain("allocate");
  });
  it("指摘 CSV", () => {
    expect(issuesCsv(a)).toContain("AP_TABLE_NOT_OFFICIAL");
  });
  it("Markdown レポート: 概要・パズルビュー・指摘・FMEA", () => {
    const md = reportMarkdown(a, "EV パワートレイン");
    expect(md).toContain("# EV パワートレイン 安全分析レポート");
    expect(md).toContain("人(安全・MBSE の専門家)が確認してください");
    for (const h of ["## 概要", "## パズルビュー", "## 指摘事項", "## FMEA"]) expect(md).toContain(h);
    expect(md).toMatch(/\| システム \| 整合\(\d+\) \| 整合\(1\) \|/);
    expect(md).toContain("AP_TABLE_NOT_OFFICIAL");
  });
});
