import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

const MD_BREAKPOINT = "(min-width: 768px)";

export function useMobileSidebar() {
  const [isMobile, setIsMobile] = useState(() => !window.matchMedia(MD_BREAKPOINT).matches);
  const [isOpen, setIsOpen] = useState(false);
  const { pathname } = useLocation();

  // Track viewport changes
  useEffect(() => {
    const mql = window.matchMedia(MD_BREAKPOINT);
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(!e.matches);
      if (e.matches) setIsOpen(false); // close sheet when switching to desktop
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Auto-close on navigation
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  return { isMobile, isOpen, open, close, toggle };
}
