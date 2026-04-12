/**
 * Circle official USDC network registry.
 *
 * Single source of truth for all EVM networks where Circle deploys native USDC
 * with EIP-3009 (transferWithAuthorization) support.
 *
 * Source: https://www.circle.com/multi-chain-usdc
 *
 * Only networks with confirmed chain IDs and USDC contract addresses are listed.
 * New chains should be added here first, then synced to seed SQL + tokens.ts.
 */

export interface CircleNetwork {
  /** EVM chain ID */
  chainId: number;
  /** CAIP-2 network identifier (eip155:<chainId>) */
  networkId: string;
  /** Display name */
  name: string;
  /** Short identifier used in URLs / CLI */
  shortName: string;
  /** Block explorer URL */
  explorerUrl: string;
  /** Whether this is a testnet */
  testnet: boolean;
  /** Icon URL for display */
  iconUrl: string;
  /** Circle native USDC contract address on this network */
  usdcAddress: string;
}

// Icon helper — llamao hosts chain icons by short name
const icon = (name: string) => `https://icons.llamao.fi/icons/chains/rsz_${name}.jpg`;

/**
 * All Circle native USDC EVM networks.
 *
 * Sorted: mainnets grouped with their testnets, ordered by prominence.
 */
export const CIRCLE_NETWORKS: CircleNetwork[] = [
  // ── Base ────────────────────────────────────────────────────────────
  {
    chainId: 8453,
    networkId: "eip155:8453",
    name: "Base",
    shortName: "base",
    explorerUrl: "https://basescan.org",
    testnet: false,
    iconUrl: icon("base"),
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  {
    chainId: 84532,
    networkId: "eip155:84532",
    name: "Base Sepolia",
    shortName: "base-sepolia",
    explorerUrl: "https://sepolia.basescan.org",
    testnet: true,
    iconUrl: icon("base"),
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },

  // ── Ethereum ────────────────────────────────────────────────────────
  {
    chainId: 1,
    networkId: "eip155:1",
    name: "Ethereum",
    shortName: "ethereum",
    explorerUrl: "https://etherscan.io",
    testnet: false,
    iconUrl: icon("ethereum"),
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
  {
    chainId: 11155111,
    networkId: "eip155:11155111",
    name: "Sepolia",
    shortName: "sepolia",
    explorerUrl: "https://sepolia.etherscan.io",
    testnet: true,
    iconUrl: icon("ethereum"),
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },

  // ── Arbitrum ────────────────────────────────────────────────────────
  {
    chainId: 42161,
    networkId: "eip155:42161",
    name: "Arbitrum One",
    shortName: "arbitrum",
    explorerUrl: "https://arbiscan.io",
    testnet: false,
    iconUrl: icon("arbitrum"),
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  {
    chainId: 421614,
    networkId: "eip155:421614",
    name: "Arbitrum Sepolia",
    shortName: "arbitrum-sepolia",
    explorerUrl: "https://sepolia.arbiscan.io",
    testnet: true,
    iconUrl: icon("arbitrum"),
    usdcAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  },

  // ── Optimism ────────────────────────────────────────────────────────
  {
    chainId: 10,
    networkId: "eip155:10",
    name: "OP Mainnet",
    shortName: "optimism",
    explorerUrl: "https://optimistic.etherscan.io",
    testnet: false,
    iconUrl: icon("optimism"),
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  },
  {
    chainId: 11155420,
    networkId: "eip155:11155420",
    name: "OP Sepolia",
    shortName: "op-sepolia",
    explorerUrl: "https://sepolia-optimism.etherscan.io",
    testnet: true,
    iconUrl: icon("optimism"),
    usdcAddress: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
  },

  // ── Polygon ─────────────────────────────────────────────────────────
  {
    chainId: 137,
    networkId: "eip155:137",
    name: "Polygon PoS",
    shortName: "polygon",
    explorerUrl: "https://polygonscan.com",
    testnet: false,
    iconUrl: icon("polygon"),
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
  {
    chainId: 80002,
    networkId: "eip155:80002",
    name: "Polygon Amoy",
    shortName: "polygon-amoy",
    explorerUrl: "https://amoy.polygonscan.com",
    testnet: true,
    iconUrl: icon("polygon"),
    usdcAddress: "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582",
  },

  // ── Avalanche ───────────────────────────────────────────────────────
  {
    chainId: 43114,
    networkId: "eip155:43114",
    name: "Avalanche",
    shortName: "avalanche",
    explorerUrl: "https://snowtrace.io",
    testnet: false,
    iconUrl: icon("avalanche"),
    usdcAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  },

  // ── zkSync Era ──────────────────────────────────────────────────────
  {
    chainId: 324,
    networkId: "eip155:324",
    name: "zkSync Era",
    shortName: "zksync",
    explorerUrl: "https://explorer.zksync.io",
    testnet: false,
    iconUrl: icon("zksync"),
    usdcAddress: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4",
  },

  // ── Linea ───────────────────────────────────────────────────────────
  {
    chainId: 59144,
    networkId: "eip155:59144",
    name: "Linea",
    shortName: "linea",
    explorerUrl: "https://lineascan.build",
    testnet: false,
    iconUrl: icon("linea"),
    usdcAddress: "0x176211869ca2b568f2a7d4ee941e073a821ee1ff",
  },

  // ── Celo ────────────────────────────────────────────────────────────
  {
    chainId: 42220,
    networkId: "eip155:42220",
    name: "Celo",
    shortName: "celo",
    explorerUrl: "https://celoscan.io",
    testnet: false,
    iconUrl: icon("celo"),
    usdcAddress: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
  },

  // ── Sei ─────────────────────────────────────────────────────────────
  {
    chainId: 1329,
    networkId: "eip155:1329",
    name: "Sei",
    shortName: "sei",
    explorerUrl: "https://seitrace.com",
    testnet: false,
    iconUrl: icon("sei"),
    usdcAddress: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
  },

  // ── Sonic ───────────────────────────────────────────────────────────
  {
    chainId: 146,
    networkId: "eip155:146",
    name: "Sonic",
    shortName: "sonic",
    explorerUrl: "https://sonicscan.org",
    testnet: false,
    iconUrl: icon("sonic"),
    usdcAddress: "0x29219dd400f2bf60e5a23d13be72b486d4038894",
  },

  // ── Unichain ────────────────────────────────────────────────────────
  {
    chainId: 130,
    networkId: "eip155:130",
    name: "Unichain",
    shortName: "unichain",
    explorerUrl: "https://uniscan.xyz",
    testnet: false,
    iconUrl: icon("unichain"),
    usdcAddress: "0x078d782b760474a361dda0af3839290b0ef57ad6",
  },

  // ── World Chain ─────────────────────────────────────────────────────
  {
    chainId: 480,
    networkId: "eip155:480",
    name: "World Chain",
    shortName: "worldchain",
    explorerUrl: "https://worldscan.org",
    testnet: false,
    iconUrl: icon("worldchain"),
    usdcAddress: "0x79A02482A880bCe3F13E09da970dC34dB4cD24D1",
  },
];

/** Lookup a Circle network by chain ID */
/** Lookup map: chainId → CircleNetwork (O(1) access) */
export const CIRCLE_NETWORK_BY_CHAIN_ID: Record<number, CircleNetwork> = Object.fromEntries(
  CIRCLE_NETWORKS.map((n) => [n.chainId, n]),
) as Record<number, CircleNetwork>;

/** Lookup map: networkId → CircleNetwork (O(1) access) */
export const CIRCLE_NETWORK_BY_NETWORK_ID: Record<string, CircleNetwork> = Object.fromEntries(
  CIRCLE_NETWORKS.map((n) => [n.networkId, n]),
) as Record<string, CircleNetwork>;

/** @deprecated Use CIRCLE_NETWORK_BY_CHAIN_ID[chainId] instead */
export function findCircleNetwork(chainId: number): CircleNetwork | undefined {
  return CIRCLE_NETWORK_BY_CHAIN_ID[chainId];
}

/** Get all mainnet Circle networks */
export function getCircleMainnets(): CircleNetwork[] {
  return CIRCLE_NETWORKS.filter((n) => !n.testnet);
}

/** Get all testnet Circle networks */
export function getCircleTestnets(): CircleNetwork[] {
  return CIRCLE_NETWORKS.filter((n) => n.testnet);
}

/**
 * Chain IDs supported for USDC payments.
 * Production networks always included; testnets only in development.
 */
export const SUPPORTED_PAYMENT_CHAIN_IDS: ReadonlySet<number> = new Set([
  8453, // Base
  137, // Polygon PoS
  ...(process.env.NODE_ENV === "development" ? [84532] : []), // Base Sepolia (dev only)
]);

/** Check if a chain ID is supported for payments */
export function isPaymentSupported(chainId: number): boolean {
  return SUPPORTED_PAYMENT_CHAIN_IDS.has(chainId);
}
