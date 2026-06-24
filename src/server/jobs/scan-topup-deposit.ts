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
import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
import { log } from "@/server/lib/logger";
import { payAgentRepo, payAgentTransactionRepo, topupOrderRepo } from "@/server/repos";
import { removeTailingZero, safePlus } from "@/shared/number";

const QUEUE_NAME = "deposit-scan";
const LOOKBACK_BLOCKS = 200n; // initial lookback (~10 min on L2)
export const TOPUP_SCAN_TTL_MS = 60 * 60 * 1000; // 1 hour — keep PAYG polling bounded
const USDC_DECIMALS = 6;

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

interface ScanJobData {
  orderId: number;
  startBlock?: number;
  lastScannedBlock?: number;
}

let queue: Queue | null = null;
let worker: Worker | null = null;

/** Process a single scan iteration for a top-up order. */
async function processScan(data: ScanJobData): Promise<void> {
  const { orderId, startBlock, lastScannedBlock } = data;

  // 1. Load order — bail if no longer pending
  const order = await topupOrderRepo.findById(orderId);
  if (!order || order.status !== "pending") {
    log.blockchain.debug({ orderId }, "Order no longer pending, skipping scan");
    return;
  }

  // 2. Check TTL — stop polling if order is too old
  const age = Date.now() - new Date(order.createdAt).getTime();
  if (age > TOPUP_SCAN_TTL_MS) {
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
    reschedule(orderId, lastScannedBlock, age);
    return;
  }

  const fromBlock = lastScannedBlock
    ? BigInt(lastScannedBlock) + 1n
    : BigInt(startBlock ?? Number(latestBlock - LOOKBACK_BLOCKS));

  if (fromBlock > latestBlock) {
    // No new blocks — reschedule
    reschedule(orderId, Number(latestBlock), age);
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
    reschedule(orderId, lastScannedBlock, age);
    return;
  }

  const matchedLogs = transferLogs.map((rawLog) => {
    const entry = rawLog as {
      transactionHash: string;
      args: { from: string; to: string; value: bigint };
      logIndex: number;
    };

    return {
      amount: removeTailingZero(formatUnits(entry.args.value, USDC_DECIMALS)),
      transactionHash: entry.transactionHash,
      txKey: `${entry.transactionHash}:${entry.logIndex}`,
    };
  });

  const existing = await payAgentTransactionRepo.findByTxHashes([
    ...matchedLogs.map((entry) => entry.txKey),
    ...matchedLogs.map((entry) => entry.transactionHash),
  ]);
  const existingKeys = new Set(existing.map((entry) => entry.txHash).filter(Boolean));
  const newLogs = matchedLogs.filter(
    (entry) => !existingKeys.has(entry.txKey) && !existingKeys.has(entry.transactionHash),
  );

  if (newLogs.length > 0) {
    const firstTxKey = newLogs[0]!.txKey;

    // Found a deposit — confirm the order
    const confirmed = await topupOrderRepo.confirm(orderId, { txHash: firstTxKey });
    if (!confirmed) {
      // Order was already confirmed/expired by another path (race)
      log.blockchain.debug(
        { orderId, txKey: firstTxKey },
        "Order already transitioned, skipping credit",
      );
      return;
    }

    // Credit agent balance
    const agent = await payAgentRepo.findById(order.agentId);
    if (!agent) return;

    let runningBalanceBefore = agent.balance;
    let totalAmount = "0";

    for (const entry of newLogs) {
      const balanceAfter = removeTailingZero(safePlus(runningBalanceBefore, entry.amount));
      await payAgentTransactionRepo.insert({
        agentId: order.agentId,
        type: "top_up",
        amount: entry.amount,
        balanceBefore: runningBalanceBefore,
        balanceAfter,
        description: "USDC deposit confirmed via top-up order",
        txHash: entry.txKey,
        network,
        source: "on_chain",
      });
      runningBalanceBefore = balanceAfter;
      totalAmount = removeTailingZero(safePlus(totalAmount, entry.amount));
    }

    await payAgentRepo.creditBalance(order.agentId, totalAmount);

    log.blockchain.info(
      {
        orderId,
        agentId: order.agentId,
        amount: totalAmount,
        txHashes: newLogs.map((entry) => entry.txKey),
        network,
      },
      "Deposit confirmed for top-up order",
    );

    emit(DOMAIN_EVENT_TYPES.TOPUP_CONFIRMED, `agent:${order.agentId}`, {
      orderId,
      agentId: order.agentId,
      agentName: agent.name,
      amount: totalAmount,
      txHash: firstTxKey,
    });

    return; // done — do not reschedule
  }

  // 7. No matching deposit found — reschedule
  reschedule(orderId, Number(latestBlock), age);
}

/** Re-enqueue the scan job with a delay for the next polling iteration. */
function getPollIntervalMs(ageMs: number): number {
  if (ageMs < 3 * 60 * 1000) return 20_000; // first 3 min: near-real-time
  if (ageMs < 15 * 60 * 1000) return 60_000; // next 12 min: 1 min cadence
  return 5 * 60 * 1000; // remaining hour: low-cost background scan
}

function reschedule(orderId: number, lastScannedBlock?: number, ageMs = 0): void {
  if (!queue) return;
  const delay = getPollIntervalMs(ageMs);
  queue.add("scan", { orderId, lastScannedBlock } satisfies ScanJobData, { delay }).catch((err) => {
    log.blockchain.error({ err, orderId }, "Failed to reschedule deposit scan");
  });
}

// ── Public API ──────────────────────────────────────────────────────

/** Enqueue a deposit scan for a newly created top-up order. */
export function enqueueDepositScan(orderId: number, startBlock?: number): void {
  if (!queue) {
    log.blockchain.warn({ orderId }, "Deposit scan queue not initialized, skipping");
    return;
  }
  queue.add("scan", { orderId, startBlock } satisfies ScanJobData, { delay: 0 }).catch((err) => {
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
