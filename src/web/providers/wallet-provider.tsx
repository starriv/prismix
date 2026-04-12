import { lazy, type ReactNode, Suspense } from "react";

// Lazy-load the Web3 stack — wagmi + RainbowKit (~380KB) are deferred
// until a route that actually needs wallet functionality is rendered.
const WalletProviderInner = lazy(() => import("./wallet-provider-inner"));

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="h-screen bg-background" />}>
      <WalletProviderInner>{children}</WalletProviderInner>
    </Suspense>
  );
}
