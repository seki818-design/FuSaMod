import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SAFETY = JSON.parse(readFileSync(new URL("../../../projects/ev-powertrain/safety.json", import.meta.url), "utf8"));

/** 各テストの前に、デモプロジェクトの安全データを元に戻す。 */
test.beforeEach(async ({ request }) => {
  const p = await (await request.get("/api/projects/ev-powertrain")).json();
  await request.put("/api/projects/ev-powertrain/safety", { data: { data: SAFETY, baseRevision: p.revision, message: "テストの初期化" } });
});

async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/");
  await page.waitForSelector("svg[aria-label='構造図']");
  return errors;
}
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });

test("起動して、構造図・パズルビュー・FMEA が表示される(エラーなし)", async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByRole("button", { name: /^vehicle 〔/ })).toBeVisible();
  await expect(page.getByRole("table", { name: "視点と階層の整合" })).toBeVisible();
  await expect(page.getByRole("button", { name: /システム・安全: 要確認/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /詳細・要求: 未確定/ })).toBeVisible();
  await expect(page.getByRole("table", { name: "vehicle の FMEA" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("FMEA の発生度を編集すると、RPN が即時に再計算され、保存で確定する。破棄で元に戻る", async ({ page }) => {
  await open(page);
  const o = page.getByLabel("過大トルクを出力する の発生度");
  await expect(o).toHaveValue("3");
  const row = page.getByRole("row", { name: /過大トルクを出力する/ });
  await expect(row).toContainText("90"); // S10 × O3 × D3
  await o.fill("5");
  await expect(row).toContainText("150");
  await expect(page.getByText("● 未保存の変更")).toBeVisible();
  await page.getByRole("button", { name: "変更を破棄" }).click();
  await expect(o).toHaveValue("3");
  await o.fill("5");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存しました")).toBeVisible();
  await expect(page.getByText("● 未保存の変更")).toHaveCount(0);
  await page.reload();
  await page.waitForSelector("svg[aria-label='構造図']");
  await expect(page.getByLabel("過大トルクを出力する の発生度")).toHaveValue("5");
});

test("Ctrl+S で保存できる。範囲外の入力は 1〜10 に収まる", async ({ page }) => {
  await open(page);
  const d = page.getByLabel("過大トルクを出力する の検出度");
  await d.fill("99");
  await expect(d).toHaveValue("10");
  await page.keyboard.press("Control+s");
  await expect(page.getByText("保存しました")).toBeVisible();
});

test("故障モードを追加し、原因(根本原因)を追加できる", async ({ page }) => {
  await open(page);
  await page.getByRole("navigation", { name: "エクスプローラ" }).getByRole("button", { name: /^safetyMonitor/ }).click();
  await expect(page.getByRole("table", { name: "safetyMonitor の FMEA" })).toBeVisible();
  await expect(page.getByText("この要素の機能に、故障モードがありません")).toBeVisible();
  await page.getByRole("button", { name: "＋ 故障モードを追加" }).click();
  await page.getByLabel("故障モードの内容").fill("監視が過大トルクを検出できない");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByText("監視が過大トルクを検出できない").first()).toBeVisible();
  await page.getByRole("button", { name: "＋ 原因" }).click();
  await page.getByLabel("根本原因の内容").fill("監視マイコンの電源喪失");
  await page.getByRole("button", { name: "原因を追加" }).click();
  await expect(page.getByText("safetyMonitor: 監視マイコンの電源喪失")).toBeVisible();
});

test("AI: FMEA の提案 → 承認で適用される(承認するまでデータは変わらない)", async ({ page, request }) => {
  await open(page);
  await page.getByRole("navigation", { name: "エクスプローラ" }).getByRole("button", { name: /^safetyMonitor/ }).click();
  await page.getByLabel("AI への質問").fill("safetyMonitor の FMEA を実施して");
  await page.getByRole("button", { name: "送信" }).click();
  const card = page.getByRole("group", { name: /^提案: 故障モード候補を追加/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText("承認待ち");
  await expect(card).toContainText("評価値");
  let p = await (await request.get("/api/projects/ev-powertrain")).json();
  expect(p.safety.failures.some((f: { id: string }) => f.id.startsWith("AI-FM"))).toBe(false);
  await card.getByRole("button", { name: "承認して適用" }).click();
  await expect(page.getByText(/提案を適用しました/)).toBeVisible();
  await expect(card).toContainText("適用済み");
  p = await (await request.get("/api/projects/ev-powertrain")).json();
  expect(p.safety.failures.filter((f: { id: string }) => f.id.startsWith("AI-FM"))).toHaveLength(2);
  await expect(page.getByRole("table", { name: "safetyMonitor の FMEA" })).toContainText("機能喪失");
});

test("AI: 却下できる。参照資料に根拠があれば出典つきで回答する", async ({ page }) => {
  await open(page);
  await page.getByLabel("AI への質問").fill("safetyMonitor の FMEA");
  await page.getByRole("button", { name: "送信" }).click();
  const card = page.getByRole("group", { name: /^提案:/ });
  await card.getByRole("button", { name: "却下" }).click();
  await expect(card).toContainText("却下");
  await page.getByLabel("AI への質問").fill("安全状態は何ですか");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.getByText(/出典: 機能安全コンセプト\.md|出典: システム設計方針\.md/).first()).toBeVisible();
  await page.getByLabel("AI への質問").fill("社員食堂のメニューは");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.getByText("根拠のない推測では回答しません")).toBeVisible();
});

test("HARA: S を変えると ASIL が変わり、安全目標との不一致が不整合として、パズルビューに表れる", async ({ page }) => {
  await open(page);
  await tab(page, "ハザード分析").click();
  await expect(page.getByRole("row", { name: /HE-1/ })).toContainText("ASIL D");
  await page.getByLabel("HE-1 の S").selectOption("1");
  await expect(page.getByRole("row", { name: /HE-1/ })).toContainText("ASIL B"); // S1 E4 C3
  await expect(page.getByRole("alert").filter({ hasText: "不一致" })).toBeVisible();
  await expect(page.getByRole("button", { name: /システム・安全: 不整合/ })).toBeVisible();
  await page.getByRole("button", { name: /システム・安全: 不整合/ }).click();
  await expect(tab(page, "問題")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("table", { name: "問題の一覧" })).toContainText("ASIL");
});

test("ASIL 分解: 許される組み合わせだけを選べ、同じ要素への割り当ては拒否される", async ({ page }) => {
  await open(page);
  await tab(page, "安全コンセプト").click();
  await expect(page.getByRole("table", { name: "ASIL 分解" })).toContainText("DEC-1");
  await page.getByRole("button", { name: "＋ ASIL 分解" }).click();
  await expect(page.getByLabel("分解する安全要求")).toContainText("(ASIL");
  await page.getByLabel("分解先 2 の構造要素").selectOption({ index: 0 });
  await page.getByLabel("分解先 1 の構造要素").selectOption({ index: 0 });
  await expect(page.getByRole("alert").filter({ hasText: "独立性が成立しません" })).toBeVisible();
  await expect(page.getByRole("button", { name: "分解を追加" })).toBeDisabled();
});

test("FTA: 単一故障とカットセット、保存済みツリーの確率上限", async ({ page }) => {
  await open(page);
  await tab(page, "FTA").click();
  await expect(page.getByText(/頂上事象確率の上限/)).toBeVisible();
  await expect(page.getByText("単一故障 0")).toBeVisible();
  await page.getByLabel("フォールトツリーの選択").selectOption({ index: 1 });
  await expect(page.getByText(/単一故障 [1-9]/)).toBeVisible(); // 故障ネットからの導出(OR のみ)は、基本事象が単一故障になる
});

test("SCDL ビュー: 検証結果と図、SysML v2 の出力", async ({ page }) => {
  await open(page);
  await tab(page, "SCDL").click();
  await expect(page.getByText("SCDL の検証でエラー・警告はありません")).toBeVisible();
  await expect(page.getByRole("img", { name: /要求 IF-1 要求トルクの制御 ASIL B\(D\)/ })).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "SysML v2 として出力" }).click()]);
  expect(dl.suggestedFilename()).toBe("ev-powertrain-scdl.sysml");
  expect(readFileSync(await dl.path()!, "utf8")).toContain("ScdlRequirementGroup");
});

test("エクスポート: FMEA の CSV(BOM つき)", async ({ page }) => {
  await open(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "出力", exact: true }).click()]);
  expect(dl.suggestedFilename()).toBe("ev-powertrain-fmea.csv");
  expect(readFileSync(await dl.path()!, "utf8").startsWith("﻿構造要素(階層)")).toBe(true);
});

test("テキスト: Java が無い環境の案内と、編集・保存", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "テキスト" }).click();
  await expect(page.getByRole("note").filter({ hasText: "Java" })).toContainText("Java(公式実装)が使えない");
  const ta = page.getByLabel("SysML v2 のモデル(テキスト)");
  await expect(ta).toHaveValue(/package EvPowertrainDemo/);
  await ta.press("Control+End");
  await ta.type("\n// 編集\n");
  await expect(page.getByText("● 未保存の変更")).toBeVisible();
  await expect(page.getByText(/Java.*使えない|保存済みのモデル以外は解析できません/).first()).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "変更を破棄" }).click();
  await expect(ta).not.toHaveValue(/\/\/ 編集/);
});

test("履歴: 変更が記録され、元の版に戻せる", async ({ page }) => {
  await open(page);
  await page.getByLabel("過大トルクを出力する の発生度").fill("7");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存しました")).toBeVisible();
  await tab(page, "履歴").click();
  const rows = page.getByRole("table", { name: "履歴" }).getByRole("row");
  expect(await rows.count()).toBeGreaterThan(2);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "この版に戻す" }).first().click();
  await expect(page.getByText(/に戻しました/)).toBeVisible();
  await tab(page, "FMEA シート").click();
  await expect(page.getByLabel("過大トルクを出力する の発生度")).toHaveValue("3");
});

test("データ(JSON): 不正な内容は拒否され、AP 表を設定すると AP が表示される", async ({ page }) => {
  await open(page);
  await tab(page, "データ").click();
  const ta = page.getByLabel("安全分析データ(JSON)");
  await ta.fill("{ 壊れた JSON");
  await page.getByRole("button", { name: "検証して反映" }).click();
  await expect(page.getByRole("alert")).toContainText("JSON として解釈できません");
  const data = JSON.parse(JSON.stringify(SAFETY));
  data.apTable = [{ s: [1, 10], o: [1, 10], d: [1, 10], ap: "M" }];
  await ta.fill(JSON.stringify(data));
  await page.getByRole("button", { name: "検証して反映" }).click();
  await tab(page, "FMEA シート").click();
  await expect(page.getByText("AP: 設定済み")).toBeVisible();
  await expect(page.getByRole("row", { name: /過大トルクを出力する/ })).toContainText("M");
});

test("分析パネルの最大化と、テーマの切り替え", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "分析パネルを最大化" }).click();
  await expect(page.getByRole("region", { name: "ビュースペース" })).toHaveCount(0);
  await page.getByRole("button", { name: "分析パネルを元の大きさに戻す" }).click();
  await expect(page.getByRole("region", { name: "ビュースペース" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); // 既定はダーク
  await page.getByRole("button", { name: "テーマを切り替え" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light"); // 設定が保存される
});

test("キーボード: タブは矢印キーで移動できる", async ({ page }) => {
  await open(page);
  await tab(page, "FMEA シート").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "エラーネット")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(tab(page, "FMEA シート")).toHaveAttribute("aria-selected", "true");
});

test("認証が必要な場合は、ログインダイアログを表示する", async ({ page }) => {
  let authed = false;
  await page.route("**/api/**", async (route) => {
    if (!authed && !route.request().url().endsWith("/api/health")) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "認証が必要です" }) });
    return route.continue({ headers: { ...route.request().headers() } });
  });
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "認証が必要です" })).toBeVisible();
  authed = true;
  await page.getByLabel("アクセストークン").fill("dummy");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForSelector("svg[aria-label='構造図']");
});

for (const theme of ["dark", "light"] as const) {
  test(`アクセシビリティ(axe): ${theme} テーマで重大な違反がない`, async ({ page }) => {
    await open(page);
    if (theme === "light") await page.getByRole("button", { name: "テーマを切り替え" }).click();
    for (const t of ["FMEA シート", "ハザード分析", "SCDL", "安全コンセプト"]) {
      await tab(page, t).click();
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${t}: ${v.id} ${v.help} (${v.nodes.length})`)).toEqual([]);
    }
  });
}

test("レスポンシブ: 狭い画面でも横スクロールなしで全パネルが縦に並ぶ", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await open(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  for (const name of ["エクスプローラ", "ビュースペース", "分析", "AI との対話スペース", "パズルビュー"]) await expect(page.getByLabel(name, { exact: true }).first()).toBeAttached();
});
