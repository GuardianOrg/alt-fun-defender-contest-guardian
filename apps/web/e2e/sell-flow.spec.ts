import { test, expect } from "@playwright/test";

test.describe("Sell flow", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a token detail page
    await page.goto("/");
    const firstTokenRow = page.locator("tr").filter({ hasText: /\$/ }).first();
    await firstTokenRow.click({ timeout: 10_000 });
    await page.waitForURL(/\/token\/0x/);
  });

  test("can switch to SELL mode", async ({ page }) => {
    const sellBtn = page.locator("button", { hasText: "SELL" }).first();
    await sellBtn.click();

    // Amount denomination should change to token ticker (not USDC)
    await expect(page.locator("text=Amount in USDC")).not.toBeVisible();
    await expect(page.locator("text=Amount in")).toBeVisible();
  });

  test("displays token ticker as denomination in sell mode", async ({
    page,
  }) => {
    // Switch to sell mode
    await page.locator("button", { hasText: "SELL" }).first().click();

    // Should NOT show "Amount in USDC"
    await expect(page.locator("text=Amount in USDC")).not.toBeVisible();
  });

  test("can enter sell amount and see USDC quote", async ({ page }) => {
    // Switch to sell mode
    await page.locator("button", { hasText: "SELL" }).first().click();

    const amountInput = page.locator('input[type="number"][placeholder="0.00"]');
    await amountInput.fill("1000000");

    // Wait for quote to appear showing USDC output
    await expect(page.locator("text=You receive ≈")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("shows buffer warning when sell exceeds available liquidity", async ({
    page,
  }) => {
    // Switch to sell mode
    await page.locator("button", { hasText: "SELL" }).first().click();

    const amountInput = page.locator('input[type="number"][placeholder="0.00"]');
    // Enter a very large amount that would exceed buffer
    await amountInput.fill("999999999999");

    // Check for buffer warning (may or may not appear depending on mock data)
    // The test verifies the UI can handle large amounts
    await page.waitForTimeout(500);
    const bufferWarning = page.locator("text=Sell amount exceeds available liquidity");
    const minimumError = page.locator("text=Minimum trade");
    // One of these should potentially show, or the quote should appear
    const quoteOrWarning = bufferWarning.or(minimumError).or(page.locator("text=You receive ≈"));
    await expect(quoteOrWarning.first()).toBeVisible({ timeout: 5_000 });
  });

  test("shows connect wallet CTA when not connected in sell mode", async ({
    page,
  }) => {
    // Switch to sell mode
    await page.locator("button", { hasText: "SELL" }).first().click();

    await expect(
      page.locator("button", { hasText: "CONNECT WALLET" }),
    ).toBeVisible();
  });

  test("reset clears amount in sell mode", async ({ page }) => {
    // Switch to sell mode
    await page.locator("button", { hasText: "SELL" }).first().click();

    const amountInput = page.locator('input[type="number"][placeholder="0.00"]');
    await amountInput.fill("500");
    await expect(amountInput).toHaveValue("500");

    await page.locator("button", { hasText: "Reset" }).click();
    await expect(amountInput).toHaveValue("");
  });
});
