/**
 * Playwright test fixture for authenticated admin pages.
 *
 * - Injects auth tokens into localStorage before page load
 * - Sets __E2E_SKIP_DISCONNECT__ to bypass wagmi auto-logout
 * - Sets up MockApi with all default admin API responses
 */
import { test as base, type Page } from "@playwright/test";

import { blockExternalRequests } from "../helpers/global-setup";
import { MockApi } from "../helpers/mock-api";

interface AuthFixtures {
  authedPage: { page: Page; mockApi: MockApi };
}

export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page }, use) => {
    // Inject tokens and E2E flag before any page JS executes
    await page.addInitScript(() => {
      localStorage.setItem("prismix_admin_token", "e2e-test-jwt-token");
      localStorage.setItem("prismix_refresh_token", "e2e-test-refresh-token");
      (window as unknown as Record<string, unknown>).__E2E_SKIP_DISCONNECT__ = true;
    });

    await blockExternalRequests(page);
    const mockApi = new MockApi(page);
    await mockApi.setupDefaults();

    await use({ page, mockApi });
  },
});

export { expect } from "@playwright/test";
