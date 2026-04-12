import { test, expect } from "@playwright/test";

test.describe("Token creation flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/create");
  });

  test("displays the create page with all form sections", async ({ page }) => {
    await expect(page.locator("text=Create a levered token")).toBeVisible();

    // Pair selector: direction cards
    await expect(page.locator("button", { hasText: "LONG" })).toBeVisible();
    await expect(page.locator("button", { hasText: "SHORT" })).toBeVisible();

    // Asset buttons
    await expect(page.locator("button", { hasText: "HYPE" })).toBeVisible();
    await expect(page.locator("button", { hasText: "ETH" })).toBeVisible();
    await expect(page.locator("button", { hasText: "BTC" })).toBeVisible();
    await expect(page.locator("button", { hasText: "SOL" })).toBeVisible();

    // Leverage buttons
    await expect(page.locator("button", { hasText: "2×" })).toBeVisible();
    await expect(page.locator("button", { hasText: "3×" })).toBeVisible();
    await expect(page.locator("button", { hasText: "5×" })).toBeVisible();

    // Token form fields
    await expect(
      page.locator('input[placeholder="e.g. HYPERBULL"]'),
    ).toBeVisible();
    await expect(
      page.locator('input[placeholder="e.g. HBULL"]'),
    ).toBeVisible();
    await expect(
      page.locator('textarea[placeholder="What\'s the vibe?"]'),
    ).toBeVisible();

    // Image upload zone
    await expect(page.locator("text=Click or drag to upload")).toBeVisible();

    // Seed buy section
    await expect(
      page.locator('input[placeholder="0.00"][type="number"]'),
    ).toBeVisible();

    // Launch button (prompts wallet connect when not connected)
    await expect(
      page.locator("button", { hasText: "CONNECT WALLET TO LAUNCH" }),
    ).toBeVisible();
  });

  test("can select direction, asset, and leverage", async ({ page }) => {
    // Select SHORT direction
    await page.locator("button", { hasText: "SHORT" }).click();

    // Select ETH asset
    await page.locator("button", { hasText: "ETH" }).click();

    // Select 3x leverage
    await page.locator("button", { hasText: "3×" }).click();

    // Verify summary card updates (shows LT name)
    await expect(page.locator("text=ETH3S")).toBeVisible();
  });

  test("can fill in token name, ticker, and description", async ({ page }) => {
    const nameInput = page.locator('input[placeholder="e.g. HYPERBULL"]');
    const tickerInput = page.locator('input[placeholder="e.g. HBULL"]');
    const descriptionInput = page.locator(
      'textarea[placeholder="What\'s the vibe?"]',
    );

    await nameInput.fill("TestBull");
    await tickerInput.fill("TBULL");
    await descriptionInput.fill("A test token for E2E testing");

    await expect(nameInput).toHaveValue("TestBull");
    await expect(tickerInput).toHaveValue("TBULL");
    await expect(descriptionInput).toHaveValue(
      "A test token for E2E testing",
    );

    // Live preview should reflect the name
    await expect(page.locator("text=TestBull").first()).toBeVisible();
  });

  test("can expand and fill social links", async ({ page }) => {
    // Click social links toggle
    await page
      .locator("text=Add social links")
      .click();

    // Social link inputs should appear
    const twitterInput = page.locator('input[placeholder="@handle"]');
    const telegramInput = page.locator('input[placeholder="t.me/..."]');
    const websiteInput = page.locator('input[placeholder="https://..."]');

    await expect(twitterInput).toBeVisible();
    await expect(telegramInput).toBeVisible();
    await expect(websiteInput).toBeVisible();

    await twitterInput.fill("@testtoken");
    await telegramInput.fill("t.me/testtoken");
    await websiteInput.fill("https://testtoken.com");

    await expect(twitterInput).toHaveValue("@testtoken");
    await expect(telegramInput).toHaveValue("t.me/testtoken");
    await expect(websiteInput).toHaveValue("https://testtoken.com");
  });

  test("can set seed buy amount", async ({ page }) => {
    const seedInput = page.locator(
      'input[placeholder="0.00"][type="number"]',
    );
    await seedInput.fill("100");
    await expect(seedInput).toHaveValue("100");

    // Seed info should appear
    await expect(page.locator("text=$100.00 USDC")).toBeVisible();
  });

  test("image upload zone accepts file input", async ({ page }) => {
    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await expect(fileInput).toBeAttached();
  });

  test("launch button shows connect wallet when not connected", async ({
    page,
  }) => {
    const launchBtn = page.locator("button", {
      hasText: "CONNECT WALLET TO LAUNCH",
    });
    await expect(launchBtn).toBeVisible();
    await expect(launchBtn).toBeEnabled();
  });
});
