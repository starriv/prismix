import { LocaleLink } from "@/web/components/locale-link";
import { useTheme } from "@/web/providers/theme-provider";
import { cn } from "@/web/shared/utils";

interface LogoProps {
  /** Size class for the icon (e.g. "h-7 w-7"). Defaults to "h-7 w-7". */
  className?: string;
  /** Override: always use dark or light variant regardless of theme */
  variant?: "dark" | "light";
  /** Optional subtitle shown below wordmark */
  subtitle?: string;
  /** Hide the wordmark, show icon only */
  iconOnly?: boolean;
}

export function Logo({ className, variant, subtitle, iconOnly }: LogoProps) {
  const { resolvedTheme } = useTheme();
  // Dark mode → dark logo (branded), Light mode → light logo (branded)
  const useDark = variant === "dark" || (!variant && resolvedTheme === "dark");

  return (
    <LocaleLink to="/" className="flex items-center gap-2" aria-label="Prismix home">
      <img
        src={useDark ? "/logo.svg" : "/logo-light.svg"}
        alt="Prismix"
        className={cn("rounded-lg", className ?? "h-7 w-7")}
        width="32"
        height="32"
      />
      {!iconOnly && (
        <div className="flex flex-col">
          <span
            className="text-[15px] font-extrabold leading-none"
            style={{ letterSpacing: "-0.02em" }}
          >
            prismix
          </span>
          {subtitle && (
            <span className="text-[10px] leading-tight text-muted-foreground mt-0.5">
              {subtitle}
            </span>
          )}
        </div>
      )}
    </LocaleLink>
  );
}
