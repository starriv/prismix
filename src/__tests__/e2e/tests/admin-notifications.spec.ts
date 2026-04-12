import { expect, test } from "../fixtures/admin-auth";
import { t } from "../helpers/i18n";

test.describe("Admin Notification Providers page", () => {
  test.beforeEach(async ({ adminPage: { page, mockApi } }) => {
    await mockApi.mockAdminNotificationProviders();
    await page.goto("/admin/notifications");
  });

  test("renders page heading", async ({ adminPage: { page } }) => {
    await expect(page.getByRole("heading", { name: t("admin.notif.title") })).toBeVisible();
  });

  test("shows all 4 channel cards", async ({ adminPage: { page } }) => {
    await expect(page.getByText(t("admin.notif.email-title"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("admin.notif.telegram-title"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("admin.notif.webhook-title"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("admin.notif.whatsapp-title"), { exact: true })).toBeVisible();
  });

  test("email card shows SMTP fields when enabled", async ({ adminPage: { page } }) => {
    // Mock has email.enabled = true, provider = "smtp"
    await expect(page.getByText(t("admin.notif.form.smtp-host"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("admin.notif.form.smtp-user"), { exact: true })).toBeVisible();
  });

  test("telegram card is collapsed when disabled", async ({ adminPage: { page } }) => {
    // Mock has telegram.enabled = false
    await expect(
      page.getByText(t("admin.notif.form.bot-token"), { exact: true }),
    ).not.toBeVisible();
  });

  test("webhook card shows hint text when enabled", async ({ adminPage: { page } }) => {
    // Mock has webhook.enabled = true
    await expect(page.getByText(t("admin.notif.webhook-hint"))).toBeVisible();
  });

  test("shows save button", async ({ adminPage: { page } }) => {
    await expect(page.getByRole("button", { name: t("admin.notif.save") })).toBeVisible();
  });
});

test.describe("Admin sidebar shows Notifications link", () => {
  test("sidebar contains notification nav item", async ({ adminPage: { page, mockApi } }) => {
    await mockApi.mockAdminNotificationProviders();
    await page.goto("/admin/notifications");
    const sidebar = page.locator("aside");
    await expect(sidebar.getByText(t("admin.nav.notifications"))).toBeVisible();
  });
});
