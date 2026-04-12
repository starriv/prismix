import { type ReactNode, useMemo } from "react";

import { darkTheme, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";

import { useTheme } from "@/web/providers/theme-provider";

export function RainbowKitThemeSync({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const theme = useMemo(
    () => (resolvedTheme === "dark" ? darkTheme() : lightTheme()),
    [resolvedTheme],
  );
  return <RainbowKitProvider theme={theme}>{children}</RainbowKitProvider>;
}
