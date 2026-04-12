import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

// ── Types ────────────────────────────────────────────────────────

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  /** The resolved mode actually applied to the document */
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

// ── Constants ────────────────────────────────────────────────────

const STORAGE_KEY = "prismix-theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

// ── Context ──────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ── Helpers ──────────────────────────────────────────────────────

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "dark";
}

function getSystemPreference(): "light" | "dark" {
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
}

function resolve(theme: Theme): "light" | "dark" {
  return theme === "system" ? getSystemPreference() : theme;
}

function applyToDOM(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

// ── Provider ─────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [resolvedTheme, setResolved] = useState<"light" | "dark">(() => resolve(theme));

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
    const resolved = resolve(next);
    setResolved(resolved);
    applyToDOM(resolved);
  }, []);

  // Apply on mount
  useEffect(() => {
    applyToDOM(resolvedTheme);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for system preference changes when theme === "system"
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia(MEDIA_QUERY);
    const handler = (e: MediaQueryListEvent) => {
      const next = e.matches ? "dark" : "light";
      setResolved(next);
      applyToDOM(next);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
