import { zhCN } from "date-fns/locale/zh-CN";

/**
 * Returns the date-fns Locale matching the current i18n language.
 * English is the date-fns default — returns `undefined` so callers
 * can spread `{ locale: getDateLocale(lang) }` without extra checks.
 */
export function getDateLocale(lang: string) {
  if (lang === "zh") return zhCN;
  return undefined;
}
