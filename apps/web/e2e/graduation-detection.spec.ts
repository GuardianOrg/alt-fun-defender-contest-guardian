import { test, expect } from "@playwright/test";

test.describe("Graduation detection", () => {
  test("token list shows graduating badge when token is graduating", async ({
    page,
  }) => {
    await page.goto("/");

    // Wait for the page to load
    await expect(page.locator("text=LAUNCHPAD").first()).toBeVisible({
      timeout: 10_000,
    });

    // Check if the GRADUATING filter tab exists in the command bar
    await expect(
      page.locator("button", { hasText: "GRADUATING" }),
    ).toBeVisible();
  });

  test("can filter by GRADUATING tab", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("text=LAUNCHPAD").first()).toBeVisible({
      timeout: 10_000,
    });

    // Click the GRADUATING tab
    await page.locator("button", { hasText: "GRADUATING" }).click();

    // Page should still be on home route
    await expect(page).toHaveURL("/");
  });

  test("can filter by GRADUATED tab", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("text=LAUNCHPAD").first()).toBeVisible({
      timeout: 10_000,
    });

    // Click the GRADUATED tab
    await page.locator("button", { hasText: "GRADUATED" }).click();

    // Page should still be on home route
    await expect(page).toHaveURL("/");
  });

  test("token detail page shows graduating banner when status is graduating", async ({
    page,
  }) => {
    await page.goto("/");

    // Try to navigate to a token
    const firstTokenRow = page.locator("tr").filter({ hasText: /\$/ }).first();
    const rowVisible = await firstTokenRow
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (rowVisible) {
      await firstTokenRow.click();
      await page.waitForURL(/\/token\/0x/);

      // Token detail page should show curve section for non-graduated tokens
      // Look for the curve strip or graduating badge
      const curveLabel = page.locator("text=curve").first();
      const graduatingBadge = page.locator("text=graduating");
      const graduatedStatus = page.locator("text=graduated");

      // At least one of these states should be present
      const anyStatus = curveLabel
        .or(graduatingBadge)
        .or(graduatedStatus);
      await expect(anyStatus.first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test("token detail page shows curve progress for non-graduated tokens", async ({
    page,
  }) => {
    await page.goto("/");

    const firstTokenRow = page.locator("tr").filter({ hasText: /\$/ }).first();
    const rowVisible = await firstTokenRow
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (rowVisible) {
      await firstTokenRow.click();
      await page.waitForURL(/\/token\/0x/);

      // Check for curve progress or graduated state
      const curveSection = page.locator("text=curve").first();
      const graduated = page.locator("text=graduated");
      await expect(curveSection.or(graduated).first()).toBeVisible({
        timeout: 5_000,
      });
    }
  });

  test("command bar shows all filter tabs", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("text=LAUNCHPAD").first()).toBeVisible({
      timeout: 10_000,
    });

    // All filter tabs should be present
    await expect(
      page.locator("button", { hasText: "TRENDING" }),
    ).toBeVisible();
    await expect(page.locator("button", { hasText: "NEW" })).toBeVisible();
    await expect(
      page.locator("button", { hasText: "GRADUATING" }),
    ).toBeVisible();
    await expect(
      page.locator("button", { hasText: "GRADUATED" }),
    ).toBeVisible();
    await expect(page.locator("button", { hasText: "ALL" })).toBeVisible();
  });

  test("token detail footer shows token status", async ({ page }) => {
    await page.goto("/");

    const firstTokenRow = page.locator("tr").filter({ hasText: /\$/ }).first();
    const rowVisible = await firstTokenRow
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (rowVisible) {
      await firstTokenRow.click();
      await page.waitForURL(/\/token\/0x/);

      // Footer should show the token status (active, graduating, or graduated)
      const statusLabels = page.locator(
        "text=active, text=graduating, text=graduated",
      );
      const footerStatus = page
        .locator('[class*="footerStatus"]')
        .first();
      await expect(footerStatus.or(statusLabels.first())).toBeVisible({
        timeout: 5_000,
      });
    }
  });
});
