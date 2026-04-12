/**
 * Web-side chain utilities — driven by DB data via useNetworks() hook,
 * with static fallback to CIRCLE_NETWORKS for display when DB doesn't have the chain.
 */
import { useMemo } from "react";

import { keyBy } from "lodash-es";

import {
  CIRCLE_NETWORK_BY_CHAIN_ID,
  CIRCLE_NETWORK_BY_NETWORK_ID,
  type CircleNetwork,
} from "@/shared/circle-networks";
import { usePublicNetworks } from "@/web/api/hooks";
import type { SupportedNetwork } from "@/web/api/schemas";

// ── Constants ────────────────────────────────────────────────────────

export const DEFAULT_CHAIN_ID = 84532; // Base Sepolia

// ── Display layer ────────────────────────────────────────────────────

export type ChainDisplay = SupportedNetwork;

/** Convert a static CircleNetwork entry to ChainDisplay (for fallback) */
function circleNetworkToDisplay(net: CircleNetwork): ChainDisplay {
  return {
    id: 0,
    chainId: net.chainId,
    networkId: net.networkId,
    name: net.name,
    shortName: net.shortName,
    explorerUrl: net.explorerUrl,
    testnet: net.testnet,
    iconUrl: net.iconUrl,
    enabled: false,
    rpcUrl: "",
    createdAt: "",
  };
}

// ── Hook: useChainRegistry ──────────────────────────────────────────

interface ChainRegistry {
  /** All networks from DB (enabled only) */
  networks: SupportedNetwork[];
  /** Lookup by numeric chainId (DB networks only) */
  byChainId: Record<number, ChainDisplay>;
  /** Lookup by CAIP-2 networkId (DB networks only) */
  byNetworkId: Record<string, ChainDisplay>;
  /** Get chain display — DB first, then static CIRCLE_NETWORKS fallback */
  getChainDisplay: (chainId: number) => ChainDisplay | undefined;
  /** Get chain display by networkId — DB first, then static fallback */
  getChainDisplayByNetworkId: (networkId: string) => ChainDisplay | undefined;
  /** Convert networkId → chainId */
  chainIdFromNetworkId: (networkId: string) => number | undefined;
  /** Convert chainId → networkId */
  networkIdFromChainId: (chainId: number) => string;
  /** Convert networkId → chainId, falling back to DEFAULT_CHAIN_ID */
  chainIdFromNetworkIdOrDefault: (networkId: string) => number;
}

export function useChainRegistry(): ChainRegistry {
  const { data: networks = [] } = usePublicNetworks();

  return useMemo(() => {
    const byChainId = keyBy(networks, "chainId") as Record<number, ChainDisplay>;
    const byNetworkId = keyBy(networks, "networkId") as Record<string, ChainDisplay>;

    const getChainDisplay = (chainId: number): ChainDisplay | undefined => {
      const db = byChainId[chainId];
      if (db) return db;
      const circle = CIRCLE_NETWORK_BY_CHAIN_ID[chainId];
      return circle ? circleNetworkToDisplay(circle) : undefined;
    };

    const getChainDisplayByNetworkId = (networkId: string): ChainDisplay | undefined => {
      const db = byNetworkId[networkId];
      if (db) return db;
      const circle = CIRCLE_NETWORK_BY_NETWORK_ID[networkId];
      return circle ? circleNetworkToDisplay(circle) : undefined;
    };

    return {
      networks,
      byChainId,
      byNetworkId,
      getChainDisplay,
      getChainDisplayByNetworkId,
      chainIdFromNetworkId: (networkId: string) =>
        (byNetworkId[networkId] ?? CIRCLE_NETWORK_BY_NETWORK_ID[networkId])?.chainId,
      networkIdFromChainId: (chainId: number) =>
        (byChainId[chainId] ?? CIRCLE_NETWORK_BY_CHAIN_ID[chainId])?.networkId ??
        `eip155:${chainId}`,
      chainIdFromNetworkIdOrDefault: (networkId: string) =>
        (byNetworkId[networkId] ?? CIRCLE_NETWORK_BY_NETWORK_ID[networkId])?.chainId ??
        DEFAULT_CHAIN_ID,
    };
  }, [networks]);
}

// ── Pure helper functions (no static lookup) ─────────────────────────

export function explorerTxUrl(explorerUrl: string, hash: string): string {
  return `${explorerUrl}/tx/${hash}`;
}

export function explorerAddressUrl(explorerUrl: string, address: string): string {
  return `${explorerUrl}/address/${address}`;
}

// ── USDC ABI (unchanged, not chain-specific) ─────────────────────────

export const USDC_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
