import { expect, test } from "../fixtures/admin-auth";
import { t } from "../helpers/i18n";

test.describe("Admin Announcements page", () => {
  test.beforeEach(async ({ adminPage: { page, mockApi } }) => {
    await mockApi.mockAdminAnnouncements();
    await page.goto("/admin/announcements");
  });

  test("renders page heading", async ({ adminPage: { page } }) => {
    await expect(page.getByRole("heading", { name: t("admin.announce.title") })).toBeVisible();
  });

  test("shows announcements in table", async ({ adminPage: { page } }) => {
    await expect(page.getByText("Scheduled Maintenance")).toBeVisible();
    await expect(page.getByText("New Feature: Webhook Notifications")).toBeVisible();
  });

  test("shows correct status badges", async ({ adminPage: { page } }) => {
    await expect(page.getByText(t("admin.announce.status.sent"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("admin.announce.status.draft"), { exact: true })).toBeVisible();
  });

  test("shows compose button", async ({ adminPage: { page } }) => {
    await expect(page.getByRole("button", { name: t("admin.announce.btn.compose") })).toBeVisible();
  });

  test("opens compose dialog on button click", async ({ adminPage: { page } }) => {
    await page.getByRole("button", { name: t("admin.announce.btn.compose") }).click();
    await expect(
      page.getByRole("heading", { name: t("admin.announce.compose-title") }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(t("admin.announce.form.title-ph"))).toBeVisible();
    await expect(page.getByPlaceholder(t("admin.announce.form.body-ph"))).toBeVisible();
  });

  test("draft row has more action buttons than sent row", async ({ adminPage: { page } }) => {
    // Draft row gets edit + send + delete (3 buttons), sent row only gets delete (1 button)
    const rows = page.locator("tbody tr");
    // Sent row (first) should have 1 action button (delete only)
    const sentActions = rows.nth(0).locator("td:last-child button");
    await expect(sentActions).toHaveCount(1);
    // Draft row (second) should have 3 action buttons (edit + send + delete)
    const draftActions = rows.nth(1).locator("td:last-child button");
    await expect(draftActions).toHaveCount(3);
  });

  test("shows empty state when no announcements", async ({ adminPage: { page } }) => {
    // Override with empty response
    await page.route(
      (url) => url.pathname.includes("/api/admin/announcements"),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [] }),
        }),
    );
    await page.goto("/admin/announcements");
    await expect(page.getByText(t("admin.announce.table-empty"))).toBeVisible();
  });
});

test.describe("Admin sidebar shows Announcements link", () => {
  test("sidebar contains announcements nav item", async ({ adminPage: { page, mockApi } }) => {
    await mockApi.mockAdminAnnouncements();
    await page.goto("/admin/announcements");
    const sidebar = page.locator("aside");
    await expect(sidebar.getByText(t("admin.nav.announcements"))).toBeVisible();
  });
});
