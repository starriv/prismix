import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useParams } from "react-router-dom";
import { Navigate } from "react-router-dom";

import { DEFAULT_LANG, SUPPORTED_LANGS } from "@/i18n";
import type { SupportedLang } from "@/i18n";

/** Map URL slug → BCP 47 lang tag for <html lang> and SEO */
const HTML_LANG_MAP: Record<SupportedLang, string> = {
  en: "en",
  zh: "zh-CN",
};

/**
 * Route element for `/:lang`. Validates the lang param, syncs i18next,
 * and sets `<html lang>`.
 */
export function LangRouter() {
  const { lang } = useParams<{ lang: string }>();
  const { i18n } = useTranslation();
  const location = useLocation();

  const isValid = lang && (SUPPORTED_LANGS as readonly string[]).includes(lang);

  // Sync i18next + <html lang> when URL language changes
  useEffect(() => {
    if (!isValid) return;
    if (i18n.language !== lang) {
      i18n.changeLanguage(lang);
    }
    document.documentElement.lang = HTML_LANG_MAP[lang as SupportedLang];
  }, [lang, isValid, i18n]);

  // Invalid lang segment → redirect to default lang, preserving the rest of the path
  if (!isValid) {
    const rest = location.pathname.replace(/^\/[^/]*/, "");
    return <Navigate to={`/${DEFAULT_LANG}${rest}`} replace />;
  }

  return <Outlet />;
}
