/**
 * Periodic job: sync pay agent on-chain USDC balances and Transfer events.
 *
 * Runs every 2 minutes. For each active agent:
 * 1. Reads on-chain USDC balance → updates DB if different
 * 2. Scans Transfer events since lastSyncBlock → inserts new pay_agent_transactions
 * 3. Updates lastSyncBlock cursor
 */
import { groupBy } from "lodash-es";
import { formatUnits, parseAbiItem } from "viem";

import { chunkedGetLogs, getPublicClient, getUsdcAddress, USDC_ABI } from "@/blockchain/config";
import type { PayAgent } from "@/server/db";
import { log } from "@/server/lib/logger";
import { payAgentRepo, payAgentTransactionRepo, settingsRepo } from "@/server/repos";
import { removeTailingZero } from "@/shared/number";

const LOOKBACK_BLOCKS = 50_000n; // max blocks to scan on first sync
const USDC_DECIMALS = 6; // USDC is always 6 decimals — skip on-chain decimals() call
const SYNC_CONCURRENCY = 5; // max parallel event scans per network

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/** Get the default network from global settings. */
async function getDefaultNetwork(): Promise<string> {
  const network = await settingsRepo.getGlobal("default_network");
  return network || "eip155:84532";
}

export async function syncAgent(agentId: number, agentAddress: string, lastSyncBlock: number) {
  const networkId = await getDefaultNetwork();

  let client: ReturnType<typeof getPublicClient>;
  let usdcAddr: `0x${string}`;
  try {
    client = getPublicClient(networkId);
    usdcAddr = getUsdcAddress(networkId);
  } catch {
    // Network not configured — skip
    return;
  }

  const addr = agentAddress as `0x${string}`;

  // 1. Read on-chain balance
  try {
    const rawBalance = await client.readContract({
      address: usdcAddr,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [addr],
    });
    const decimals = await client.readContract({
      address: usdcAddr,
      abi: USDC_ABI,
      functionName: "decimals",
    });
    const onChainBalance = removeTailingZero(formatUnits(rawBalance as bigint, Number(decimals)));
    await payAgentRepo.setBalance(agentId, onChainBalance);
  } catch (err) {
    log.blockchain.warn({ err, agentId }, "Failed to read on-chain balance for agent");
  }

  // 2. Scan Transfer events
  try {
    const latestBlock = await client.getBlockNumber();
    const fromBlock =
      lastSyncBlock > 0 ? BigInt(lastSyncBlock) + 1n : latestBlock - LOOKBACK_BLOCKS;
    if (fromBlock > latestBlock) {
      return; // nothing new
    }

    // Incoming transfers (to = agent address)
    const incomingLogs = await chunkedGetLogs({
      client,
      address: usdcAddr,
      event: transferEvent as never,
      args: { to: addr },
      fromBlock,
      toBlock: latestBlock,
      limit: 100,
    });

    // Outgoing transfers (from = agent address)
    const outgoingLogs = await chunkedGetLogs({
      client,
      address: usdcAddr,
      event: transferEvent as never,
      args: { from: addr },
      fromBlock,
      toBlock: latestBlock,
      limit: 100,
    });

    const agent = await payAgentRepo.findById(agentId);
    if (!agent) return;

    // Process incoming (top_up)
    for (const rawLog of incomingLogs) {
      const entry = rawLog as {
        transactionHash: string;
        args: { value: bigint };
        logIndex: number;
      };
      const txKey = `${entry.transactionHash}:${entry.logIndex}`;
      // Dedup by txHash — use txHash:logIndex composite as unique key
      const existing = await payAgentTransactionRepo.findByTxHash(txKey);
      if (existing) continue;

      const decimals = 6; // USDC
      const amount = removeTailingZero(formatUnits(entry.args.value, decimals));

      await payAgentTransactionRepo.insert({
        agentId,
        type: "top_up",
        amount,
        balanceBefore: agent.balance,
        balanceAfter: agent.balance, // will be corrected by balance sync
        description: `On-chain transfer received`,
        txHash: txKey,
        network: networkId,
        source: "on_chain",
      });
    }

    // Process outgoing (payment)
    for (const rawLog of outgoingLogs) {
      const entry = rawLog as {
        transactionHash: string;
        args: { value: bigint };
        logIndex: number;
      };
      const txKey = `${entry.transactionHash}:${entry.logIndex}`;
      const existing = await payAgentTransactionRepo.findByTxHash(txKey);
      if (existing) continue;

      const decimals = 6;
      const amount = removeTailingZero(formatUnits(entry.args.value, decimals));

      await payAgentTransactionRepo.insert({
        agentId,
        type: "payment",
        amount,
        balanceBefore: agent.balance,
        balanceAfter: agent.balance,
        description: `On-chain transfer sent`,
        txHash: txKey,
        network: networkId,
        source: "on_chain",
      });
    }

    // 3. Update sync cursor
    await payAgentRepo.updateLastSyncBlock(agentId, Number(latestBlock));

    const total = incomingLogs.length + outgoingLogs.length;
    if (total > 0) {
      log.blockchain.info(
        { agentId, incoming: incomingLogs.length, outgoing: outgoingLogs.length },
        "Synced on-chain transfers for agent",
      );
    }
  } catch (err) {
    log.blockchain.warn({ err, agentId }, "Failed to scan Transfer events for agent");
  }
}

// ── High-performance batch sync ──────────────────────────────────────────
// Uses multicall for balances, parallel event scanning.

/**
 * Batch sync all agents (or a list of agents).
 * Returns { synced: number; failed: number; errors: string[] }.
 */
/** Agents passed to batch sync MUST have a non-null address (callers filter ledger agents). */
type SyncableAgent = Omit<Pick<PayAgent, "id" | "address" | "lastSyncBlock">, "address"> & {
  address: string;
};

export async function syncAgentsBatch(
  agents: SyncableAgent[],
): Promise<{ synced: number; failed: number; errors: string[] }> {
  if (agents.length === 0) return { synced: 0, failed: 0, errors: [] };

  const errors: string[] = [];
  let synced = 0;
  let failed = 0;

  // Use a single default network for all agents
  const networkId = await getDefaultNetwork();

  // Group agents by network (currently all same network, but ready for future extension)
  const agentNetworks = new Map<number, string>();
  for (const agent of agents) {
    agentNetworks.set(agent.id, networkId);
  }

  const byNetwork = groupBy(agents, (a) => agentNetworks.get(a.id)!);

  // Process each network group in parallel
  const networkTasks = Object.entries(byNetwork).map(async ([netId, networkAgents]) => {
    let client: ReturnType<typeof getPublicClient>;
    let usdcAddr: `0x${string}`;
    try {
      client = getPublicClient(netId);
      usdcAddr = getUsdcAddress(netId);
    } catch {
      const msg = `Network ${netId} not configured, skipping ${networkAgents.length} agents`;
      errors.push(msg);
      failed += networkAgents.length;
      return;
    }

    // ── Step 1: Multicall balanceOf for all agents (single RPC call) ──
    try {
      const balanceCalls = networkAgents.map((a) => ({
        address: usdcAddr,
        abi: USDC_ABI,
        functionName: "balanceOf" as const,
        args: [a.address as `0x${string}`],
      }));

      const balanceResults = await client.multicall({ contracts: balanceCalls });

      // Update balances in DB (parallel DB writes)
      await Promise.all(
        balanceResults.map(async (result, i) => {
          if (result.status === "success") {
            const balance = removeTailingZero(formatUnits(result.result as bigint, USDC_DECIMALS));
            await payAgentRepo.setBalance(networkAgents[i].id, balance);
          }
        }),
      );
    } catch (err) {
      log.blockchain.warn(
        { err, networkId: netId },
        "Multicall balanceOf failed, falling back to per-agent",
      );
      // Fallback: per-agent balance read
      for (const agent of networkAgents) {
        try {
          const raw = await client.readContract({
            address: usdcAddr,
            abi: USDC_ABI,
            functionName: "balanceOf",
            args: [agent.address as `0x${string}`],
          });
          const balance = removeTailingZero(formatUnits(raw as bigint, USDC_DECIMALS));
          await payAgentRepo.setBalance(agent.id, balance);
        } catch {
          // silently continue — event scan may still succeed
        }
      }
    }

    // ── Step 2: Get latestBlock once per network ──
    let latestBlock: bigint;
    try {
      latestBlock = await client.getBlockNumber();
    } catch (err) {
      const msg = `Failed to get block number for ${netId}`;
      log.blockchain.warn({ err, networkId: netId }, msg);
      errors.push(msg);
      failed += networkAgents.length;
      return;
    }

    // ── Step 3: Parallel event scanning with concurrency limit ──
    const scanAgent = async (agent: (typeof networkAgents)[0]) => {
      try {
        await syncAgentEvents(client, usdcAddr, netId, agent, latestBlock);
        synced++;
      } catch (err) {
        const msg = `Sync failed for agent #${agent.id}: ${err instanceof Error ? err.message : String(err)}`;
        log.blockchain.warn({ err, agentId: agent.id }, "Batch sync: agent event scan failed");
        errors.push(msg);
        failed++;
      }
    };

    // Process in batches of SYNC_CONCURRENCY
    for (let i = 0; i < networkAgents.length; i += SYNC_CONCURRENCY) {
      const batch = networkAgents.slice(i, i + SYNC_CONCURRENCY);
      await Promise.allSettled(batch.map(scanAgent));
    }
  });

  await Promise.allSettled(networkTasks);

  return { synced, failed, errors };
}

/** Scan Transfer events for a single agent (used by batch sync). */
async function syncAgentEvents(
  client: ReturnType<typeof getPublicClient>,
  usdcAddr: `0x${string}`,
  networkId: string,
  agent: SyncableAgent,
  latestBlock: bigint,
) {
  const addr = agent.address as `0x${string}`;
  const fromBlock =
    agent.lastSyncBlock > 0 ? BigInt(agent.lastSyncBlock) + 1n : latestBlock - LOOKBACK_BLOCKS;
  if (fromBlock > latestBlock) return;

  // Parallel incoming + outgoing scans
  const [incomingLogs, outgoingLogs] = await Promise.all([
    chunkedGetLogs({
      client,
      address: usdcAddr,
      event: transferEvent as never,
      args: { to: addr },
      fromBlock,
      toBlock: latestBlock,
      limit: 100,
    }),
    chunkedGetLogs({
      client,
      address: usdcAddr,
      event: transferEvent as never,
      args: { from: addr },
      fromBlock,
      toBlock: latestBlock,
      limit: 100,
    }),
  ]);

  const agentFull = await payAgentRepo.findById(agent.id);
  if (!agentFull) return;

  // Insert incoming (top_up)
  for (const rawLog of incomingLogs) {
    const entry = rawLog as { transactionHash: string; args: { value: bigint }; logIndex: number };
    const txKey = `${entry.transactionHash}:${entry.logIndex}`;
    const existing = await payAgentTransactionRepo.findByTxHash(txKey);
    if (existing) continue;
    const amount = removeTailingZero(formatUnits(entry.args.value, USDC_DECIMALS));
    await payAgentTransactionRepo.insert({
      agentId: agent.id,
      type: "top_up",
      amount,
      balanceBefore: agentFull.balance,
      balanceAfter: agentFull.balance,
      description: "On-chain transfer received",
      txHash: txKey,
      network: networkId,
      source: "on_chain",
    });
  }

  // Insert outgoing (payment)
  for (const rawLog of outgoingLogs) {
    const entry = rawLog as { transactionHash: string; args: { value: bigint }; logIndex: number };
    const txKey = `${entry.transactionHash}:${entry.logIndex}`;
    const existing = await payAgentTransactionRepo.findByTxHash(txKey);
    if (existing) continue;
    const amount = removeTailingZero(formatUnits(entry.args.value, USDC_DECIMALS));
    await payAgentTransactionRepo.insert({
      agentId: agent.id,
      type: "payment",
      amount,
      balanceBefore: agentFull.balance,
      balanceAfter: agentFull.balance,
      description: "On-chain transfer sent",
      txHash: txKey,
      network: networkId,
      source: "on_chain",
    });
  }

  // Update sync cursor
  await payAgentRepo.updateLastSyncBlock(agent.id, Number(latestBlock));

  const total = incomingLogs.length + outgoingLogs.length;
  if (total > 0) {
    log.blockchain.info(
      { agentId: agent.id, incoming: incomingLogs.length, outgoing: outgoingLogs.length },
      "Batch sync: on-chain transfers synced",
    );
  }
}

// NOTE: Automatic periodic sync has been removed.
// On-chain balance sync is now manual-only (via /:id/sync and /sync-all endpoints).
// This prevents the sync job from overwriting ledger-managed balances.
