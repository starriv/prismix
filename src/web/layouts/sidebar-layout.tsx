import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router-dom";

import { Languages, Menu } from "lucide-react";

import { ThemeToggle } from "@/web/components/dashboard/theme-toggle";
import { Button } from "@/web/components/ui/button";
import { Logo } from "@/web/components/ui/logo";
import { Sheet, SheetContent } from "@/web/components/ui/sheet";
import { useLanguageSwitch } from "@/web/hooks/use-locale";
import { useMobileSidebar } from "@/web/hooks/use-mobile-sidebar";

interface SidebarLayoutProps {
  sidebar: ReactNode;
  mobileSidebar: (onNavigate: () => void) => ReactNode;
  trailing?: ReactNode;
}

export function SidebarLayout({ sidebar, mobileSidebar, trailing }: SidebarLayoutProps) {
  const { t } = useTranslation();
  const { isMobile, isOpen, toggle, close } = useMobileSidebar();
  const { toggleLang } = useLanguageSwitch();

  // Prevent page-level scroll — all scrolling happens inside <main>
  useEffect(() => {
    const html = document.documentElement;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = "";
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Skip-to-content link — visible only on keyboard focus */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:text-sm focus:font-medium focus:shadow-lg"
      >
        {t("common.a11y.skip-to-content")}
      </a>

      {sidebar}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {isMobile && (
          <div className="flex items-center justify-between border-b bg-background px-4 py-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={t("common.mobile.open-menu")}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <Logo className="h-7 w-7" iconOnly />
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleLang}
                aria-label={t("common.a11y.toggle-lang")}
              >
                <Languages className="h-3.5 w-3.5" />
              </Button>
              {trailing}
            </div>
          </div>
        )}

        <main
          id="main-content"
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
        >
          <Outlet />
        </main>
      </div>

      <Sheet open={isOpen} onOpenChange={close}>
        <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
          {mobileSidebar(close)}
        </SheetContent>
      </Sheet>
    </div>
  );
}
