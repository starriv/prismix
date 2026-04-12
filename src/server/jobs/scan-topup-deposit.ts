/**
 * On-demand deposit scan — per top-up order BullMQ job.
 *
 * When a crypto top-up order is created, a BullMQ job is enqueued.
 * The worker scans for USDC Transfer events to the order's target address.
 * If a matching deposit is found → confirm order + credit balance.
 * If not found → re-enqueue with 30s delay for the next poll.
 * Stops polling when the order is no longer pending or exceeds 24h TTL.
 */
import { Queue, Worker } from "bullmq";
import { formatUnits, parseAbiItem } from "viem";

import { chunkedGetLogs, getPublicClient, getUsdcAddress } from "@/blockchain/config";
import { log } from "@/server/lib/logger";
import { emitNotification } from "@/server/messaging/notifications";
import { payAgentRepo, payAgentTransactionRepo, topupOrderRepo } from "@/server/repos";
import { removeTailingZero, safePlus } from "@/shared/number";

const QUEUE_NAME = "deposit-scan";
const POLL_INTERVAL_MS = 30_000; // 30 seconds between polls
const LOOKBACK_BLOCKS = 200n; // initial lookback (~10 min on L2)
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — aligned with expire job
const USDC_DECIMALS = 6;

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

interface ScanJobData {
  orderId: number;
  lastScannedBlock?: number;
}

let queue: Queue | null = null;
let worker: Worker | null = null;

/** Process a single scan iteration for a top-up order. */
async function processScan(data: ScanJobData): Promise<void> {
  const { orderId, lastScannedBlock } = data;

  // 1. Load order — bail if no longer pending
  const order = await topupOrderRepo.findById(orderId);
  if (!order || order.status !== "pending") {
    log.blockchain.debug({ orderId }, "Order no longer pending, skipping scan");
    return;
  }

  // 2. Check TTL — stop polling if order is too old
  const age = Date.now() - new Date(order.createdAt).getTime();
  if (age > TTL_MS) {
    log.blockchain.debug({ orderId, ageMs: age }, "Order exceeded TTL, stopping scan");
    return;
  }

  // 3. Resolve network → client + USDC address
  const network = order.network;
  const toAddress = order.toAddress;
  if (!network || !toAddress) {
    log.blockchain.warn({ orderId }, "Order missing network or toAddress, skipping");
    return;
  }

  let client: ReturnType<typeof getPublicClient>;
  let usdcAddr: `0x${string}`;
  try {
    client = getPublicClient(network);
    usdcAddr = getUsdcAddress(network);
  } catch {
    log.blockchain.warn({ orderId, network }, "Network not configured, skipping scan");
    return;
  }

  // 4. Determine block range
  let latestBlock: bigint;
  try {
    latestBlock = await client.getBlockNumber();
  } catch (err) {
    log.blockchain.warn({ err, orderId, network }, "Failed to get block number");
    reschedule(orderId, lastScannedBlock);
    return;
  }

  const fromBlock = lastScannedBlock
    ? BigInt(lastScannedBlock) + 1n
    : latestBlock - LOOKBACK_BLOCKS;

  if (fromBlock > latestBlock) {
    // No new blocks — reschedule
    reschedule(orderId, Number(latestBlock));
    return;
  }

  // 5. Scan for Transfer events to the order's target address
  let transferLogs: unknown[];
  try {
    transferLogs = await chunkedGetLogs({
      client,
      address: usdcAddr,
      event: transferEvent as never,
      args: { to: [toAddress as `0x${string}`] },
      fromBlock,
      toBlock: latestBlock,
      limit: 10,
    });
  } catch (err) {
    log.blockchain.warn({ err, orderId, network }, "Deposit scan getLogs failed");
    reschedule(orderId, lastScannedBlock);
    return;
  }

  // 6. Check for matching deposit
  for (const rawLog of transferLogs) {
    const entry = rawLog as {
      transactionHash: string;
      args: { from: string; to: string; value: bigint };
      logIndex: number;
    };

    const amount = removeTailingZero(formatUnits(entry.args.value, USDC_DECIMALS));
    const txKey = `${entry.transactionHash}:${entry.logIndex}`;

    // Dedup — skip if this tx already recorded
    const existing = await payAgentTransactionRepo.findByTxHash(txKey);
    if (existing) continue;

    // Found a deposit — confirm the order
    const confirmed = await topupOrderRepo.confirm(orderId, { txHash: txKey });
    if (!confirmed) {
      // Order was already confirmed/expired by another path (race)
      log.blockchain.debug({ orderId, txKey }, "Order already transitioned, skipping credit");
      return;
    }

    // Credit agent balance
    const agent = await payAgentRepo.findById(order.agentId);
    if (!agent) return;

    const balanceBefore = agent.balance;
    const balanceAfter = removeTailingZero(safePlus(balanceBefore, amount));
    await payAgentRepo.creditBalance(order.agentId, amount);

    // Insert transaction record
    await payAgentTransactionRepo.insert({
      agentId: order.agentId,
      type: "top_up",
      amount,
      balanceBefore,
      balanceAfter,
      description: "USDC deposit confirmed via top-up order",
      txHash: txKey,
      network,
      source: "on_chain",
    });

    log.blockchain.info(
      { orderId, agentId: order.agentId, amount, txHash: entry.transactionHash, network },
      "Deposit confirmed for top-up order",
    );

    // Notify
    await emitNotification("topup.confirmed", {
      title: `Top-up confirmed: ${amount} USDC`,
      body: `Deposit for pay agent "${agent.name}" (${amount} USDC) has been confirmed on-chain.`,
      metadata: { orderId, agentId: order.agentId, agentName: agent.name, amount, txHash: txKey },
    });

    return; // done — do not reschedule
  }

  // 7. No matching deposit found — reschedule
  reschedule(orderId, Number(latestBlock));
}

/** Re-enqueue the scan job with a delay for the next polling iteration. */
function reschedule(orderId: number, lastScannedBlock?: number): void {
  if (!queue) return;
  queue
    .add("scan", { orderId, lastScannedBlock } satisfies ScanJobData, { delay: POLL_INTERVAL_MS })
    .catch((err) => {
      log.blockchain.error({ err, orderId }, "Failed to reschedule deposit scan");
    });
}

// ── Public API ──────────────────────────────────────────────────────

/** Enqueue a deposit scan for a newly created top-up order. */
export function enqueueDepositScan(orderId: number): void {
  if (!queue) {
    log.blockchain.warn({ orderId }, "Deposit scan queue not initialized, skipping");
    return;
  }
  queue.add("scan", { orderId } satisfies ScanJobData, { delay: 0 }).catch((err) => {
    log.blockchain.error({ err, orderId }, "Failed to enqueue deposit scan");
  });
}

/** Initialize the deposit scan BullMQ queue + worker. Call from bootstrap. */
export async function initDepositScanQueue(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.blockchain.warn("REDIS_URL not set — deposit scan queue disabled");
    return;
  }

  const connection = { url: redisUrl };

  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 1, // no auto-retry — we reschedule manually
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 },
    },
  });

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processScan(job.data as ScanJobData);
    },
    { connection, concurrency: 3 },
  );

  worker.on("failed", (job, err) => {
    log.blockchain.error(
      { queue: QUEUE_NAME, orderId: (job?.data as ScanJobData)?.orderId, err: err.message },
      "Deposit scan job failed",
    );
  });

  worker.on("error", (err) => {
    log.blockchain.error({ err, queue: QUEUE_NAME }, "Deposit scan worker error");
  });

  log.blockchain.info("Deposit scan queue initialized");
}

/** Graceful shutdown — close queue + worker. */
export async function closeDepositScanQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
