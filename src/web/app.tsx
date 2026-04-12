import { lazy, Suspense } from "react";
import { Outlet, Route, Routes } from "react-router-dom";

import { ErrorBoundary } from "./components/error-boundary";
import { LangRedirect } from "./components/lang-redirect";
import { LangRouter } from "./components/lang-router";
import { LocaleNavigate } from "./components/locale-link";
import { TooltipProvider } from "./components/ui/tooltip";
// ── Eager imports (critical path — always needed) ────────────────

import { WalletProvider } from "./providers/wallet-provider";

const HomePage = lazy(() => import("./pages/home"));

// Auth providers are lazy-loaded because they transitively import wagmi
const AdminAuthProvider = lazy(() =>
  import("./providers/admin-auth-provider").then((m) => ({ default: m.AdminAuthProvider })),
);
const UserAuthProvider = lazy(() =>
  import("./providers/user-auth-provider").then((m) => ({ default: m.UserAuthProvider })),
);

// ── Lazy page imports (code-split per route group) ───────────────

// Shared / public
const ForbiddenPage = lazy(() => import("./pages/403"));
const NotFoundPage = lazy(() => import("./pages/404"));

// Auth flow (user login — will be added in Phase 3)
const AuthCallbackPage = lazy(() => import("./pages/auth-callback"));

// Admin dashboard (absorbs all merchant pages)
const AdminLayout = lazy(() => import("./layouts/admin").then((m) => ({ default: m.AdminLayout })));
const RequireAdmin = lazy(() =>
  import("./components/auth/require-admin").then((m) => ({ default: m.RequireAdmin })),
);
const AdminLoginPage = lazy(() => import("./pages/admin/login"));
const AdminDashboardPage = lazy(() => import("./pages/admin/dashboard"));
const AdminMembersPage = lazy(() => import("./pages/admin/admins"));
const AdminLoginStrategiesPage = lazy(() => import("./pages/admin/login-strategies"));
const AdminTokensPage = lazy(() => import("./pages/admin/tokens"));
const AdminNetworksPage = lazy(() => import("./pages/admin/networks"));
const AdminNotificationProvidersPage = lazy(() => import("./pages/admin/notification-providers"));
const AdminAnnouncementsPage = lazy(() => import("./pages/admin/announcements"));
const AdminWithdrawOrdersPage = lazy(() => import("./pages/admin/withdraw-orders"));

// Former merchant pages — now under admin
const DashboardPage = lazy(() => import("./pages/dashboard"));
const PayAgentsPage = lazy(() => import("./pages/pay-agents"));
const TransactionLedgerPage = lazy(() => import("./pages/transactions"));
const FiatConfigsPage = lazy(() => import("./pages/fiat-configs"));
const NotificationsPage = lazy(() => import("./pages/notifications"));
const WebhooksPage = lazy(() => import("./pages/webhooks"));
const SettingsPage = lazy(() => import("./pages/settings"));
const AiKeysPage = lazy(() => import("./pages/ai-keys"));
const AiProvidersPage = lazy(() => import("./pages/ai-providers"));
const AiModelsPage = lazy(() => import("./pages/ai-models"));
const AiRelayPage = lazy(() => import("./pages/ai-endpoint"));
const AiUsagePage = lazy(() => import("./pages/ai-usage"));
const AiUsageDetailPage = lazy(() => import("./pages/ai-usage-detail"));
const AiLogsPage = lazy(() => import("./pages/ai-logs"));
const ConsumerKeysPage = lazy(() => import("./pages/consumer-keys"));
const KeyProvidersPage = lazy(() => import("./pages/admin/key-providers"));

// User portal
const UserLayout = lazy(() => import("./layouts/user").then((m) => ({ default: m.UserLayout })));
const RequireUser = lazy(() =>
  import("./components/auth/require-user").then((m) => ({ default: m.RequireUser })),
);
const UserLoginPage = lazy(() => import("./pages/user/login"));
const UserDashboardPage = lazy(() => import("./pages/user/index"));
const UserKeysPage = lazy(() => import("./pages/user/keys"));
const UserUsagePage = lazy(() => import("./pages/user/usage"));
const UserLogsPage = lazy(() => import("./pages/user/logs"));
const UserSettingsPage = lazy(() => import("./pages/user/settings"));
const UserWalletPage = lazy(() => import("./pages/user/wallet"));
const UserEndpointPage = lazy(() => import("./pages/user/endpoint"));

// Docs
const DocsLayout = lazy(() => import("./layouts/docs").then((m) => ({ default: m.DocsLayout })));
const DocsIndexPage = lazy(() => import("./pages/docs/index"));
const DeployProductionPage = lazy(() => import("./pages/docs/deploy-production"));
const DatabasePage = lazy(() => import("./pages/docs/database"));
const ArchitecturePage = lazy(() => import("./pages/docs/architecture"));
const SecurityPage = lazy(() => import("./pages/docs/security"));
const BrandGuidelinesPage = lazy(() => import("./pages/docs/brand-guidelines"));

// ── Route-level loading fallback ─────────────────────────────────

function PageSkeleton() {
  return <div className="h-screen bg-background" />;
}

// ── App ──────────────────────────────────────────────────────────

export function App() {
  return (
    <TooltipProvider>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          {/* Bare root → detect language and redirect */}
          <Route path="/" element={<LangRedirect />} />

          {/* All routes under /:lang */}
          <Route path="/:lang" element={<LangRouter />}>
            <Route index element={<HomePage />} />
            <Route path="403" element={<ForbiddenPage />} />
            <Route path="auth/callback" element={<AuthCallbackPage />} />

            {/* Docs routes — public, no auth, no wallet */}
            <Route
              path="docs"
              element={
                <ErrorBoundary>
                  <DocsLayout />
                </ErrorBoundary>
              }
            >
              <Route index element={<DocsIndexPage />} />
              <Route path="deploy-production" element={<DeployProductionPage />} />
              <Route path="database" element={<DatabasePage />} />
              <Route path="architecture" element={<ArchitecturePage />} />
              <Route path="security" element={<SecurityPage />} />
              <Route path="brand-guidelines" element={<BrandGuidelinesPage />} />
            </Route>

            {/* Admin routes — full management console */}
            <Route
              path="admin"
              element={
                <WalletProvider>
                  <AdminAuthProvider>
                    <ErrorBoundary>
                      <Outlet />
                    </ErrorBoundary>
                  </AdminAuthProvider>
                </WalletProvider>
              }
            >
              <Route path="login" element={<AdminLoginPage />} />
              <Route
                element={
                  <RequireAdmin>
                    <AdminLayout />
                  </RequireAdmin>
                }
              >
                {/* Overview */}
                <Route index element={<LocaleNavigate to="/admin/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />

                {/* Users */}
                <Route path="users" element={<AdminDashboardPage />} />

                {/* AI Gateway */}
                <Route path="ai-providers" element={<AiProvidersPage />} />
                <Route path="ai-keys" element={<AiKeysPage />} />
                <Route path="ai-models" element={<AiModelsPage />} />
                <Route path="ai-endpoint" element={<AiRelayPage />} />
                <Route path="ai-usage" element={<AiUsagePage />} />
                <Route path="ai-usage/:consumerKeyId" element={<AiUsageDetailPage />} />
                <Route path="ai-logs" element={<AiLogsPage />} />
                <Route path="consumer-keys" element={<ConsumerKeysPage />} />
                <Route path="key-providers" element={<KeyProvidersPage />} />

                {/* Pay Agents */}
                <Route path="pay-agents" element={<PayAgentsPage />} />
                <Route path="transactions" element={<TransactionLedgerPage />} />
                <Route path="withdraw-orders" element={<AdminWithdrawOrdersPage />} />
                <Route path="fiat-configs" element={<FiatConfigsPage />} />

                {/* Notifications & Webhooks */}
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="webhooks" element={<WebhooksPage />} />

                {/* System Settings */}
                <Route path="settings" element={<SettingsPage />} />
                <Route path="admins" element={<AdminMembersPage />} />
                <Route path="login-strategies" element={<AdminLoginStrategiesPage />} />
                <Route path="tokens" element={<AdminTokensPage />} />
                <Route path="networks" element={<AdminNetworksPage />} />
                <Route path="notification-providers" element={<AdminNotificationProvidersPage />} />
                <Route path="announcements" element={<AdminAnnouncementsPage />} />
              </Route>
            </Route>

            {/* User routes */}
            <Route
              path="user"
              element={
                <WalletProvider>
                  <UserAuthProvider>
                    <ErrorBoundary>
                      <Outlet />
                    </ErrorBoundary>
                  </UserAuthProvider>
                </WalletProvider>
              }
            >
              <Route path="login" element={<UserLoginPage />} />
              <Route
                element={
                  <RequireUser>
                    <UserLayout />
                  </RequireUser>
                }
              >
                <Route index element={<LocaleNavigate to="/user/dashboard" replace />} />
                <Route path="dashboard" element={<UserDashboardPage />} />
                <Route path="endpoint" element={<UserEndpointPage />} />
                <Route path="wallet" element={<UserWalletPage />} />
                <Route path="keys" element={<UserKeysPage />} />
                <Route path="usage" element={<UserUsagePage />} />
                <Route path="logs" element={<UserLogsPage />} />
                <Route path="settings" element={<UserSettingsPage />} />
              </Route>
            </Route>

            {/* Catch-all under /:lang */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>

          {/* Catch-all for bare paths without lang prefix → redirect */}
          <Route path="*" element={<LangRedirect />} />
        </Routes>
      </Suspense>
    </TooltipProvider>
  );
}
