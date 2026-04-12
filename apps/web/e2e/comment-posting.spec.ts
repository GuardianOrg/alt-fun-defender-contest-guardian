import { test, expect } from "@playwright/test";

test.describe("Comment posting", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a token detail page
    await page.goto("/");
    const firstTokenRow = page.locator("tr").filter({ hasText: /\$/ }).first();
    await firstTokenRow.click({ timeout: 10_000 });
    await page.waitForURL(/\/token\/0x/);
  });

  test("displays the comments tab in bottom tabs", async ({ page }) => {
    const commentsTab = page.locator("button", { hasText: "comments" });
    await expect(commentsTab).toBeVisible();
  });

  test("can switch to the comments tab", async ({ page }) => {
    await page.locator("button", { hasText: "comments" }).click();

    // Comment input should be visible
    const commentInput = page.locator(
      'input[placeholder="connect wallet to comment"], input[placeholder="say something…"]',
    );
    await expect(commentInput).toBeVisible();
  });

  test("shows connect wallet placeholder when not connected", async ({
    page,
  }) => {
    await page.locator("button", { hasText: "comments" }).click();

    await expect(
      page.locator('input[placeholder="connect wallet to comment"]'),
    ).toBeVisible();
  });

  test("displays post button", async ({ page }) => {
    await page.locator("button", { hasText: "comments" }).click();

    const postBtn = page.locator("button", { hasText: "post" });
    await expect(postBtn).toBeVisible();
    // Post button should be disabled when input is empty
    await expect(postBtn).toBeDisabled();
  });

  test("can type in comment input", async ({ page }) => {
    await page.locator("button", { hasText: "comments" }).click();

    const commentInput = page.locator(
      'input[placeholder="connect wallet to comment"], input[placeholder="say something…"]',
    );
    await commentInput.fill("Test comment from E2E");
    await expect(commentInput).toHaveValue("Test comment from E2E");
  });

  test("shows all three tabs: trades, comments, holders", async ({ page }) => {
    await expect(
      page.locator("button", { hasText: "trades" }),
    ).toBeVisible();
    await expect(
      page.locator("button", { hasText: "comments" }),
    ).toBeVisible();
    await expect(
      page.locator("button", { hasText: "holders" }),
    ).toBeVisible();
  });

  test("trades tab is active by default", async ({ page }) => {
    // Trades table headers should be visible
    await expect(page.locator("th", { hasText: "Account" })).toBeVisible();
    await expect(page.locator("th", { hasText: "Type" })).toBeVisible();
    await expect(page.locator("th", { hasText: "USDC" })).toBeVisible();
  });

  test("can switch between tabs", async ({ page }) => {
    // Switch to comments
    await page.locator("button", { hasText: "comments" }).click();
    const commentInput = page.locator(
      'input[placeholder="connect wallet to comment"], input[placeholder="say something…"]',
    );
    await expect(commentInput).toBeVisible();

    // Switch to holders
    await page.locator("button", { hasText: "holders" }).click();
    await expect(page.locator("text=wallet").first()).toBeVisible();
    await expect(page.locator("text=% supply").first()).toBeVisible();

    // Switch back to trades
    await page.locator("button", { hasText: "trades" }).click();
    await expect(page.locator("th", { hasText: "Account" })).toBeVisible();
  });
});
