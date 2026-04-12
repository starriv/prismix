/**
 * Playwright test fixture for authenticated admin pages.
 *
 * - Injects admin auth tokens into localStorage before page load
 * - Sets __E2E_SKIP_DISCONNECT__ to bypass wagmi auto-logout
 * - Sets up MockApi with admin-specific API responses
 */
import { test as base, type Page } from "@playwright/test";

import { blockExternalRequests } from "../helpers/global-setup";
import { MockApi } from "../helpers/mock-api";

interface AdminFixtures {
  adminPage: { page: Page; mockApi: MockApi };
}

export const test = base.extend<AdminFixtures>({
  adminPage: async ({ page }, use) => {
    await page.addInitScript(() => {
      localStorage.setItem("prismix_admin_token", "e2e-test-admin-jwt-token");
      localStorage.setItem("prismix_admin_refresh_token", "e2e-test-admin-refresh-token");
      (window as unknown as Record<string, unknown>).__E2E_SKIP_DISCONNECT__ = true;
    });

    await blockExternalRequests(page);
    const mockApi = new MockApi(page);

    // Admin auth mock
    await page.route(
      (url) => url.pathname.startsWith("/api/admin-auth/me"),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: { admin: { id: 1, address: "0xadmin", name: "Test Admin", email: null } },
          }),
        }),
    );
    await page.route(
      (url) => url.pathname.startsWith("/api/admin-auth/refresh"),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { token: "e2e-refreshed-admin-token" } }),
        }),
    );
    await page.route(
      (url) => url.pathname.startsWith("/api/admin-auth/logout"),
      (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );

    await use({ page, mockApi });
  },
});

export { expect } from "@playwright/test";
