/**
 * Lightweight i18n helper for E2E tests.
 * Reads en.json directly and resolves dot-separated keys with {{var}} interpolation.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const en = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../../src/i18n/locales/en.json"), "utf-8"),
);

export function t(key: string, vars?: Record<string, string | number>): string {
  const parts = key.split(".");
  let value: unknown = en;
  for (const part of parts) {
    if (typeof value !== "object" || value === null) return key;
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value !== "string") return key;
  let result = value;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
    }
  }
  return result;
}
