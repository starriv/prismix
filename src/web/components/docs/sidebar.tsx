import { useTranslation } from "react-i18next";

import {
  ArrowUpCircle,
  Blocks,
  BookOpen,
  ChevronDown,
  Database,
  Languages,
  Layers,
  Palette,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ThemeToggle } from "@/web/components/dashboard/theme-toggle";
import { LocaleLink } from "@/web/components/locale-link";
import { Button } from "@/web/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/web/components/ui/collapsible";
import { Logo } from "@/web/components/ui/logo";
import { useLanguageSwitch, useLocalePathname } from "@/web/hooks/use-locale";
import { cn } from "@/web/shared/utils";

// ── Nav tree definition ─────────────────────────────────────────────

interface NavLeaf {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  exact?: boolean;
  children?: NavLeaf[]; // sub-items shown indented below this leaf
}

interface NavGroup {
  labelKey: string;
  icon: LucideIcon;
  prefix: string;
  children: NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "prefix" in entry;
}

const navTree: NavEntry[] = [
  {
    labelKey: "docs.nav.guide",
    icon: BookOpen,
    prefix: "/docs/guide",
    children: [{ href: "/docs", labelKey: "docs.nav.guide-overview", icon: BookOpen, exact: true }],
  },
  {
    labelKey: "docs.nav.deploy",
    icon: Layers,
    prefix: "/docs/deploy",
    children: [
      { href: "/docs/deploy-production", labelKey: "docs.nav.production", icon: Database },
      { href: "/docs/database", labelKey: "docs.nav.database", icon: ArrowUpCircle },
    ],
  },
  {
    labelKey: "docs.nav.architecture",
    icon: Blocks,
    prefix: "/docs/architecture",
    children: [
      { href: "/docs/architecture", labelKey: "docs.nav.system-arch", icon: Blocks },
      { href: "/docs/security", labelKey: "docs.nav.security", icon: ShieldCheck },
      { href: "/docs/brand-guidelines", labelKey: "docs.nav.brand", icon: Palette },
    ],
  },
];

// ── Sidebar content (shared between desktop aside and mobile sheet) ──

export function DocsSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useLocalePathname();
  const { t } = useTranslation();
  const { currentLang, toggleLang } = useLanguageSwitch();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-7">
        <Logo className="h-8 w-8" subtitle={t("docs.nav.subtitle")} />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navTree.map((entry, i) =>
          isGroup(entry) ? (
            <NavGroupItem key={i} group={entry} pathname={pathname} t={t} onNavigate={onNavigate} />
          ) : (
            <NavLinkItem
              key={entry.href}
              item={entry}
              pathname={pathname}
              t={t}
              onNavigate={onNavigate}
            />
          ),
        )}
      </nav>

      <div className="border-t px-4 py-4 space-y-2">
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={toggleLang} className="gap-1.5 text-xs">
            <Languages className="h-3.5 w-3.5" />
            {currentLang === "zh" ? "EN" : "中文"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Desktop sidebar wrapper ──────────────────────────────────────────

export function DocsSidebar() {
  return (
    <aside className="hidden md:flex h-screen w-64 flex-col border-r bg-card">
      <DocsSidebarContent />
    </aside>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

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
  const hasActiveChild = pathname === "/docs" || pathname.startsWith(group.prefix);

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
          <ChevronDown className="h-3.5 w-3.5 transition-transform data-[state=open]:rotate-180" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 mt-1 space-y-0.5 border-l pl-3">
          {group.children.map((child) => (
            <NavLeafWithChildren
              key={child.href}
              item={child}
              pathname={pathname}
              t={t}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Renders a nav leaf + optional indented sub-items */
function NavLeafWithChildren({
  item,
  pathname,
  t,
  depth = 0,
  onNavigate,
}: {
  item: NavLeaf;
  pathname: string;
  t: (k: string) => string;
  depth?: number;
  onNavigate?: () => void;
}) {
  const hasChildren = item.children && item.children.length > 0;
  // If this leaf has children, use exact match so child pages don't highlight the parent
  const isActive =
    item.exact || hasChildren
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(item.href + "/");
  const nested = depth > 0;

  return (
    <div>
      <LocaleLink
        to={item.href}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors",
          nested ? "text-[13px]" : "text-[13px]",
          isActive
            ? "bg-primary/10 text-primary font-medium"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {item.icon && <item.icon className="h-3.5 w-3.5" />}
        {t(item.labelKey)}
      </LocaleLink>
      {hasChildren && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l pl-3">
          {item.children!.map((child) => (
            <NavLeafWithChildren
              key={child.href}
              item={child}
              pathname={pathname}
              t={t}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NavLinkItem({
  item,
  pathname,
  t,
  onNavigate,
}: {
  item: NavLeaf;
  pathname: string;
  t: (k: string) => string;
  onNavigate?: () => void;
}) {
  const isActive = item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + "/");

  return (
    <LocaleLink
      to={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        isActive
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {item.icon && <item.icon className="h-3.5 w-3.5" />}
      {t(item.labelKey)}
    </LocaleLink>
  );
}
