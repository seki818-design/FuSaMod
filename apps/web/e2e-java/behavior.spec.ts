import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const MODEL = readFileSync(new URL("../../../examples/sysml/behavior-diagrams.sysml", import.meta.url), "utf8");
const analyzed = (page: Page) => expect(page.getByRole("status").filter({ hasText: "解析中" })).toHaveCount(0, { timeout: 90_000 });

async function openProject(page: Page, request: import("@playwright/test").APIRequestContext, id: string) {
  await request.post("/api/projects", { data: { id, model: MODEL } });
  await page.goto(`/?project=${id}`);
  await page.waitForSelector("svg[aria-label='構造図']", { timeout: 90_000 });
}

test("アクティビティ図: アクションの追加・矢印のつなぎ直し・名前の変更・削除ができ、テキストに反映される", async ({ page, request }) => {
  await openProject(page, request, "beh-act");
  await page.getByRole("tab", { name: "アクティビティ図" }).click();
  await page.getByLabel("アクティビティ図の対象").selectOption({ label: "Accelerate（action def）" });
  await expect(page.locator("g[data-act]")).toHaveCount(5); // 開始 + 3 アクション + 終了
  await expect(page.getByRole("button", { name: "アクション readPedal" })).toBeVisible();

  await page.getByLabel("追加するアクションの名前").fill("limitTorque");
  await page.getByRole("button", { name: "＋ アクション" }).click();
  await analyzed(page);
  await expect(page.getByRole("button", { name: "アクション limitTorque" })).toBeVisible({ timeout: 60_000 });

  await page.getByLabel("矢印の元").selectOption({ label: "computeTorque" });
  await page.getByLabel("矢印の先").selectOption({ label: "limitTorque" });
  await page.getByRole("button", { name: "つなぐ" }).click();
  await analyzed(page);
  await expect(page.getByRole("button", { name: "矢印 computeTorque から limitTorque" })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "アクション limitTorque" }).dblclick();
  const input = page.getByLabel("名前の変更（Enter で確定、Esc で取り消し）");
  await input.fill("clampTorque");
  await input.press("Enter");
  await analyzed(page);
  await expect(page.getByRole("button", { name: "アクション clampTorque" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "矢印 computeTorque から clampTorque" })).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "アクション clampTorque" }).click();
  await page.getByRole("button", { name: "アクションを削除" }).click();
  await analyzed(page);
  await expect(page.getByRole("button", { name: "アクション clampTorque" })).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("tab", { name: "テキスト" }).click();
  const text = await page.getByLabel("SysML v2 のモデル(テキスト)").inputValue();
  expect(text).not.toContain("clampTorque");
  expect(text).toContain("first readPedal then computeTorque;");
});

test("シーケンス図: ライフラインとメッセージを追加し、順序の入れ替え・名前の変更・削除ができる", async ({ page, request }) => {
  await openProject(page, request, "beh-seq");
  await page.getByRole("tab", { name: "シーケンス図" }).click();
  await page.getByLabel("シーケンス図の対象").selectOption({ label: "system" });
  await expect(page.locator("g[data-life]")).toHaveCount(3);
  await expect(page.locator("g[data-msg]")).toHaveCount(3);

  await page.getByLabel("メッセージの名前").fill("reset");
  await page.getByLabel("送り手").selectOption({ label: "vcu" });
  await page.getByLabel("受け手").selectOption({ label: "driver" });
  await page.getByRole("button", { name: "＋ メッセージ" }).click();
  await analyzed(page);
  await expect(page.locator("g[data-msg]")).toHaveCount(4, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "メッセージ 4: reset" })).toBeVisible();

  await page.getByRole("button", { name: "メッセージ 4: reset" }).click();
  await page.getByRole("button", { name: "選択中のメッセージを前へ" }).click();
  await analyzed(page);
  await expect(page.getByRole("button", { name: "メッセージ 3: reset" })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "メッセージ 3: reset" }).dblclick();
  const input = page.getByLabel("名前の変更（Enter で確定、Esc で取り消し）");
  await input.fill("restart");
  await input.press("Enter");
  await analyzed(page);
  await expect(page.getByRole("button", { name: "メッセージ 3: restart" })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "メッセージ 3: restart" }).click();
  await page.getByRole("button", { name: "メッセージを削除" }).click();
  await analyzed(page);
  await expect(page.locator("g[data-msg]")).toHaveCount(3, { timeout: 60_000 });
});
