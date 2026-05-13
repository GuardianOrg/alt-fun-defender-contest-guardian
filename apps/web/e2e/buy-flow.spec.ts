import { test, expect } from "@playwright/test";

test.describe("Buy flow", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a token detail page (uses first token from list)
    await page.goto("/");
    // Wait for token table to load and click first token
    const firstTokenRow = page.locator("tr").filter({ hasText: /\$/ }).first();
    await firstTokenRow.click({ timeout: 10_000 });
    await page.waitForURL(/\/token\/0x/);
  });

  test("displays the trade panel with BUY mode active by default", async ({
    page,
  }) => {
    // BUY mode button should be active
    const buyBtn = page.locator("button", { hasText: "BUY" }).first();
    await expect(buyBtn).toBeVisible();

    // Amount input should be visible
    const amountInput = page.locator('input[type="number"][placeholder="0.00"]');
    await expect(amountInput).toBeVisible();

    // USDC denomination label should show
    await expect(page.locator("text=USDC").first()).toBeVisible();

    // Connect wallet button should show when not connected
    await expect(
      page.locator("button", { hasText: "CONNECT WALLET" }),
    ).toBeVisible();
  });

  test("can enter buy amount and see quote estimate", async ({ page }) => {
    const amountInput = page.locator('input[type="number"][placeholder="0.00"]');
    await amountInput.fill("100");

    // Wait for quote to appear (debounced by 300ms)
    await expect(page.locator("text=You receive ≈")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("quick amount buttons set the input value", async ({ page }) => {
    const amountInput = page.locator('input[type="number"][placeholder="0.00"]');

    // Click the 100 quick amount button
    await page.locator("button", { hasText: /^100$/ }).click();
    await expect(amountInput).toHaveValue("100");

    // Click the 500 quick amount button
    await page.locator("button", { hasText: /^500$/ }).click();
    await expect(amountInput).toHaveValue("500");

    // Click the 1K quick amount button
    await page.locator("button", { hasText: "1K" }).click();
    await expect(amountInput).toHaveValue("1000");
  });

  test("reset button clears the input", async ({ page }) => {
    const amountInput = page.locator('input[type="number"][placeholder="0.00"]');
    await amountInput.fill("500");
    await expect(amountInput).toHaveValue("500");

    await page.locator("button", { hasText: "Reset" }).click();
    await expect(amountInput).toHaveValue("");
  });

  test("shows minimum trade error for amounts below minimum", async ({
    page,
  }) => {
    const amountInput = page.locator('input[type="number"][placeholder="0.00"]');
    await amountInput.fill("5");

    // Should show minimum trade error
    await expect(page.locator("text=Minimum trade")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("shows denomination as USDC in buy mode", async ({ page }) => {
    await expect(page.locator("text=Amount in USDC")).toBeVisible();
  });

  test("can open settings popup", async ({ page }) => {
    // Click gear/settings button (SVG button next to mode toggle)
    const gearBtn = page.locator("button").filter({ has: page.locator("svg circle") });
    await gearBtn.click();

    // Slippage options should appear
    await expect(page.locator("text=Slippage")).toBeVisible();
  });
});
