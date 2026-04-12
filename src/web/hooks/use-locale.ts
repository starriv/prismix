import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { DEFAULT_LANG, SUPPORTED_LANGS } from "@/i18n";
import type { SupportedLang } from "@/i18n";

/**
 * Read the current language from the `:lang` route param.
 * Falls back to DEFAULT_LANG if the param is missing or invalid.
 */
export function useCurrentLang(): SupportedLang {
  const { lang } = useParams<{ lang: string }>();
  return lang && (SUPPORTED_LANGS as readonly string[]).includes(lang)
    ? (lang as SupportedLang)
    : DEFAULT_LANG;
}

/**
 * Prepend `/:lang` to an absolute path. Relative paths are returned as-is.
 */
export function useLocalePath(path: string): string {
  const lang = useCurrentLang();
  return path.startsWith("/") ? `/${lang}${path}` : path;
}

/**
 * Wrapped `navigate()` that auto-prepends `/:lang` to absolute paths.
 */
export function useLocaleNavigate() {
  const lang = useCurrentLang();
  const navigate = useNavigate();

  return useCallback(
    (to: string | number, options?: { replace?: boolean; state?: unknown }) => {
      if (typeof to === "number") {
        navigate(to);
        return;
      }
      const target = to.startsWith("/") ? `/${lang}${to}` : to;
      navigate(target, options);
    },
    [lang, navigate],
  );
}

/**
 * Language switch via URL navigation.
 * Returns the current lang and a toggle function that navigates to the
 * equivalent path under the other language prefix.
 */
export function useLanguageSwitch() {
  const lang = useCurrentLang();
  const navigate = useNavigate();
  const location = useLocation();

  const toggleLang = useCallback(() => {
    const targetLang = lang === "zh" ? "en" : "zh";
    const newPath = location.pathname.replace(/^\/(en|zh)/, `/${targetLang}`);
    navigate(newPath + location.search + location.hash, { replace: true });
  }, [lang, navigate, location]);

  return { currentLang: lang, toggleLang };
}

/**
 * Return the current pathname with the `/:lang` prefix stripped.
 * Useful for sidebar active-state comparisons against paths like `/docs/security`.
 */
export function useLocalePathname(): string {
  const { pathname } = useLocation();
  return pathname.replace(/^\/(en|zh)/, "") || "/";
}
