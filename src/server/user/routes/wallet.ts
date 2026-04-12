/**
 * User wallet routes — deposit, withdraw, balance, and transaction history.
 *
 * One user = one pay agent (wallet). The user's agentId is stored on the
 * `users` table and looked up via `getUserAgent()`.
 */
import type { Context } from "hono";
import { Hono } from "hono";
import type { Address } from "viem";
import { formatUnits } from "viem";

import { getChainConfig, getPublicClient, getUsdcAddress } from "@/blockchain/config";
import { enqueueDepositScan } from "@/server/jobs/scan-topup-deposit";
import { createTopupRequestBody, verifyDepositBody, withdrawBody } from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody, parsePaginationLimit, parsePaginationOffset } from "@/server/lib/validate";
import { ensureAgentWallet } from "@/server/lib/wallet";
import { getUserSession } from "@/server/middleware/auth";
import {
  payAgentRepo,
  payAgentTransactionRepo,
  topupOrderRepo,
  userRepo,
  withdrawOrderRepo,
} from "@/server/repos";
import { SUPPORTED_PAYMENT_CHAIN_IDS } from "@/shared/circle-networks";
import { gt, gte } from "@/shared/number";

const USDC_DECIMALS = 6;

const wallet = new Hono();

// ── Helpers ─────────────────────────────────────────────────────────

/** Resolve the user's single agent ID from user.agentId. Returns null if none. */
async function resolveAgentId(c: Context): Promise<number | null> {
  const session = getUserSession(c);
  const user = await userRepo.findById(session.userId);
  return user?.agentId ?? null;
}

/** Get supported networks with USDC addresses, filtered by payment chain IDs. */
function getSupportedNetworks(): Array<{
  chainId: number;
  networkId: string;
  name: string;
  usdcAddress: string;
}> {
  const chainConfig = getChainConfig();
  const results: Array<{
    chainId: number;
    networkId: string;
    name: string;
    usdcAddress: string;
  }> = [];

  for (const [networkId, config] of Object.entries(chainConfig)) {
    if (!SUPPORTED_PAYMENT_CHAIN_IDS.has(config.chainId)) continue;
    try {
      const usdcAddress = getUsdcAddress(networkId);
      results.push({
        chainId: config.chainId,
        networkId,
        name: config.chain.name,
        usdcAddress,
      });
    } catch {
      // No USDC address configured for this network — skip
    }
  }

  return results;
}

// ── GET / — wallet overview (single agent) ─────────────────────────

wallet.get("/", async (c) => {
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);
  const agent = await payAgentRepo.findById(agentId);
  if (!agent) return c.json({ error: "Agent not found" }, 404);

  // Ensure wallet exists (non-blocking — don't fail overview)
  let address = agent.address;
  if (!address) {
    try {
      address = await ensureAgentWallet(agent.id);
    } catch (err) {
      log.blockchain.warn({ err, agentId: agent.id }, "Failed to ensure wallet on overview");
    }
  }

  return ok(c, {
    balance: agent.balance,
    address: address ?? null,
    agentId: agent.id,
    name: agent.name,
  });
});

// ── GET /deposit-info — deposit addresses per network ───────────────

wallet.get("/deposit-info", async (c) => {
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);

  // Ensure wallet exists
  let address: string;
  try {
    address = await ensureAgentWallet(agentId);
  } catch (err) {
    log.blockchain.error({ err, agentId }, "Failed to ensure wallet for deposit-info");
    return c.json({ error: "Failed to generate deposit address" }, 500);
  }

  const networks = getSupportedNetworks();

  return ok(c, { address, networks });
});

// ── POST /topup — create a crypto top-up order ───────────────────────

wallet.post("/topup", async (c) => {
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);

  const parsed = await parseBody(c, createTopupRequestBody);
  if (!parsed.ok) return parsed.response;

  const { amount, network } = parsed.data;

  // Validate amount > 0
  if (!gt(amount, "0")) {
    return c.json({ error: "Amount must be greater than zero" }, 400);
  }

  // Validate network is supported
  const chainConfig = getChainConfig();
  if (!chainConfig[network]) {
    return c.json({ error: `Unsupported network: ${network}` }, 400);
  }
  if (!SUPPORTED_PAYMENT_CHAIN_IDS.has(chainConfig[network].chainId)) {
    return c.json({ error: `Network not supported for deposits: ${network}` }, 400);
  }

  // Ensure agent has a wallet address
  let toAddress: string;
  try {
    toAddress = await ensureAgentWallet(agentId);
  } catch (err) {
    log.blockchain.error({ err, agentId }, "Failed to ensure wallet for top-up");
    return c.json({ error: "Failed to generate deposit address" }, 500);
  }

  // Create the order
  const order = await topupOrderRepo.create({
    agentId,
    amount,
    network,
    toAddress,
    paymentMethod: "crypto",
  });

  // Enqueue the on-demand deposit scan
  enqueueDepositScan(order.id);

  log.blockchain.info(
    { orderId: order.id, agentId, amount, network, toAddress },
    "Crypto top-up order created, deposit scan enqueued",
  );

  return ok(c, {
    orderId: order.id,
    toAddress,
    network,
    amount,
    status: "pending",
  });
});

// ── GET /topup/:id — check top-up order status ──────────────────────

wallet.get("/topup/:id", async (c) => {
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);

  const id = Number(c.req.param("id"));
  if (!id || Number.isNaN(id)) return c.json({ error: "Invalid order ID" }, 400);

  const order = await topupOrderRepo.findByIdAndAgent(id, agentId);
  if (!order) return c.json({ error: "Order not found" }, 404);

  return ok(c, order);
});

// ── POST /deposit/verify — manual txHash verification ───────────────

wallet.post("/deposit/verify", async (c) => {
  const session = getUserSession(c);
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);
  const parsed = await parseBody(c, verifyDepositBody);
  if (!parsed.ok) return parsed.response;

  const { txHash, network } = parsed.data;

  // Validate network is supported
  const chainConfig = getChainConfig();
  if (!chainConfig[network]) {
    return c.json({ error: `Unsupported network: ${network}` }, 400);
  }
  if (!SUPPORTED_PAYMENT_CHAIN_IDS.has(chainConfig[network].chainId)) {
    return c.json({ error: `Network not supported for deposits: ${network}` }, 400);
  }

  // Dedup check
  const existing = await payAgentTransactionRepo.findByTxHash(txHash);
  if (existing) {
    return c.json({ error: "Transaction already verified" }, 409);
  }

  // Get the user's single agent address
  const agent = await payAgentRepo.findById(agentId);
  if (!agent?.address) {
    return c.json({ error: "No wallet address found for your account" }, 400);
  }
  const agentAddress = agent.address.toLowerCase();

  // Fetch transaction receipt
  let receipt: Awaited<ReturnType<ReturnType<typeof getPublicClient>["getTransactionReceipt"]>>;
  try {
    const client = getPublicClient(network);
    receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch (err) {
    log.blockchain.warn({ err, txHash, network }, "Failed to fetch transaction receipt");
    return c.json({ error: "Failed to fetch transaction receipt. Check txHash and network." }, 400);
  }

  if (receipt.status === "reverted") {
    return c.json({ error: "Transaction was reverted on-chain" }, 400);
  }

  // Parse USDC Transfer event from receipt logs
  let usdcAddress: `0x${string}`;
  try {
    usdcAddress = getUsdcAddress(network);
  } catch {
    return c.json({ error: "USDC not configured for this network" }, 400);
  }

  // ERC-20 Transfer event topic: keccak256("Transfer(address,address,uint256)")
  const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

  let amount = "0";
  let matched = false;

  for (const logEntry of receipt.logs) {
    // Match USDC contract address
    if (logEntry.address.toLowerCase() !== usdcAddress.toLowerCase()) continue;

    // Match Transfer event topic
    if (!logEntry.topics[0] || logEntry.topics[0] !== TRANSFER_TOPIC) continue;

    // topics[2] = "to" address (padded to 32 bytes)
    const toAddress = logEntry.topics[2]
      ? (`0x${logEntry.topics[2].slice(26)}` as Address).toLowerCase()
      : null;

    if (!toAddress || toAddress !== agentAddress) continue;

    // Parse amount from data (uint256)
    const rawValue = BigInt(logEntry.data);
    amount = formatUnits(rawValue, USDC_DECIMALS);
    matched = true;
    break;
  }

  if (!matched) {
    return c.json(
      { error: "No USDC transfer to your wallet address found in this transaction" },
      400,
    );
  }

  if (!gt(amount, "0")) {
    return c.json({ error: "Transfer amount is zero" }, 400);
  }

  // Credit balance
  const balanceBefore = agent.balance ?? "0";
  const credited = await payAgentRepo.creditBalance(agentId, amount);

  // Insert transaction record
  await payAgentTransactionRepo.insert({
    agentId,
    userId: session.userId,
    type: "top_up",
    amount,
    balanceBefore,
    balanceAfter: credited.balance,
    txHash,
    network,
    source: "on_chain",
    description: "Manual deposit verification",
  });

  log.blockchain.info(
    { txHash, agentId, amount, network, userId: session.userId },
    "User verified deposit",
  );

  // Auto-confirm matching pending crypto top-up order (if any)
  const pendingOrder = await topupOrderRepo.findPendingByAgentAndNetwork(agentId, network);
  if (pendingOrder && gte(amount, pendingOrder.amount)) {
    await topupOrderRepo.confirm(pendingOrder.id, { txHash });
    log.blockchain.info(
      { orderId: pendingOrder.id, agentId, txHash },
      "Pending top-up order auto-confirmed via manual verification",
    );
  }

  return ok(c, { success: true, amount, agentId });
});

// ── GET /transactions — transaction history ─────────────────────────

wallet.get("/transactions", async (c) => {
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);
  const limit = parsePaginationLimit(c.req.query("limit"), 20, 100);
  const offset = parsePaginationOffset(c.req.query("offset"));
  const type = c.req.query("type") || undefined;

  const transactions = await payAgentTransactionRepo.findFiltered({ agentId, type }, limit, offset);
  return ok(c, transactions);
});

// ── POST /withdraw — submit withdrawal request (pending admin approval) ──

wallet.post("/withdraw", async (c) => {
  const session = getUserSession(c);
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);
  const parsed = await parseBody(c, withdrawBody);
  if (!parsed.ok) return parsed.response;

  const { toAddress, withdrawAll, network } = parsed.data;

  // Validate network is supported
  const chainConfig = getChainConfig();
  if (!chainConfig[network]) {
    return c.json({ error: `Unsupported network: ${network}` }, 400);
  }
  if (!SUPPORTED_PAYMENT_CHAIN_IDS.has(chainConfig[network].chainId)) {
    return c.json({ error: `Network not supported for withdrawals: ${network}` }, 400);
  }

  // Determine amount — validate only, do NOT debit (admin will debit on approval)
  let finalAmount: string;
  if (withdrawAll) {
    const agent = await payAgentRepo.findById(agentId);
    if (!agent || !gt(agent.balance, "0")) {
      return c.json({ error: "Balance is zero" }, 400);
    }
    finalAmount = agent.balance;
  } else {
    const amount = parsed.data.amount!;
    if (!gt(amount, "0")) {
      return c.json({ error: "Amount must be greater than zero" }, 400);
    }
    // Check sufficient balance (read-only, no debit)
    const agent = await payAgentRepo.findById(agentId);
    if (!agent || !gte(agent.balance, amount)) {
      return c.json({ error: "Insufficient balance" }, 400);
    }
    finalAmount = amount;
  }

  // Create pending order — admin approval required before execution
  const order = await withdrawOrderRepo.create({
    agentId,
    userId: session.userId,
    toAddress,
    amount: finalAmount,
    network,
    status: "pending",
  });

  log.blockchain.info(
    { orderId: order.id, agentId, toAddress, amount: finalAmount, network, userId: session.userId },
    "Withdrawal request submitted, pending admin approval",
  );

  return ok(c, { orderId: order.id, status: "pending" });
});

// ── GET /withdrawals — withdrawal history ───────────────────────────

wallet.get("/withdrawals", async (c) => {
  const session = getUserSession(c);
  const limit = parsePaginationLimit(c.req.query("limit"), 20, 100);
  const offset = parsePaginationOffset(c.req.query("offset"));
  const excludeStatus = c.req.query("excludeStatus");

  const orders = await withdrawOrderRepo.findByUser(session.userId, {
    excludeStatus,
    limit,
    offset,
  });
  return ok(c, orders);
});

// ── Error handler ───────────────────────────────────────────────────

wallet.onError((err, c) => {
  log.blockchain.error({ err }, "User wallet route error");
  return c.json({ error: "Internal server error" }, 500);
});

export default wallet;
