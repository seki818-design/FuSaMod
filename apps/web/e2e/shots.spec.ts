import { test } from "@playwright/test";

const OUT = "../../docs/quality/evidence/screenshots";

test("スクリーンショット(主要な画面)", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("svg[aria-label='構造図']");
  await page.screenshot({ path: `${OUT}/01-main.png` });
  for (const [tab, file] of [["エラーネット", "02-net"], ["FTA", "03-fta"], ["ハザード分析", "04-hara"], ["安全コンセプト", "05-concept"], ["SCDL", "06-scdl"], ["要件トレース", "07-trace"], ["問題", "08-issues"]] as const) {
    await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${file}.png` });
  }
  await page.getByRole("tab", { name: "テキスト" }).click();
  await page.screenshot({ path: `${OUT}/09-text.png` });
});
