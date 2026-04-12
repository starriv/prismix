/**
 * Platform hot wallet — holds USDC for automatic withdrawal payouts.
 *
 * The private key is loaded from PLATFORM_HOT_WALLET_KEY env var (hex string).
 * This wallet is used to send USDC transfers on supported networks.
 *
 * Security: The hot wallet should hold limited funds. Monitor balance
 * and top up manually from a cold wallet as needed.
 */
import { type Address, createWalletClient, formatUnits, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  getChainConfig,
  getPublicClient,
  getUsdcAddress,
  resolveRpcUrl,
  USDC_ABI,
} from "@/blockchain/config";
import { log } from "@/server/lib/logger";

// ── Configuration ────────────────────────────────────────────────────

const USDC_DECIMALS = 6;

/** Check if the platform hot wallet is configured. */
export function isHotWalletConfigured(): boolean {
  return !!process.env.PLATFORM_HOT_WALLET_KEY;
}

function getHotWalletKey(): `0x${string}` {
  const key = process.env.PLATFORM_HOT_WALLET_KEY;
  if (!key) throw new Error("PLATFORM_HOT_WALLET_KEY is not configured");
  return key.startsWith("0x") ? (key as `0x${string}`) : (`0x${key}` as `0x${string}`);
}

/** Get the hot wallet account (viem Account). */
export function getHotWalletAccount() {
  return privateKeyToAccount(getHotWalletKey());
}

/** Get the hot wallet address. */
export function getHotWalletAddress(): Address {
  return getHotWalletAccount().address;
}

// ── Balance ──────────────────────────────────────────────────────────

/** Read the hot wallet USDC balance on a specific network. Returns formatted string. */
export async function getHotWalletBalance(networkId: string): Promise<string> {
  const client = getPublicClient(networkId);
  const usdcAddress = getUsdcAddress(networkId);
  const address = getHotWalletAddress();

  const balance = await client.readContract({
    address: usdcAddress,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [address],
  });

  return formatUnits(balance as bigint, USDC_DECIMALS);
}

/** Get hot wallet balances across all supported payment networks. */
export async function getHotWalletBalances(): Promise<
  Array<{ networkId: string; name: string; balance: string }>
> {
  const chainConfig = getChainConfig();
  const results: Array<{ networkId: string; name: string; balance: string }> = [];

  for (const [networkId, config] of Object.entries(chainConfig)) {
    try {
      const balance = await getHotWalletBalance(networkId);
      results.push({ networkId, name: config.chain.name, balance });
    } catch (err) {
      log.blockchain.warn({ err, networkId }, "Failed to read hot wallet balance");
      results.push({ networkId, name: config.chain.name, balance: "0" });
    }
  }

  return results;
}

// ── Send USDC ────────────────────────────────────────────────────────

interface SendUsdcOpts {
  toAddress: Address;
  /** USDC amount as a human-readable string (e.g. "10.5") */
  amount: string;
  networkId: string;
}

interface SendUsdcResult {
  txHash: `0x${string}`;
}

/**
 * Send USDC from the platform hot wallet to a destination address.
 *
 * 1. Creates a walletClient with the hot wallet private key
 * 2. Calls the USDC transfer(to, amount) function
 * 3. Waits for the transaction to be included in a block
 * 4. Returns the transaction hash
 */
export async function sendUsdc(opts: SendUsdcOpts): Promise<SendUsdcResult> {
  const { toAddress, amount, networkId } = opts;
  const account = getHotWalletAccount();
  const config = getChainConfig()[networkId];
  if (!config) throw new Error(`Unsupported network: ${networkId}`);

  const rpcUrl = resolveRpcUrl(config.chainId, config.rpcUrl);
  const usdcAddress = getUsdcAddress(networkId);
  const parsedAmount = parseUnits(amount, USDC_DECIMALS);

  const client = createWalletClient({
    account,
    chain: config.chain,
    transport: http(rpcUrl),
  });

  log.blockchain.info(
    { toAddress, amount, networkId, from: account.address },
    "Sending USDC from hot wallet",
  );

  // Send the USDC transfer transaction
  const txHash = await client.writeContract({
    address: usdcAddress,
    abi: USDC_ABI,
    functionName: "transfer",
    args: [toAddress, parsedAmount],
  });

  // Wait for confirmation
  const publicClient = getPublicClient(networkId);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === "reverted") {
    throw new Error(`USDC transfer reverted: ${txHash}`);
  }

  log.blockchain.info(
    { txHash, toAddress, amount, networkId, blockNumber: Number(receipt.blockNumber) },
    "USDC transfer confirmed",
  );

  return { txHash };
}
