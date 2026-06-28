import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/admin-auth";
import { t } from "../helpers/i18n";

function getOpenAiEndpointButton(page: Page) {
  return page.getByRole("button", {
    name: t("supplier-connections.card.open-endpoint", { name: "OpenAI" }),
  });
}

test.describe("Supplier Connections page — Credential Pools", () => {
  test.beforeEach(async ({ adminPage: { page, mockApi } }) => {
    await mockApi.mockAiEndpoints();
    await mockApi.mockAiUpstreams();
    await mockApi.mockAiEndpointCredentials();
    await mockApi.mockKeyProviders();
    await page.goto("/en/admin/supplier-connections");
  });

  test("renders endpoint grid", async ({ adminPage: { page } }) => {
    await expect(
      page.getByRole("heading", { name: t("supplier-connections.title") }),
    ).toBeVisible();
    await expect(getOpenAiEndpointButton(page)).toBeVisible();
  });

  test("clicking an endpoint shows detail with credential pools section", async ({
    adminPage: { page },
  }) => {
    await getOpenAiEndpointButton(page).click();
    await expect(page.getByText(t("supplier-connections.credentials.section-title"))).toBeVisible();
  });

  test("shows official upstream route", async ({ adminPage: { page } }) => {
    await getOpenAiEndpointButton(page).click();
    await expect(page.getByText(t("supplier-connections.upstreams.official-title"))).toBeVisible();
    await expect(page.getByText("P1000 W1")).toBeVisible();
    await expect(page.getByText(t("supplier-connections.upstreams.fallback"))).toBeVisible();
  });

  test("shows official bucket with credentials", async ({ adminPage: { page } }) => {
    await getOpenAiEndpointButton(page).click();
    await expect(page.getByText("Official Credential")).toBeVisible();
    await expect(
      page.getByText(t("supplier-connections.credentials.count", { enabled: 1, total: 1 })).first(),
    ).toBeVisible();
  });

  test("shows upstream bucket with credentials", async ({ adminPage: { page } }) => {
    await getOpenAiEndpointButton(page).click();
    await expect(page.getByText("OpenRouter Credential")).toBeVisible();
  });

  test("shows credential prefix in bucket", async ({ adminPage: { page } }) => {
    await getOpenAiEndpointButton(page).click();
    await expect(page.getByText("sk-offi****")).toBeVisible();
    await expect(page.getByText("sk-open****")).toBeVisible();
  });

  test("shows add credential button per bucket", async ({ adminPage: { page } }) => {
    await getOpenAiEndpointButton(page).click();
    const addButtons = page.getByRole("button", {
      name: t("supplier-connections.credentials.add"),
    });
    await expect(addButtons.first()).toBeVisible();
    // Should have at least 2 add buttons (official + openrouter)
    expect(await addButtons.count()).toBeGreaterThanOrEqual(2);
  });

  test("shows credential count badge", async ({ adminPage: { page } }) => {
    await getOpenAiEndpointButton(page).click();
    // Official bucket: 1/1 active
    await expect(
      page.getByText(t("supplier-connections.credentials.count", { enabled: 1, total: 1 })).first(),
    ).toBeVisible();
  });
});
