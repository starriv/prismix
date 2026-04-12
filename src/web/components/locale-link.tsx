import { Link, Navigate } from "react-router-dom";
import type { LinkProps } from "react-router-dom";

import { useCurrentLang } from "@/web/hooks/use-locale";

/**
 * Drop-in replacement for `<Link>` that auto-prepends `/:lang` to absolute `to` paths.
 */
export function LocaleLink({ to, ...rest }: LinkProps) {
  const lang = useCurrentLang();
  const localeTo = typeof to === "string" && to.startsWith("/") ? `/${lang}${to}` : to;
  return <Link to={localeTo} {...rest} />;
}

/**
 * Drop-in replacement for `<Navigate>` that auto-prepends `/:lang` to absolute `to` paths.
 */
export function LocaleNavigate({
  to,
  ...rest
}: {
  to: string;
  replace?: boolean;
  state?: unknown;
}) {
  const lang = useCurrentLang();
  const localeTo = to.startsWith("/") ? `/${lang}${to}` : to;
  return <Navigate to={localeTo} {...rest} />;
}
