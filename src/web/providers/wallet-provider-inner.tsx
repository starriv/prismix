import type { ReactNode } from "react";

import "@rainbow-me/rainbowkit/styles.css";
import { WagmiProvider } from "wagmi";

import { config } from "@/web/wagmi";

import { RainbowKitThemeSync } from "./rainbowkit-theme-sync";

// This module is lazy-loaded by WalletProvider so that wagmi + viem +
// RainbowKit (~380KB) are excluded from the initial bundle for routes
// that don't need wallet functionality (homepage, docs).

export default function WalletProviderInner({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <RainbowKitThemeSync>{children}</RainbowKitThemeSync>
    </WagmiProvider>
  );
}
