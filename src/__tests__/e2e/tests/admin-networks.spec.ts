import { expect, test } from "../fixtures/admin-auth";
import { t } from "../helpers/i18n";

test.describe("Admin Networks page", () => {
  test.beforeEach(async ({ adminPage: { page, mockApi } }) => {
    await mockApi.mockAdminNetworks();
    // Circle networks endpoint (used by add dialog)
    await page.route(
      (url) => url.pathname.includes("/api/admin/circle-networks"),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [] }),
        }),
    );
    // Tokens endpoint (used for token badges on cards)
    await page.route(
      (url) => url.pathname.includes("/api/admin/allowed-tokens"),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [] }),
        }),
    );
    await page.goto("/admin/networks");
  });

  test("renders page heading", async ({ adminPage: { page } }) => {
    await expect(page.getByRole("heading", { name: t("admin.networks.title") })).toBeVisible();
  });

  test("shows network card with name and chain ID", async ({ adminPage: { page } }) => {
    // Mock network is a testnet — click testnet tab first
    await page.getByRole("tab", { name: /testnet/i }).click();
    await expect(page.getByRole("heading", { name: "Base Sepolia" })).toBeVisible();
    await expect(page.getByText("Chain 84532")).toBeVisible();
  });

  test("shows RPC URL on network card", async ({ adminPage: { page } }) => {
    await page.getByRole("tab", { name: /testnet/i }).click();
    await expect(page.getByText("sepolia.base.org")).toBeVisible();
  });

  test("shows RPC URL label", async ({ adminPage: { page } }) => {
    await page.getByRole("tab", { name: /testnet/i }).click();
    await expect(page.getByText("RPC URL")).toBeVisible();
  });

  test("shows add network button", async ({ adminPage: { page } }) => {
    await expect(page.getByRole("button", { name: t("admin.networks.btn.add") })).toBeVisible();
  });

  test("shows enable/disable switch", async ({ adminPage: { page } }) => {
    await page.getByRole("tab", { name: /testnet/i }).click();
    await expect(page.getByRole("switch")).toBeVisible();
  });

  test("clicking RPC URL enters edit mode", async ({ adminPage: { page } }) => {
    await page.getByRole("tab", { name: /testnet/i }).click();
    // Click the RPC URL text to enter edit mode
    await page.getByText("sepolia.base.org").click();
    // Input should appear with current value
    const input = page.locator("input[placeholder]").last();
    await expect(input).toBeVisible();
  });

  test("sends PUT with rpcUrl when saving RPC edit", async ({ adminPage: { page } }) => {
    const putRequests: { body: string }[] = [];
    await page.route(
      (url) => url.pathname.includes("/api/admin/networks"),
      (route) => {
        if (route.request().method() === "PUT") {
          putRequests.push({ body: route.request().postData() || "" });
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                id: 1,
                chainId: 84532,
                networkId: "eip155:84532",
                name: "Base Sepolia",
                shortName: "basesep",
                explorerUrl: "https://sepolia.basescan.org",
                testnet: true,
                iconUrl: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
                enabled: true,
                rpcUrl: "https://new-rpc.example.com",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: 1,
                chainId: 84532,
                networkId: "eip155:84532",
                name: "Base Sepolia",
                shortName: "basesep",
                explorerUrl: "https://sepolia.basescan.org",
                testnet: true,
                iconUrl: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
                enabled: true,
                rpcUrl: "https://sepolia.base.org",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        });
      },
    );

    await page.goto("/admin/networks");
    await page.getByRole("tab", { name: /testnet/i }).click();

    // Click the RPC URL to enter edit mode
    await page.getByText("sepolia.base.org").click();

    // Clear and type new URL
    const input = page.locator("input[placeholder]").last();
    await input.clear();
    await input.fill("https://new-rpc.example.com");
    await input.press("Enter");

    // Verify PUT was sent with rpcUrl
    expect(putRequests.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(putRequests[0].body);
    expect(body.rpcUrl).toBe("https://new-rpc.example.com");
  });
});
