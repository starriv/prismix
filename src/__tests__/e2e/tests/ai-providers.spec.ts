import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/admin-auth";
import { t } from "../helpers/i18n";

function getOpenAiProviderButton(page: Page) {
  return page.getByRole("button", {
    name: t("ai-providers.card.open-provider", { name: "OpenAI" }),
  });
}

test.describe("AI Providers page — Key Pools", () => {
  test.beforeEach(async ({ adminPage: { page, mockApi } }) => {
    await mockApi.mockAiProviders();
    await mockApi.mockAiUpstreams();
    await mockApi.mockAiKeys();
    await mockApi.mockKeyProviders();
    await page.goto("/en/admin/ai-providers");
  });

  test("renders provider grid", async ({ adminPage: { page } }) => {
    await expect(page.getByRole("heading", { name: t("ai-providers.title") })).toBeVisible();
    await expect(getOpenAiProviderButton(page)).toBeVisible();
  });

  test("clicking a provider shows detail with key pools section", async ({
    adminPage: { page },
  }) => {
    await getOpenAiProviderButton(page).click();
    await expect(page.getByText(t("ai-providers.keys.section-title"))).toBeVisible();
  });

  test("shows official upstream route", async ({ adminPage: { page } }) => {
    await getOpenAiProviderButton(page).click();
    await expect(page.getByText(t("ai-providers.upstreams.official-title"))).toBeVisible();
    await expect(page.getByText("P1000 W1")).toBeVisible();
    await expect(page.getByText(t("ai-providers.upstreams.fallback"))).toBeVisible();
  });

  test("shows official bucket with keys", async ({ adminPage: { page } }) => {
    await getOpenAiProviderButton(page).click();
    await expect(page.getByText("Official Key")).toBeVisible();
    await expect(
      page.getByText(t("ai-providers.keys.count", { enabled: 1, total: 1 })).first(),
    ).toBeVisible();
  });

  test("shows upstream bucket with keys", async ({ adminPage: { page } }) => {
    await getOpenAiProviderButton(page).click();
    await expect(page.getByText("OpenRouter Key")).toBeVisible();
  });

  test("shows key prefix in bucket", async ({ adminPage: { page } }) => {
    await getOpenAiProviderButton(page).click();
    await expect(page.getByText("sk-offi****")).toBeVisible();
    await expect(page.getByText("sk-open****")).toBeVisible();
  });

  test("shows add key button per bucket", async ({ adminPage: { page } }) => {
    await getOpenAiProviderButton(page).click();
    const addButtons = page.getByRole("button", { name: t("ai-providers.keys.add") });
    await expect(addButtons.first()).toBeVisible();
    // Should have at least 2 add buttons (official + openrouter)
    expect(await addButtons.count()).toBeGreaterThanOrEqual(2);
  });

  test("shows key count badge", async ({ adminPage: { page } }) => {
    await getOpenAiProviderButton(page).click();
    // Official bucket: 1/1 active
    await expect(
      page.getByText(t("ai-providers.keys.count", { enabled: 1, total: 1 })).first(),
    ).toBeVisible();
  });
});
