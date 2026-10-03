import type { FmeaView } from "@fusamod/safety-core";
import { LEVELS, levelLabel } from "./levels.js";
import { VIEWPOINTS, type CellStatus, type ProjectAnalysis } from "./analyze.js";

const STATUS_LABEL: Record<CellStatus, string> = {
  consistent: "整合",
  review: "要確認",
  inconsistent: "不整合",
  undetermined: "未確定",
  none: "—",
};
export const statusLabel = (s: CellStatus) => STATUS_LABEL[s];

/**
 * CSV の 1 セルをエスケープする。表計算ソフトで数式として実行されないよう、
 * 先頭が = + - @ タブ CR の文字列は ' を前置する(CSV インジェクション対策)。数値(負数含む)はそのまま。
 */
export function csvCell(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return "";
  let s = String(v);
  const isNumber = typeof v === "number" || /^-?\d+(\.\d+)?$/.test(s);
  if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel でそのまま開けるよう、BOM 付き・CRLF で出力する。 */
export function toCsv(rows: (string | number | undefined | null)[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const FMEA_HEADER = [
  "構造要素(階層)", "機能", "故障モード(FM)", "故障影響(FE:上位)", "S", "故障原因(FC:下位/根本)", "予防管理", "O", "検出管理", "D", "RPN", "AP",
];

/** FMEA を AIAG-VDA の列構成の行にする。原因ごとに 1 行(原因が無い故障モードは 1 行)。 */
export function fmeaRows(a: ProjectAnalysis, views: Record<string, FmeaView> = a.fmea): (string | number | undefined)[][] {
  const nameOf = new Map(a.net.elements.map((e) => [e.id, e.name]));
  const rows: (string | number | undefined)[][] = [];
  for (const [elementId, view] of Object.entries(views)) {
    const el = `${nameOf.get(elementId) ?? elementId}(${levelLabel(a.levelOf[elementId] ?? "system")})`;
    for (const r of view.rows) {
      const fe = r.effects.map((e) => `${nameOf.get(e.elementId) ?? ""}: ${e.description}`).join(" / ");
      const base = [el, r.functionName, r.failureMode, fe, r.severity];
      if (r.causes.length === 0) rows.push([...base, "", "", "", "", "", ""]);
      for (const c of r.causes)
        rows.push([...base, `${nameOf.get(c.elementId) ?? ""}: ${c.description}`, c.preventionControl, c.occurrence, c.detectionControl, c.detection, c.rpn, c.ap]);
    }
  }
  return rows;
}

export function fmeaCsv(a: ProjectAnalysis, elementId?: string): string {
  const views = elementId ? Object.fromEntries(Object.entries(a.fmea).filter(([k]) => k === elementId)) : a.fmea;
  const apLabel = a.apStatus === "unofficial" ? "AP(非公式のサンプル表)" : a.apStatus === "unknown" ? "AP(出典未確認)" : "AP";
  return toCsv([FMEA_HEADER.map((h) => (h === "AP" ? apLabel : h)), ...fmeaRows(a, views)]);
}

export function traceCsv(a: ProjectAnalysis): string {
  const els = a.trace.elements;
  const head = ["要求", "種別", "ASIL", "内容", ...els.map((e) => e.name)];
  const rows = a.trace.rows.map((r) => [
    r.label,
    r.kind === "sysml" ? "SysML" : "安全要求",
    r.asil ? (r.originAsil && r.originAsil !== r.asil ? `${r.asil}(${r.originAsil})` : r.asil) : "",
    r.text ?? "",
    ...els.map((e) => {
      const c = a.trace.cells.find((x) => x.requirementId === r.id && x.elementId === e.id);
      return c ? (c.relation === "satisfy" ? "satisfy" : "allocate") : "";
    }),
  ]);
  return toCsv([head, ...rows]);
}

export function issuesCsv(a: ProjectAnalysis): string {
  return toCsv([
    ["重大度", "視点", "階層", "発生元", "コード", "内容", "対象"],
    ...a.issues.map((i) => [
      i.severity === "error" ? "エラー" : "警告",
      VIEWPOINTS.find((v) => v.key === i.viewpoint)?.label,
      i.elementId !== undefined ? levelLabel(a.levelOf[i.elementId] ?? "system") : "",
      i.source,
      i.code,
      i.message,
      i.ref,
    ]),
  ]);
}

const mdEsc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** プロジェクトの解析結果を、レビューに回せる Markdown レポートにする。 */
export function reportMarkdown(a: ProjectAnalysis, projectName: string): string {
  const L: string[] = [];
  L.push(`# ${projectName} 安全分析レポート`, "");
  L.push("> このレポートはツールが自動生成したものです。内容の妥当性は、人(安全・MBSE の専門家)が確認してください。", "");
  L.push("## 概要", "");
  L.push(`| 項目 | 値 |`, `|---|---|`);
  L.push(`| 構造要素 | ${a.summary.elements} |`, `| 機能 | ${a.summary.functions} |`, `| 故障ノード | ${a.summary.failures} |`, `| 要求 | ${a.summary.requirements} |`);
  L.push(`| エラー | ${a.summary.errors} |`, `| 警告 | ${a.summary.warnings} |`);
  if (a.summary.maxRpn !== undefined) L.push(`| 最大 RPN | ${a.summary.maxRpn} |`);
  const apText = { none: "未設定(RPN のみ)", declared: "設定済み(出典あり)", unofficial: "**非公式のサンプル表**(実際の分析では正式な表に置き換えてください)", unknown: "**出典が未確認**の表" }[a.apStatus];
  L.push(`| AP 表 | ${apText} |`, "");
  L.push("## パズルビュー(視点 × 階層の整合)", "");
  L.push(`| 階層 | ${VIEWPOINTS.map((v) => v.label).join(" | ")} |`, `|---|${VIEWPOINTS.map(() => "---").join("|")}|`);
  for (const l of LEVELS)
    L.push(`| ${l.label} | ${VIEWPOINTS.map((v) => { const c = a.puzzle.cells[l.key][v.key]; return c.status === "none" ? "—" : `${statusLabel(c.status)}(${c.count})`; }).join(" | ")} |`);
  L.push("");
  L.push("## 指摘事項", "");
  if (a.issues.length === 0) L.push("指摘はありません。", "");
  else {
    L.push(`| 重大度 | 視点 | コード | 内容 | 対象 |`, `|---|---|---|---|---|`);
    for (const i of [...a.issues].sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "error" ? -1 : 1)))
      L.push(`| ${i.severity === "error" ? "エラー" : "警告"} | ${VIEWPOINTS.find((v) => v.key === i.viewpoint)?.label} | ${i.code} | ${mdEsc(i.message)} | ${mdEsc(i.ref)} |`);
    L.push("");
  }
  L.push("## FMEA", "");
  const rows = fmeaRows(a);
  if (rows.length === 0) L.push("FMEA の行はありません。", "");
  else {
    L.push(`| ${FMEA_HEADER.join(" | ")} |`, `|${FMEA_HEADER.map(() => "---").join("|")}|`);
    for (const r of rows) L.push(`| ${r.map(mdEsc).join(" | ")} |`);
    L.push("");
  }
  return L.join("\n");
}
