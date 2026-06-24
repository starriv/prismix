/**
 * Periodic job: expire stale top-up orders.
 *
 * Runs every 10 minutes, marks pending orders older than 24h as expired,
 * and emits domain events for each expired order.
 */
import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
import { log } from "@/server/lib/logger";
import { payAgentRepo, topupOrderRepo } from "@/server/repos";

import { TOPUP_SCAN_TTL_MS } from "./scan-topup-deposit";

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const TTL_MS = TOPUP_SCAN_TTL_MS;

let timer: ReturnType<typeof setInterval> | null = null;

async function run() {
  try {
    const cutoff = Date.now() - TTL_MS;
    const expired = await topupOrderRepo.expirePending(cutoff);
    if (expired.length === 0) return;

    log.gateway.info({ count: expired.length }, "Expired stale top-up orders");

    for (const order of expired) {
      const agent = await payAgentRepo.findById(order.agentId);
      emit(DOMAIN_EVENT_TYPES.TOPUP_EXPIRED, `agent:${order.agentId}`, {
        orderId: order.id,
        agentId: order.agentId,
        agentName: agent?.name,
        amount: order.amount,
      });
    }
  } catch (err) {
    log.gateway.error({ err }, "Failed to expire top-up orders");
  }
}

/** Start the periodic expiry job. Call once from bootstrap. */
export function initTopupExpiryJob(): void {
  // Run once immediately to clean up any stale orders from previous shutdown
  run();
  timer = setInterval(run, INTERVAL_MS);
  log.gateway.info({ intervalMs: INTERVAL_MS, ttlMs: TTL_MS }, "Top-up expiry job started");
}

/** Stop the periodic expiry job. Call on graceful shutdown. */
export function stopTopupExpiryJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
