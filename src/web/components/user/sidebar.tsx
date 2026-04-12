import { useTranslation } from "react-i18next";

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Brain,
  FileText,
  Key,
  LayoutDashboard,
  LogOut,
  Settings,
  Wallet,
  Zap,
} from "lucide-react";
import { useAccount, useChainId } from "wagmi";

import { LocaleLink } from "@/web/components/locale-link";
import { Button } from "@/web/components/ui/button";
import { Logo } from "@/web/components/ui/logo";
import { useLocaleNavigate, useLocalePathname } from "@/web/hooks/use-locale";
import { useUserAuthContext } from "@/web/providers/user-auth-provider";
import { useChainRegistry } from "@/web/shared/chains";
import { cn } from "@/web/shared/utils";

// ── Nav items ───────────────────────────────────────────────────

interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { href: "/user/dashboard", labelKey: "user.nav.overview", icon: LayoutDashboard },
  { href: "/user/endpoint", labelKey: "user.nav.endpoint", icon: Zap },
  { href: "/user/models", labelKey: "user.nav.models", icon: Brain },
  { href: "/user/wallet", labelKey: "user.nav.wallet", icon: Wallet },
  { href: "/user/keys", labelKey: "user.nav.keys", icon: Key },
  { href: "/user/usage", labelKey: "user.nav.usage", icon: BarChart3 },
  { href: "/user/logs", labelKey: "user.nav.logs", icon: FileText },
  { href: "/user/settings", labelKey: "user.nav.settings", icon: Settings },
];

// ── Sidebar content (shared between desktop aside and mobile sheet) ──

export function UserSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useLocalePathname();
  const navigate = useLocaleNavigate();
  const { t } = useTranslation();
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { logout } = useUserAuthContext();
  const { getChainDisplay } = useChainRegistry();

  async function handleLogout() {
    await logout();
    navigate("/user/login", { replace: true });
  }

  const chainDisplay = getChainDisplay(chainId);
  const chainName = chainDisplay?.name ?? `Chain ${chainId}`;

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-7">
        <Logo className="h-8 w-8" subtitle={t("user.nav.subtitle")} />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => (
          <LocaleLink
            key={item.href}
            to={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive(item.href)
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4" />
            {t(item.labelKey)}
          </LocaleLink>
        ))}
      </nav>

      <div className="border-t px-4 py-4 space-y-2">
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              isConnected ? "bg-green-500 animate-pulse" : "bg-zinc-400",
            )}
          />
          <span className="text-xs text-muted-foreground">
            {isConnected ? chainName : t("common.not-connected")}
          </span>
        </div>
        <Button
          variant="ghost"
          onClick={handleLogout}
          className="flex w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          {t("user.nav.logout")}
        </Button>
      </div>
    </div>
  );
}

// ── Desktop sidebar wrapper ──────────────────────────────────────────

export function UserSidebar() {
  return (
    <aside className="hidden md:flex h-screen w-64 flex-col border-r bg-card">
      <UserSidebarContent />
    </aside>
  );
}
