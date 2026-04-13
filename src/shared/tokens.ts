/**
 * Well-known token contract addresses per network.
 *
 * Sources:
 * - USDC: https://www.circle.com/multi-chain-usdc
 * - EURC: https://www.circle.com/eurc
 * - USDT: https://tether.to/en/supported-protocols
 */

export interface KnownToken {
  symbol: string;
  name: string;
  decimals: number;
}

export const KNOWN_TOKENS: KnownToken[] = [
  { symbol: "USDC", name: "USD Coin", decimals: 6 },
  { symbol: "USDT", name: "Tether USD", decimals: 6 },
  { symbol: "EURC", name: "Euro Coin", decimals: 6 },
];

/** Primary settlement token symbol used across UI and server. */
export const TOKEN_SYMBOL = "USDC";

/** Decimal precision for the settlement token — derived from KNOWN_TOKENS. */
export const SETTLEMENT_DECIMALS = KNOWN_TOKENS.find((t) => t.symbol === TOKEN_SYMBOL)!.decimals;

/** Minimum amount accepted for a wallet top-up order. */
export const MIN_TOPUP_AMOUNT = "5";

/** Map of `symbol:networkId` → contract address */
export const KNOWN_TOKEN_ADDRESSES: Record<string, string> = {
  // ── USDC (source: circle.com/multi-chain-usdc) ────────────────
  "USDC:eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
  "USDC:eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
  "USDC:eip155:1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Ethereum
  "USDC:eip155:11155111": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Ethereum Sepolia
  "USDC:eip155:42161": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum One
  "USDC:eip155:421614": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // Arbitrum Sepolia
  "USDC:eip155:10": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", // OP Mainnet
  "USDC:eip155:11155420": "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", // OP Sepolia
  "USDC:eip155:137": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Polygon PoS
  "USDC:eip155:80002": "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582", // Polygon Amoy
  "USDC:eip155:43114": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", // Avalanche
  "USDC:eip155:324": "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4", // zkSync Era
  "USDC:eip155:59144": "0x176211869ca2b568f2a7d4ee941e073a821ee1ff", // Linea
  "USDC:eip155:42220": "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", // Celo
  "USDC:eip155:1329": "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392", // Sei
  "USDC:eip155:146": "0x29219dd400f2bf60e5a23d13be72b486d4038894", // Sonic
  "USDC:eip155:130": "0x078d782b760474a361dda0af3839290b0ef57ad6", // Unichain
  "USDC:eip155:480": "0x79A02482A880bCe3F13E09da970dC34dB4cD24D1", // World Chain

  // ── USDT (source: tether.to/en/supported-protocols) ───────────
  "USDT:eip155:1": "0xdAC17F958D2ee523a2206206994597C13D831ec7", // Ethereum
  "USDT:eip155:10": "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", // Optimism
  "USDT:eip155:42161": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // Arbitrum One
  "USDT:eip155:137": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // Polygon PoS
  "USDT:eip155:43114": "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", // Avalanche
  "USDT:eip155:8453": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", // Base

  // ── EURC (source: circle.com/eurc) ────────────────────────────
  "EURC:eip155:1": "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c", // Ethereum
  "EURC:eip155:8453": "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", // Base
  "EURC:eip155:43114": "0xC891EB4CbDEFf6e073e859e987815Ed1505c2ACD", // Avalanche
};

/** Look up a known contract address, or return undefined */
export function getKnownAddress(symbol: string, networkId: string): string | undefined {
  return KNOWN_TOKEN_ADDRESSES[`${symbol}:${networkId}`];
}

/** Get all known addresses for a token symbol, grouped by networkId */
export function getKnownAddressesForToken(
  symbol: string,
): { networkId: string; address: string }[] {
  const prefix = `${symbol}:`;
  return Object.entries(KNOWN_TOKEN_ADDRESSES)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, address]) => ({ networkId: key.slice(prefix.length), address }));
}
