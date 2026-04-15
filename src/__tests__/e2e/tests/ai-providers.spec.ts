import { expect, test } from "../fixtures/admin-auth";
import { t } from "../helpers/i18n";

test.describe("AI Providers page — Key Pools", () => {
  test.beforeEach(async ({ adminPage: { page, mockApi } }) => {
    await mockApi.mockAiProviders();
    await mockApi.mockAiUpstreams();
    await mockApi.mockAiKeys();
    await mockApi.mockKeyProviders();
    await page.goto("/admin/ai-providers");
  });

  test("renders provider grid", async ({ adminPage: { page } }) => {
    await expect(page.getByRole("heading", { name: t("ai-providers.title") })).toBeVisible();
    await expect(page.getByText("OpenAI")).toBeVisible();
  });

  test("clicking a provider shows detail with key pools section", async ({
    adminPage: { page },
  }) => {
    await page.getByText("OpenAI").click();
    await expect(page.getByText(t("ai-providers.keys.section-title"))).toBeVisible();
  });

  test("shows official bucket with keys", async ({ adminPage: { page } }) => {
    await page.getByText("OpenAI").click();
    await expect(page.getByText(t("ai-providers.keys.official-bucket"))).toBeVisible();
    await expect(page.getByText("Official Key")).toBeVisible();
  });

  test("shows upstream bucket with keys", async ({ adminPage: { page } }) => {
    await page.getByText("OpenAI").click();
    await expect(page.getByText("OpenRouter")).toBeVisible();
    await expect(page.getByText("OpenRouter Key")).toBeVisible();
  });

  test("shows key prefix in bucket", async ({ adminPage: { page } }) => {
    await page.getByText("OpenAI").click();
    await expect(page.getByText("sk-offi****")).toBeVisible();
    await expect(page.getByText("sk-open****")).toBeVisible();
  });

  test("shows add key button per bucket", async ({ adminPage: { page } }) => {
    await page.getByText("OpenAI").click();
    const addButtons = page.getByRole("button", { name: t("ai-providers.keys.add") });
    await expect(addButtons.first()).toBeVisible();
    // Should have at least 2 add buttons (official + openrouter)
    expect(await addButtons.count()).toBeGreaterThanOrEqual(2);
  });

  test("shows key count badge", async ({ adminPage: { page } }) => {
    await page.getByText("OpenAI").click();
    // Official bucket: 1/1 active
    await expect(page.getByText("1/1 active").first()).toBeVisible();
  });
});
