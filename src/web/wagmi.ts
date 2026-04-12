import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { type Chain, defineChain } from "viem";
import { base, baseSepolia, polygon } from "viem/chains";
import { http } from "wagmi";

import { CIRCLE_NETWORKS, SUPPORTED_PAYMENT_CHAIN_IDS } from "@/shared/circle-networks";

// ── viem chain map ───────────────────────────────────────────────────
// viem Chain objects carry full RPC/ENS config that defineChain() can't replicate.
// Only include chains that support payments — this drives the
// RainbowKit chain switcher UI in the header.

const VIEM_CHAIN_MAP: Record<number, Chain> = {
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
  [polygon.id]: polygon,
};

function resolveViemChain(chainId: number, name: string, explorerUrl: string): Chain {
  return (
    VIEM_CHAIN_MAP[chainId] ??
    defineChain({
      id: chainId,
      name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [] } },
      blockExplorers: explorerUrl ? { default: { name: "Explorer", url: explorerUrl } } : undefined,
    })
  );
}

// ── Derive chains from supported CIRCLE_NETWORKS ────────────────────
// Only payment-supported chains appear in the wallet chain switcher.
// CIRCLE_NETWORKS remains the full registry for display fallback (useChainRegistry).
const chains = CIRCLE_NETWORKS.filter((n) => SUPPORTED_PAYMENT_CHAIN_IDS.has(n.chainId)).map((n) =>
  resolveViemChain(n.chainId, n.name, n.explorerUrl),
) as [Chain, ...Chain[]];

export const config = getDefaultConfig({
  appName: "Prismix",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "YOUR_PROJECT_ID",
  chains,
  transports: Object.fromEntries(chains.map((c) => [c.id, http()])),
});
