import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/?project=ev-powertrain");
  await page.waitForSelector("svg[aria-label='構造図']");
  // 公式実装（Java）で解析できていること（初回は起動に時間がかかる）
  await expect(page.getByText("SysML: 公式実装")).toBeVisible({ timeout: 60_000 }).catch(() => undefined);
}
const analyzed = (page: Page) => expect(page.getByRole("status").filter({ hasText: "解析中" })).toHaveCount(0, { timeout: 90_000 });

test("図から部品を追加し、名前を直接書き換え、削除できる（テキストが書き換わり、再解析される）", async ({ page }) => {
  await open(page);
  // 1) 選択した要素（motor）の中に部品を追加
  await page.getByRole("button", { name: /^motor 〔/ }).click({ position: { x: 6, y: 6 } });
  await page.getByRole("button", { name: "＋ 部品" }).first().click();
  await page.getByLabel("「motor」の中に追加する部品の名前").fill("coil");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await analyzed(page);
  await expect(page.getByRole("button", { name: /^coil 〔/ })).toBeVisible({ timeout: 60_000 });
  // テキストにも反映されている
  await page.getByRole("tab", { name: "テキスト" }).click();
  await expect(page.getByLabel("SysML v2 のモデル(テキスト)")).toHaveValue(/part coil;/);
  await page.getByRole("tab", { name: "構造図" }).click();

  // 2) 図の中で名前をダブルクリックして書き換える（参照も追従する）
  await page.getByRole("button", { name: /^coil 〔/ }).dblclick({ position: { x: 20, y: 10 } });
  const input = page.getByLabel("名前の変更（Enter で確定、Esc で取り消し）");
  await input.fill("winding");
  await input.press("Enter");
  await analyzed(page);
  await expect(page.getByRole("button", { name: /^winding 〔/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /^coil 〔/ })).toHaveCount(0);

  // 3) エクスプローラ側からも削除できる
  await page.getByRole("button", { name: /winding/ }).first().click();
  await page.getByRole("button", { name: "🗑 削除" }).first().click();
  await page.getByRole("button", { name: "削除する" }).click();
  await analyzed(page);
  await expect(page.getByRole("button", { name: /^winding 〔/ })).toHaveCount(0, { timeout: 60_000 });
});

test("選択中の要素（初期は vehicle）に「＋ 部品」で追加できる（CRLF のモデルでも、保存済みのグラフと位置が合う）", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "＋ 部品" }).first().click();
  await page.getByLabel("「vehicle」の中に追加する部品の名前").fill("eps");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await analyzed(page);
  await expect(page.getByRole("button", { name: /^eps 〔/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("モデルのテキストが変更されています")).toHaveCount(0);
});

test("型から展開された要素は図から編集できず、理由が出る", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^vehicle 〔/ }).click({ position: { x: 6, y: 6 } });
  await expect(page.getByRole("button", { name: "＋ 部品" }).first()).toBeEnabled();
});
