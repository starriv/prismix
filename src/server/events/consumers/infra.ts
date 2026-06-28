/**
 * Infrastructure broadcast consumers — cross-instance invalidation
 * for gateway config and AI credential pools.
 *
 * Separated from events/index.ts to avoid circular imports
 * (gateway-config.ts imports `emit` from events).
 */
import { invalidateCredentialPool } from "@/server/ai/lib/credential-balancer";
import {
  invalidateUpstreamCache,
  invalidateUpstreamCacheForUpstream,
} from "@/server/ai/lib/upstream-routing";
import { invalidateGatewayConfig } from "@/server/lib/gateway-config";

import type { EventBus } from "../event-bus";

export function registerInfraConsumers(bus: EventBus): void {
  bus.on("config.gateway-updated", () => invalidateGatewayConfig(), "broadcast");
  bus.on(
    "ai.credential-pool-invalidated",
    (e) =>
      invalidateCredentialPool(
        e.data.endpointId as number,
        (e.data.upstreamId as number | null | undefined) ?? undefined,
      ),
    "broadcast",
  );
  bus.on(
    "ai.upstream-cache-invalidated",
    (e) => {
      if (typeof e.data.endpointId === "number") {
        invalidateUpstreamCache(e.data.endpointId);
      } else if (typeof e.data.upstreamId === "number") {
        void invalidateUpstreamCacheForUpstream(e.data.upstreamId);
      }
    },
    "broadcast",
  );
}
