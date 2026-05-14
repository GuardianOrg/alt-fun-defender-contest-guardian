import { test, expect } from "@playwright/test";

test.describe("Search", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for page to load
    await expect(page.locator("text=ALTFUN").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("opens search modal with Cmd+K", async ({ page }) => {
    await page.keyboard.press("Meta+k");

    // Search input should be visible
    await expect(
      page.locator('input[placeholder="Search for tokens…"]'),
    ).toBeVisible();

    // Modal should show trending section
    await expect(page.locator("text=TRENDING")).toBeVisible();
  });

  test("opens search modal with Ctrl+K", async ({ page }) => {
    await page.keyboard.press("Control+k");

    await expect(
      page.locator('input[placeholder="Search for tokens…"]'),
    ).toBeVisible();
  });

  test("opens search modal by clicking search trigger in header", async ({
    page,
  }) => {
    await page.locator("text=Search tokens…").click();

    await expect(
      page.locator('input[placeholder="Search for tokens…"]'),
    ).toBeVisible();
  });

  test("closes search modal with Escape key", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await expect(
      page.locator('input[placeholder="Search for tokens…"]'),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(
      page.locator('input[placeholder="Search for tokens…"]'),
    ).not.toBeVisible();
  });

  test("closes search modal by clicking esc badge", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await expect(
      page.locator('input[placeholder="Search for tokens…"]'),
    ).toBeVisible();

    await page.locator("text=esc").click();
    await expect(
      page.locator('input[placeholder="Search for tokens…"]'),
    ).not.toBeVisible();
  });

  test("can type a search query", async ({ page }) => {
    await page.keyboard.press("Meta+k");

    const searchInput = page.locator('input[placeholder="Search for tokens…"]');
    await searchInput.fill("HYPE");

    await expect(searchInput).toHaveValue("HYPE");

    // Wait for search results or no results message
    const results = page.locator("text=No tokens found");
    const resultRows = page.locator('[class*="resultRow"]');
    await expect(results.or(resultRows.first())).toBeVisible({
      timeout: 5_000,
    });
  });

  // Regression test for #522 — typing character-by-character used to bounce
  // focus off the input because Modal's mount effect re-ran on every parent
  // re-render and pulled focus back to the panel. `fill()` doesn't catch
  // this because it sets the value in one shot; `pressSequentially` does.
  test("retains input focus while typing character-by-character (#522)", async ({
    page,
  }) => {
    await page.keyboard.press("Meta+k");

    const searchInput = page.locator('input[placeholder="Search for tokens…"]');
    await expect(searchInput).toBeFocused();

    await searchInput.pressSequentially("HYPE", { delay: 60 });

    await expect(searchInput).toHaveValue("HYPE");
    await expect(searchInput).toBeFocused();
  });

  test("shows keyboard shortcuts in default view", async ({ page }) => {
    await page.keyboard.press("Meta+k");

    // Keyboard hints should be visible
    await expect(page.locator("text=select")).toBeVisible();
    await expect(page.locator("text=close")).toBeVisible();
  });

  test("shows recently viewed section in default view", async ({ page }) => {
    await page.keyboard.press("Meta+k");

    await expect(page.locator("text=RECENTLY VIEWED")).toBeVisible();
    await expect(page.locator("text=No recently viewed tokens")).toBeVisible();
  });

  test("clicking a search result navigates to token page", async ({ page }) => {
    await page.keyboard.press("Meta+k");

    // If trending tokens are visible, click one
    const trendingCard = page.locator('[class*="trendingCard"]').first();
    const cardVisible = await trendingCard.isVisible().catch(() => false);

    if (cardVisible) {
      await trendingCard.click();
      // Should navigate to a token page
      await page.waitForURL(/\/token\/0x/, { timeout: 5_000 });
    }
  });
});
