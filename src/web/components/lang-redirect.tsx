import { Navigate, useLocation } from "react-router-dom";

import i18n, { DEFAULT_LANG, SUPPORTED_LANGS } from "@/i18n";
import type { SupportedLang } from "@/i18n";

/**
 * Redirects bare paths (no `/:lang` prefix) to the detected language.
 * Detection order: localStorage → navigator → DEFAULT_LANG.
 *
 * Used as:
 * - `<Route path="/" element={<LangRedirect />} />`   (root)
 * - `<Route path="*" element={<LangRedirect />} />`   (catch-all for legacy links)
 */
export function LangRedirect() {
  const location = useLocation();

  const detected = i18n.language;
  const lang: SupportedLang = (SUPPORTED_LANGS as readonly string[]).includes(detected)
    ? (detected as SupportedLang)
    : DEFAULT_LANG;

  const path = location.pathname === "/" ? "" : location.pathname;
  const target = `/${lang}${path}${location.search}${location.hash}`;

  return <Navigate to={target} replace />;
}
