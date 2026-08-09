import { expect, test } from "@playwright/test";

test("switches to Chinese and keeps the selection after a reload", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "中文" }).click();
  await expect(page.getByRole("heading", { name: "进入之前" })).toBeVisible();
  await expect(page.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.getByRole("heading", { name: "进入之前" })).toBeVisible();
});
