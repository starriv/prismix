import { keyBy } from "lodash-es";
import { type Chain, createPublicClient, defineChain, http } from "viem";
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  base,
  baseSepolia,
  celo,
  linea,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sei,
  sepolia,
  worldchain,
  zksync,
} from "viem/chains";

import type { SupportedNetwork } from "@/server/db";
import { log } from "@/server/lib/logger";
import { CIRCLE_NETWORK_BY_CHAIN_ID } from "@/shared/circle-networks";

// ── Alchemy RPC auto-resolution ──────────────────────────────────

/** Alchemy subdomain mapping: chainId → Alchemy network slug */
const ALCHEMY_NETWORK_SLUGS: Record<number, string> = {
  1: "eth-mainnet",
  11155111: "eth-sepolia",
  137: "polygon-mainnet",
  80002: "polygon-amoy",
  8453: "base-mainnet",
  84532: "base-sepolia",
  42161: "arb-mainnet",
  421614: "arb-sepolia",
  10: "opt-mainnet",
  11155420: "opt-sepolia",
  324: "zksync-mainnet",
  59144: "linea-mainnet",
};

/**
 * Get the RPC URL for a network. Resolution order:
 * 1. Alchemy (if ALCHEMY_API_KEY is set and network is supported) — most reliable
 * 2. DB-configured `rpcUrl` per network (admin override)
 * 3. Public RPC fallback (rotated, from chainlist.org)
 */
export function resolveRpcUrl(chainId: number, dbRpcUrl?: string | null): string {
  // 1. Alchemy takes top priority when configured (reliable, rate-limited)
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (alchemyKey) {
    const slug = ALCHEMY_NETWORK_SLUGS[chainId];
    if (slug) return `https://${slug}.g.alchemy.com/v2/${alchemyKey}`;
  }

  // 2. DB-configured rpc_url (from seed / admin override)
  if (dbRpcUrl) return dbRpcUrl;

  throw new Error(
    `No RPC URL for chain ${chainId}. Set ALCHEMY_API_KEY or configure rpc_url in supported_networks.`,
  );
}

export const USDC_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
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

// ── Multi-chain viem config ────────────────────────────────────────

/** Map chainId → viem chain definition (static — viem objects can't be generated from DB) */
const VIEM_CHAINS: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
  [arbitrum.id]: arbitrum,
  [arbitrumSepolia.id]: arbitrumSepolia,
  [optimism.id]: optimism,
  [optimismSepolia.id]: optimismSepolia,
  [polygon.id]: polygon,
  [polygonAmoy.id]: polygonAmoy,
  [avalanche.id]: avalanche,
  [zksync.id]: zksync,
  [linea.id]: linea,
  [celo.id]: celo,
  [sei.id]: sei,
  [worldchain.id]: worldchain,
};

/** Get a viem Chain for a chainId — uses CIRCLE_NETWORKS for metadata fallback */
function getViemChain(chainId: number): Chain {
  if (VIEM_CHAINS[chainId]) return VIEM_CHAINS[chainId];
  const circle = CIRCLE_NETWORK_BY_CHAIN_ID[chainId];
  const name = circle?.name ?? `Chain ${chainId}`;
  const explorerUrl = circle?.explorerUrl;
  return defineChain({
    id: chainId,
    name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
    blockExplorers: explorerUrl ? { default: { name: "Explorer", url: explorerUrl } } : undefined,
  });
}

interface NetworkConfig extends SupportedNetwork {
  chain: Chain;
}

function buildChainConfig(networks: SupportedNetwork[]): Record<string, NetworkConfig> {
  const configs: NetworkConfig[] = networks.map((net) => ({
    ...net,
    chain: getViemChain(net.chainId),
  }));
  return keyBy(configs, "networkId") as Record<string, NetworkConfig>;
}

// Lazy chain config — populated on first access or via initChainConfig()
let _chainConfig: Record<string, NetworkConfig> | null = null;
let _blockchainConfigInitialized = false;
let _blockchainConfigInitPromise: Promise<void> | null = null;

/**
 * Get the chain config map. Must call initChainConfig() at startup.
 * Returns empty map if not yet initialized.
 */
export function getChainConfig(): Record<string, NetworkConfig> {
  if (!_chainConfig) {
    log.blockchain.warn("Chain config not initialized — call initChainConfig() at startup");
    return {};
  }
  return _chainConfig;
}

/** Invalidate the cached chain config (e.g., after network CRUD). */
export function invalidateChainConfig(): void {
  _chainConfig = null;
  _blockchainConfigInitialized = false;
}

// Backward-compatible constant — delegates to lazy getter
export const CHAIN_CONFIG: Record<string, NetworkConfig> = new Proxy(
  {} as Record<string, NetworkConfig>,
  {
    get(_target, prop, receiver) {
      return Reflect.get(getChainConfig(), prop, receiver);
    },
    has(_target, prop) {
      return Reflect.has(getChainConfig(), prop);
    },
    ownKeys() {
      return Reflect.ownKeys(getChainConfig());
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(getChainConfig(), prop);
    },
  },
);

/** Get a viem publicClient for a given networkId */
export function getPublicClient(networkId: string) {
  const config = getChainConfig()[networkId];
  if (!config) throw new Error(`Unsupported network: ${networkId}`);
  const rpcUrl = resolveRpcUrl(config.chainId, config.rpcUrl);
  return createPublicClient({
    chain: config.chain,
    transport: http(rpcUrl),
  });
}

/**
 * Fetch logs in chunks to work around RPC block-range limits.
 * Default chunk size 2,000 blocks — safe for most RPC providers including
 * Alchemy PAYG tier. Walks backward from toBlock → fromBlock so newest
 * results come first. Stops early once `limit` results are collected.
 */
export async function chunkedGetLogs(opts: {
  client: ReturnType<typeof getPublicClient>;
  address: `0x${string}`;
  event: Parameters<ReturnType<typeof getPublicClient>["getLogs"]>[0] extends { event: infer E }
    ? E
    : never;
  args: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
  chunkSize?: bigint;
  limit?: number;
}): Promise<unknown[]> {
  const { client, address, event, args, fromBlock, toBlock, chunkSize = 2_000n, limit } = opts;
  const results: unknown[] = [];
  let chunkEnd = toBlock;

  while (chunkEnd >= fromBlock) {
    const chunkStart =
      chunkEnd - chunkSize + 1n > fromBlock ? chunkEnd - chunkSize + 1n : fromBlock;
    try {
      const logs = await client.getLogs({
        address,
        event: event as never,
        args: args as never,
        fromBlock: chunkStart,
        toBlock: chunkEnd,
      });
      results.push(...logs);
      if (limit && results.length >= limit) break;
    } catch (err) {
      log.blockchain.warn(
        { err, chunkStart: Number(chunkStart), chunkEnd: Number(chunkEnd) },
        "getLogs chunk failed, skipping",
      );
    }
    chunkEnd = chunkStart - 1n;
  }

  return results;
}

// ── USDC address cache (populated at startup) ──────────────────────

let _usdcAddresses: Record<string, string> = {};

/**
 * Get the USDC contract address for a given networkId.
 * Uses in-memory cache populated by initBlockchainConfig().
 */
export function getUsdcAddress(networkId: string): `0x${string}` {
  const addr = _usdcAddresses[networkId];
  if (!addr) throw new Error(`No USDC address for network: ${networkId}`);
  return addr as `0x${string}`;
}

/**
 * Async initialization — call at startup to populate chain config and USDC addresses.
 */
export async function initBlockchainConfig(): Promise<void> {
  // Import dynamically to avoid circular dependency at module load time
  const { networkRepo } = await import("@/server/repos");

  // Chain config
  const nets = await networkRepo.findEnabledNetworks();
  _chainConfig = buildChainConfig(nets);

  // USDC addresses
  const tokens = await networkRepo.findEnabledTokens();
  _usdcAddresses = {};
  for (const t of tokens) {
    if (t.symbol === "USDC" && t.contractAddress) {
      _usdcAddresses[t.network] = t.contractAddress;
    }
  }

  _blockchainConfigInitialized = true;
}

/**
 * Ensure blockchain config is loaded for request-time callers.
 * This makes the app resilient when a request lands before bootstrap finishes
 * or when an environment bypasses the normal bootstrap path.
 */
export async function ensureBlockchainConfig(): Promise<void> {
  if (_blockchainConfigInitialized) return;
  if (_blockchainConfigInitPromise) {
    await _blockchainConfigInitPromise;
    return;
  }

  _blockchainConfigInitPromise = initBlockchainConfig()
    .catch((err) => {
      _blockchainConfigInitialized = false;
      throw err;
    })
    .finally(() => {
      _blockchainConfigInitPromise = null;
    });

  await _blockchainConfigInitPromise;
}
