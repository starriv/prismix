/**
 * Infrastructure broadcast consumers — cross-instance invalidation
 * for gateway config and AI key pools.
 *
 * Separated from events/index.ts to avoid circular imports
 * (gateway-config.ts imports `emit` from events).
 */
import { invalidateKeyPool } from "@/server/ai/lib/key-balancer";
import { invalidateGatewayConfig } from "@/server/lib/gateway-config";

import type { EventBus } from "../event-bus";

export function registerInfraConsumers(bus: EventBus): void {
  bus.on("config.gateway-updated", () => invalidateGatewayConfig(), "broadcast");
  bus.on(
    "ai.key-pool-invalidated",
    (e) => invalidateKeyPool(e.data.providerId as number),
    "broadcast",
  );
}
