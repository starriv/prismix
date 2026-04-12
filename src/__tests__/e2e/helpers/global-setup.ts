/**
 * Global setup for all E2E tests.
 * Handles external requests from wagmi/RainbowKit that would cause timeouts.
 * Instead of aborting (which crashes providers), we fulfill with empty responses.
 */
import type { Page } from "@playwright/test";

export async function blockExternalRequests(page: Page) {
  // Fulfill external requests with empty JSON instead of aborting,
  // so wagmi/RainbowKit providers don't crash the React tree.
  await page.route(
    (url) => {
      const host = url.hostname;
      return (
        host.includes("walletconnect") ||
        host.includes("rainbowkit") ||
        host.includes("explorer-api") ||
        host.includes("web3modal") ||
        host.includes("keys.coinbase") ||
        host.includes("cloudflare-eth") ||
        host.includes("infura") ||
        host.includes("alchemy") ||
        host.includes("publicnode") ||
        host.includes("base.org") ||
        host.includes("base-sepolia")
      );
    },
    (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}
