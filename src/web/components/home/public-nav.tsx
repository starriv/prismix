import { useTranslation } from "react-i18next";

import { ArrowRight, Languages } from "lucide-react";

import { getUserToken } from "@/web/api/user-client";
import { ThemeToggle } from "@/web/components/dashboard/theme-toggle";
import { LocaleLink } from "@/web/components/locale-link";
import { Button } from "@/web/components/ui/button";
import { Logo } from "@/web/components/ui/logo";
import { useLanguageSwitch } from "@/web/hooks/use-locale";

interface PublicNavProps {
  /** Extra action buttons rendered before the theme/lang toggles. */
  children?: React.ReactNode;
}

/**
 * Shared navigation bar for public (unauthenticated) pages — homepage, playground, etc.
 * Fixed top, blurred backdrop. Includes Logo, ThemeToggle, language toggle,
 * and a conditional "Launch App" link when the user is already logged in.
 */
export function PublicNav({ children }: PublicNavProps) {
  const { t } = useTranslation();
  const { currentLang, toggleLang } = useLanguageSwitch();
  const isLoggedIn = !!getUserToken();

  return (
    <header
      role="banner"
      className="fixed top-0 inset-x-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-sm"
    >
      <nav
        aria-label="Main navigation"
        className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between"
      >
        <Logo className="h-7 w-7" />
        <div className="flex items-center gap-2">
          {children}
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={toggleLang} className="gap-1.5 text-xs">
            <Languages className="h-3.5 w-3.5" />
            {currentLang === "zh" ? "EN" : "中文"}
          </Button>
          <LocaleLink
            to={isLoggedIn ? "/user/dashboard" : "/user/login"}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background hover:opacity-80 transition-opacity"
          >
            {t("home.nav.launch")}
            <ArrowRight className="h-3.5 w-3.5" />
          </LocaleLink>
        </div>
      </nav>
    </header>
  );
}
