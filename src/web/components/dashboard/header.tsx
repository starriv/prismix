import { Languages } from "lucide-react";

import { ThemeToggle } from "@/web/components/dashboard/theme-toggle";
import { WalletButton } from "@/web/components/dashboard/wallet-button";
import { Button } from "@/web/components/ui/button";
import { useLanguageSwitch } from "@/web/hooks/use-locale";

interface HeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function Header({ title, description, actions }: HeaderProps) {
  const { currentLang, toggleLang } = useLanguageSwitch();

  return (
    <div className="flex items-center justify-between border-b px-4 py-4 md:px-8 md:py-5">
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold tracking-tight md:text-xl">{title}</h2>
        {description && (
          <p className="hidden text-sm text-muted-foreground sm:block">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {actions}
        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={toggleLang} className="gap-1.5 text-xs">
            <Languages className="h-3.5 w-3.5" />
            {currentLang === "zh" ? "EN" : "中文"}
          </Button>
          <WalletButton />
        </div>
      </div>
    </div>
  );
}
