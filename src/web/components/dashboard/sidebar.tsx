import { useTranslation } from "react-i18next";

import {
  Banknote,
  BarChart3,
  Bell,
  Bot,
  Brain,
  ChevronDown,
  CreditCard,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  Wallet,
  Webhook,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAccount, useChainId } from "wagmi";

import { LocaleLink } from "@/web/components/locale-link";
import { Button } from "@/web/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/web/components/ui/collapsible";
import { Logo } from "@/web/components/ui/logo";
import { useLocaleNavigate, useLocalePathname } from "@/web/hooks/use-locale";
import { useAdminAuthContext } from "@/web/providers/admin-auth-provider";
import { useChainRegistry } from "@/web/shared/chains";
import { cn } from "@/web/shared/utils";

// ── Nav tree types ───────────────────────────────────────────────────

interface NavLeaf {
  href: string;
  labelKey: string;
  icon: LucideIcon;
}

interface NavGroup {
  labelKey: string;
  icon: LucideIcon;
  childPaths: string[];
  children: NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry && !("href" in entry);
}

// ── Nav tree ─────────────────────────────────────────────────────────

const ACCOUNTS_CHILD_PATHS = ["/pay-agents", "/transactions", "/fiat-configs"];

const AI_CHILD_PATHS = [
  "/supplier-connections",
  "/ai-models",
  "/access-endpoints",
  "/ai-usage",
  "/ai-logs",
  "/consumer-keys",
];

const navTree: NavEntry[] = [
  { href: "/admin/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  {
    labelKey: "nav.ai-gateway",
    icon: Brain,
    childPaths: AI_CHILD_PATHS,
    children: [
      { href: "/access-endpoints", labelKey: "nav.access-endpoints", icon: Zap },
      { href: "/supplier-connections", labelKey: "nav.supplier-connections", icon: Brain },
      { href: "/ai-models", labelKey: "nav.ai-models", icon: Sparkles },
      { href: "/consumer-keys", labelKey: "nav.consumer-keys", icon: KeyRound },
      { href: "/ai-usage", labelKey: "nav.ai-usage", icon: BarChart3 },
      { href: "/ai-logs", labelKey: "nav.ai-logs", icon: FileText },
    ],
  },
  {
    labelKey: "nav.billing",
    icon: Wallet,
    childPaths: ACCOUNTS_CHILD_PATHS,
    children: [
      { href: "/pay-agents", labelKey: "nav.pay-agents", icon: Bot },
      { href: "/transactions", labelKey: "nav.ledger", icon: Banknote },
      { href: "/fiat-configs", labelKey: "nav.fiat-configs", icon: CreditCard },
    ],
  },
  { href: "/notifications", labelKey: "nav.notifications", icon: Bell },
  { href: "/webhooks", labelKey: "nav.webhooks", icon: Webhook },
  { href: "/settings", labelKey: "nav.settings", icon: Settings },
];

// ── Sidebar content (shared between desktop aside and mobile sheet) ──

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useLocalePathname();
  const navigate = useLocaleNavigate();
  const { t } = useTranslation();
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { logout } = useAdminAuthContext();
  const { getChainDisplay } = useChainRegistry();

  async function handleLogout() {
    await logout();
    navigate("/admin/login", { replace: true });
  }

  const chainDisplay = getChainDisplay(chainId);
  const chainName = chainDisplay?.name ?? `Chain ${chainId}`;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-7">
        <Logo className="h-8 w-8" subtitle={t("nav.subtitle")} />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navTree.map((entry, i) =>
          isGroup(entry) ? (
            <NavGroupItem key={i} group={entry} pathname={pathname} t={t} onNavigate={onNavigate} />
          ) : (
            <LocaleLink
              key={entry.href}
              to={entry.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname === entry.href || pathname.startsWith(entry.href + "/")
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <entry.icon className="h-4 w-4" />
              {t(entry.labelKey)}
            </LocaleLink>
          ),
        )}
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
          {t("auth.logout")}
        </Button>
      </div>
    </div>
  );
}

// ── Desktop sidebar wrapper ──────────────────────────────────────────

export function Sidebar() {
  return (
    <aside className="hidden md:flex h-screen w-64 flex-col border-r bg-card">
      <SidebarContent />
    </aside>
  );
}

// ── Collapsible nav group ────────────────────────────────────────────

function NavGroupItem({
  group,
  pathname,
  t,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  t: (k: string) => string;
  onNavigate?: () => void;
}) {
  const hasActiveChild = group.childPaths.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  return (
    <Collapsible defaultOpen={hasActiveChild}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            hasActiveChild
              ? "text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <group.icon className="h-4 w-4" />
          <span className="flex-1 text-left">{t(group.labelKey)}</span>
          <ChevronDown className="h-3.5 w-3.5 transition-transform [[data-state=open]>&]:rotate-180" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 mt-1 space-y-0.5 border-l pl-3">
          {group.children.map((child) => {
            const isActive = pathname === child.href || pathname.startsWith(child.href + "/");
            return (
              <LocaleLink
                key={child.href}
                to={child.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <child.icon className="h-3.5 w-3.5" />
                {t(child.labelKey)}
              </LocaleLink>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
