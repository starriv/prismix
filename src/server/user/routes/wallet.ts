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

import {
  ensureBlockchainConfig,
  getChainConfig,
  getPublicClient,
  getUsdcAddress,
} from "@/blockchain/config";
import type { TopUpOrder } from "@/server/db";
import { enqueueDepositScan } from "@/server/jobs/scan-topup-deposit";
import {
  createTopupRequestBody,
  submitFiatTopupProofBody,
  verifyDepositBody,
  withdrawBody,
} from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody, parsePaginationLimit, parsePaginationOffset } from "@/server/lib/validate";
import { ensureAgentWallet } from "@/server/lib/wallet";
import { getUserSession } from "@/server/middleware/auth";
import {
  fiatConfigRepo,
  networkRepo,
  payAgentRepo,
  payAgentTransactionRepo,
  topupOrderRepo,
  userRepo,
  withdrawOrderRepo,
} from "@/server/repos";
import { SUPPORTED_PAYMENT_CHAIN_IDS } from "@/shared/circle-networks";
import { DEFAULT_CURRENCY_BY_METHOD, parseFiatConfigCurrency } from "@/shared/number";
import { gt, gte, removeTailingZero, safePlus } from "@/shared/number";
import { MIN_TOPUP_AMOUNT, SETTLEMENT_DECIMALS } from "@/shared/tokens";

const TOPUP_EXPIRES_IN_MS = 60 * 60 * 1000;

const wallet = new Hono();

// ── Helpers ─────────────────────────────────────────────────────────

/** Resolve the user's single agent ID from user.agentId. Returns null if none. */
async function resolveAgentId(c: Context): Promise<number | null> {
  const session = getUserSession(c);
  const user = await userRepo.findById(session.userId);
  return user?.agentId ?? null;
}

/** Get supported networks with USDC addresses, filtered by payment chain IDs. */
async function getSupportedNetworks(): Promise<
  Array<{
    chainId: number;
    networkId: string;
    name: string;
    usdcAddress: string;
  }>
> {
  const networks = await networkRepo.findEnabledUsdcDepositNetworks();
  return networks
    .filter((network) => SUPPORTED_PAYMENT_CHAIN_IDS.has(network.chainId))
    .map((network) => ({
      chainId: network.chainId,
      networkId: network.networkId,
      name: network.name,
      usdcAddress: network.usdcAddress,
    }));
}

function getTopupExpiresAt(order: TopUpOrder): string | null {
  if (order.type !== "crypto") return null;
  return new Date(new Date(order.createdAt).getTime() + TOPUP_EXPIRES_IN_MS).toISOString();
}

/** Serialize a single order — use for detail endpoints only. */
async function serializeTopupOrder(order: TopUpOrder, includeFiatConfig = false) {
  const fiatConfig =
    includeFiatConfig && order.type === "fiat" && order.fiatConfigId
      ? await fiatConfigRepo.findById(order.fiatConfigId)
      : null;

  return {
    ...order,
    fiatConfig,
    expiresAt: getTopupExpiresAt(order),
  };
}

const getFiatConfigCurrency = parseFiatConfigCurrency;

/** Batch-serialize a list of orders — single query for all fiat configs to avoid N+1. */
async function serializeTopupOrders(orders: TopUpOrder[]) {
  return orders.map((order) => ({
    ...order,
    fiatConfig: null,
    expiresAt: getTopupExpiresAt(order),
  }));
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

  const networks = await getSupportedNetworks();

  return ok(c, { address, networks });
});

wallet.get("/fiat-configs", async (c) => {
  return ok(c, await fiatConfigRepo.findAllEnabled());
});

// ── POST /topup — create a crypto top-up order ───────────────────────

wallet.post("/topup", async (c) => {
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);

  const parsed = await parseBody(c, createTopupRequestBody);
  if (!parsed.ok) return parsed.response;

  const { amount } = parsed.data;

  // Validate amount > 0
  if (!gt(amount, "0")) {
    return c.json({ error: "Amount must be greater than zero" }, 400);
  }
  if (parsed.data.type === "crypto" && !gte(amount, MIN_TOPUP_AMOUNT)) {
    return c.json({ error: `Minimum deposit amount is ${MIN_TOPUP_AMOUNT} USDC` }, 400);
  }

  const pendingOrder = await topupOrderRepo.findLatestPendingByAgent(agentId);
  if (pendingOrder) {
    return c.json(
      {
        error: "You already have a pending deposit order. Complete or wait for it to expire first.",
        orderId: pendingOrder.id,
      },
      409,
    );
  }

  let order;
  if (parsed.data.type === "crypto") {
    const { network } = parsed.data;
    await ensureBlockchainConfig();

    const chainConfig = getChainConfig();
    if (!chainConfig[network]) {
      return c.json({ error: `Unsupported network: ${network}` }, 400);
    }
    if (!SUPPORTED_PAYMENT_CHAIN_IDS.has(chainConfig[network].chainId)) {
      return c.json({ error: `Network not supported for deposits: ${network}` }, 400);
    }

    let toAddress: string;
    try {
      toAddress = await ensureAgentWallet(agentId);
    } catch (err) {
      log.blockchain.error({ err, agentId }, "Failed to ensure wallet for top-up");
      return c.json({ error: "Failed to generate deposit address" }, 500);
    }

    order = await topupOrderRepo.create({
      agentId,
      amount,
      type: "crypto",
      network,
      toAddress,
      paymentMethod: "crypto",
    });

    let startBlock: number | undefined;
    try {
      startBlock = Number((await getPublicClient(network).getBlockNumber()) + 1n);
    } catch (err) {
      log.blockchain.warn(
        { err, network, orderId: order.id },
        "Failed to capture top-up start block",
      );
    }

    enqueueDepositScan(order.id, startBlock);

    log.blockchain.info(
      { orderId: order.id, agentId, amount, network, toAddress },
      "Crypto top-up order created, deposit scan enqueued",
    );
  } else {
    const config = await fiatConfigRepo.findById(parsed.data.fiatConfigId);
    if (!config || !config.enabled) {
      return c.json({ error: "Fiat payment method is unavailable" }, 400);
    }

    order = await topupOrderRepo.create({
      agentId,
      amount,
      type: "fiat",
      fiatConfigId: config.id,
      fiatCurrency:
        parsed.data.fiatCurrency ??
        getFiatConfigCurrency(config.config) ??
        DEFAULT_CURRENCY_BY_METHOD[config.method] ??
        "USD",
      paymentMethod: config.method,
    });

    log.blockchain.info(
      { orderId: order.id, agentId, amount, fiatConfigId: config.id, paymentMethod: config.method },
      "Fiat top-up order created, pending admin review",
    );
  }

  return ok(c, await serializeTopupOrder(order));
});

// ── GET /topup/:id — check top-up order status ──────────────────────

wallet.get("/topup/:id", async (c) => {
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);

  const id = Number(c.req.param("id"));
  if (!id || Number.isNaN(id)) return c.json({ error: "Invalid order ID" }, 400);

  const order = await topupOrderRepo.findByIdAndAgent(id, agentId);
  if (!order) return c.json({ error: "Order not found" }, 404);

  return ok(c, await serializeTopupOrder(order, true));
});

wallet.put("/topup/:id/proof", async (c) => {
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);

  const id = Number(c.req.param("id"));
  if (!id || Number.isNaN(id)) return c.json({ error: "Invalid order ID" }, 400);

  const parsed = await parseBody(c, submitFiatTopupProofBody);
  if (!parsed.ok) return parsed.response;

  const order = await topupOrderRepo.updatePaymentProof(
    id,
    agentId,
    parsed.data.paymentProof.trim(),
  );
  if (!order) return c.json({ error: "Fiat top-up order not found or already processed" }, 404);

  return ok(c, await serializeTopupOrder(order, true));
});

wallet.get("/topup", async (c) => {
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);

  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));
  const status = c.req.query("status") || undefined;

  const [orders, total] = await Promise.all([
    topupOrderRepo.findByAgent(agentId, { status, limit, offset }),
    topupOrderRepo.countByAgent(agentId, status),
  ]);

  return ok(c, {
    items: await serializeTopupOrders(orders),
    total,
  });
});

// ── POST /deposit/verify — manual txHash verification ───────────────

wallet.post("/deposit/verify", async (c) => {
  const session = getUserSession(c);
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);
  const parsed = await parseBody(c, verifyDepositBody);
  if (!parsed.ok) return parsed.response;

  const { txHash, network } = parsed.data;
  await ensureBlockchainConfig();

  // Validate network is supported
  const chainConfig = getChainConfig();
  if (!chainConfig[network]) {
    return c.json({ error: `Unsupported network: ${network}` }, 400);
  }
  if (!SUPPORTED_PAYMENT_CHAIN_IDS.has(chainConfig[network].chainId)) {
    return c.json({ error: `Network not supported for deposits: ${network}` }, 400);
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

  const matchedTransfers: Array<{ amount: string; txKey: string }> = [];

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
    matchedTransfers.push({
      amount: removeTailingZero(formatUnits(rawValue, SETTLEMENT_DECIMALS)),
      txKey: `${txHash}:${logEntry.logIndex ?? 0}`,
    });
  }

  if (matchedTransfers.length === 0) {
    return c.json(
      { error: "No USDC transfer to your wallet address found in this transaction" },
      400,
    );
  }

  const existing = await payAgentTransactionRepo.findByTxHashes([
    txHash,
    ...matchedTransfers.map((entry) => entry.txKey),
  ]);
  const existingKeys = new Set(existing.map((entry) => entry.txHash).filter(Boolean));
  const newTransfers = matchedTransfers.filter(
    (entry) => !existingKeys.has(txHash) && !existingKeys.has(entry.txKey),
  );

  if (newTransfers.length === 0) {
    return c.json({ error: "Transaction already verified" }, 409);
  }

  let amount = "0";
  for (const entry of newTransfers) {
    amount = removeTailingZero(safePlus(amount, entry.amount));
  }

  if (!gt(amount, "0")) {
    return c.json({ error: "Transfer amount is zero" }, 400);
  }

  // Credit balance
  const balanceBefore = agent.balance ?? "0";
  await payAgentRepo.creditBalance(agentId, amount);

  let runningBalanceBefore = balanceBefore;
  for (const entry of newTransfers) {
    const balanceAfter = removeTailingZero(safePlus(runningBalanceBefore, entry.amount));
    await payAgentTransactionRepo.insert({
      agentId,
      userId: session.userId,
      type: "top_up",
      amount: entry.amount,
      balanceBefore: runningBalanceBefore,
      balanceAfter,
      txHash: entry.txKey,
      network,
      source: "on_chain",
      description: "Manual deposit verification",
    });
    runningBalanceBefore = balanceAfter;
  }

  log.blockchain.info(
    {
      txHash,
      agentId,
      amount,
      network,
      userId: session.userId,
      transferCount: newTransfers.length,
    },
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
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));
  const type = c.req.query("type") || undefined;

  const filters = { agentId, type };
  const [transactions, total] = await Promise.all([
    payAgentTransactionRepo.findFiltered(filters, limit, offset),
    payAgentTransactionRepo.countFiltered(filters),
  ]);

  return ok(c, { items: transactions, total });
});

// ── POST /withdraw — submit withdrawal request (pending admin approval) ──

wallet.post("/withdraw", async (c) => {
  const session = getUserSession(c);
  const agentId = await resolveAgentId(c);
  if (!agentId) return c.json({ error: "No wallet found for this account" }, 404);
  const parsed = await parseBody(c, withdrawBody);
  if (!parsed.ok) return parsed.response;

  let finalAmount: string;
  if (parsed.data.type === "crypto" && parsed.data.withdrawAll) {
    const agent = await payAgentRepo.findById(agentId);
    if (!agent || !gt(agent.balance, "0")) return c.json({ error: "Balance is zero" }, 400);
    finalAmount = agent.balance;
  } else {
    const amount = parsed.data.amount;
    if (!amount) return c.json({ error: "Amount is required" }, 400);
    if (!gt(amount, "0")) {
      return c.json({ error: "Amount must be greater than zero" }, 400);
    }
    const agent = await payAgentRepo.findById(agentId);
    if (!agent || !gte(agent.balance, amount)) {
      return c.json({ error: "Insufficient balance" }, 400);
    }
    finalAmount = amount;
  }

  let order;
  if (parsed.data.type === "crypto") {
    const { toAddress, network } = parsed.data;
    await ensureBlockchainConfig();

    const chainConfig = getChainConfig();
    if (!chainConfig[network]) {
      return c.json({ error: `Unsupported network: ${network}` }, 400);
    }
    if (!SUPPORTED_PAYMENT_CHAIN_IDS.has(chainConfig[network].chainId)) {
      return c.json({ error: `Network not supported for withdrawals: ${network}` }, 400);
    }

    order = await withdrawOrderRepo.create({
      agentId,
      userId: session.userId,
      type: "crypto",
      toAddress,
      amount: finalAmount,
      network,
      status: "pending",
    });

    log.blockchain.info(
      {
        orderId: order.id,
        agentId,
        toAddress,
        amount: finalAmount,
        network,
        userId: session.userId,
      },
      "Withdrawal request submitted, pending admin approval",
    );
  } else {
    order = await withdrawOrderRepo.create({
      agentId,
      userId: session.userId,
      type: "fiat",
      paymentMethod: parsed.data.paymentMethod,
      toAddress: parsed.data.payoutInfo,
      userNote: parsed.data.note?.trim() || null,
      amount: finalAmount,
      status: "pending",
    });

    log.blockchain.info(
      {
        orderId: order.id,
        agentId,
        amount: finalAmount,
        paymentMethod: parsed.data.paymentMethod,
        userId: session.userId,
      },
      "Fiat withdrawal request submitted, pending admin approval",
    );
  }

  return ok(c, { orderId: order.id, status: "pending" });
});

// ── GET /withdrawals — withdrawal history ───────────────────────────

wallet.get("/withdrawals", async (c) => {
  const session = getUserSession(c);
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));
  const excludeStatus = c.req.query("excludeStatus");

  const [orders, total] = await Promise.all([
    withdrawOrderRepo.findByUser(session.userId, {
      excludeStatus,
      limit,
      offset,
    }),
    withdrawOrderRepo.countByUser(session.userId, excludeStatus),
  ]);

  return ok(c, { items: orders, total });
});

// ── Error handler ───────────────────────────────────────────────────

wallet.onError((err, c) => {
  log.blockchain.error({ err }, "User wallet route error");
  return c.json({ error: "Internal server error" }, 500);
});

export default wallet;
