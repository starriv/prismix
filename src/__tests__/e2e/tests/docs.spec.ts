import { expect, test } from "@playwright/test";

import { blockExternalRequests } from "../helpers/global-setup";
import { t } from "../helpers/i18n";

test.describe("Docs pages", () => {
  test("docs index loads with hub title", async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto("/docs");
    await expect(page.getByText(t("docs.hub.title"))).toBeVisible();
  });

  test("docs sidebar shows navigation items", async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto("/docs");
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText(t("docs.nav.subtitle"))).toBeVisible();
  });

  test("navigates to security page", async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto("/docs/security");
    await expect(page.getByText(t("docs.security.title"))).toBeVisible();
  });
});
