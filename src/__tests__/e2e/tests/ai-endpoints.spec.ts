import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/admin-auth";
import { t } from "../helpers/i18n";

function getOpenAiEndpointButton(page: Page) {
  return page.getByRole("button", {
    name: t("ai-endpoints.card.open-endpoint", { name: "OpenAI" }),
  });
}

test.describe("AI Endpoints page — Credential Pools", () => {
  test.beforeEach(async ({ adminPage: { page, mockApi } }) => {
    await mockApi.mockAiEndpoints();
    await mockApi.mockAiUpstreams();
    await mockApi.mockAiEndpointCredentials();
    await mockApi.mockKeyProviders();
    await page.goto("/en/admin/ai-endpoints");
  });

  test("renders endpoint grid", async ({ adminPage: { page } }) => {
    await expect(page.getByRole("heading", { name: t("ai-endpoints.title") })).toBeVisible();
    await expect(getOpenAiEndpointButton(page)).toBeVisible();
  });

  test("clicking an endpoint shows detail with credential pools section", async ({
    adminPage: { page },
  }) => {
    await getOpenAiEndpointButton(page).click();
    await expect(page.getByText(t("ai-endpoints.credentials.section-title"))).toBeVisible();
  });

  test("shows official upstream route", async ({ adminPage: { page } }) => {
    await getOpenAiEndpointButton(page).click();
    await expect(page.getByText(t("ai-endpoints.upstreams.official-title"))).toBeVisible();
    await expect(page.getByText("P1000 W1")).toBeVisible();
    await expect(page.getByText(t("ai-endpoints.upstreams.fallback"))).toBeVisible();
  });

  test("shows official bucket with credentials", async ({ adminPage: { page } }) => {
    await getOpenAiEndpointButton(page).click();
    await expect(page.getByText("Official Credential")).toBeVisible();
    await expect(
      page.getByText(t("ai-endpoints.credentials.count", { enabled: 1, total: 1 })).first(),
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
    const addButtons = page.getByRole("button", { name: t("ai-endpoints.credentials.add") });
    await expect(addButtons.first()).toBeVisible();
    // Should have at least 2 add buttons (official + openrouter)
    expect(await addButtons.count()).toBeGreaterThanOrEqual(2);
  });

  test("shows credential count badge", async ({ adminPage: { page } }) => {
    await getOpenAiEndpointButton(page).click();
    // Official bucket: 1/1 active
    await expect(
      page.getByText(t("ai-endpoints.credentials.count", { enabled: 1, total: 1 })).first(),
    ).toBeVisible();
  });
});
