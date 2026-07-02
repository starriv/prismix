export type AiLogRouteType = "chat" | "passthrough";
export type AiLogCacheStatus = "hit" | "miss" | "bypass" | "disabled";

export interface AiLogPerformanceMetrics {
  routeType?: AiLogRouteType | null;
  isStream?: boolean | null;
  cacheStatus?: AiLogCacheStatus | null;
  cacheLookupMs?: number | null;
  cacheWriteMs?: number | null;
  routingMs?: number | null;
  queueWaitMs?: number | null;
  upstreamTtfbMs?: number | null;
  upstreamBodyMs?: number | null;
  transformMs?: number | null;
  billingMs?: number | null;
  firstChunkMs?: number | null;
  firstTokenMs?: number | null;
  tokensPerSecond?: number | null;
  requestBytes?: number | null;
  responseBytes?: number | null;
  streamChunks?: number | null;
  streamBytes?: number | null;
  streamPingCount?: number | null;
  streamAbortReason?: string | null;
  attemptCount?: number | null;
  retryCount?: number | null;
}

const INTEGER_FIELDS = new Set<keyof AiLogPerformanceMetrics>([
  "cacheLookupMs",
  "cacheWriteMs",
  "routingMs",
  "queueWaitMs",
  "upstreamTtfbMs",
  "upstreamBodyMs",
  "transformMs",
  "billingMs",
  "firstChunkMs",
  "firstTokenMs",
  "requestBytes",
  "responseBytes",
  "streamChunks",
  "streamBytes",
  "streamPingCount",
  "attemptCount",
  "retryCount",
]);

export function probeNow(): number {
  return performance.now();
}

export function elapsedMs(start: number, end = probeNow()): number {
  return Math.max(0, Math.round(end - start));
}

export function byteLength(value: string | null | undefined): number | null {
  if (value == null) return null;
  return Buffer.byteLength(value, "utf8");
}

export function sanitizePerformanceMetrics(
  metrics?: AiLogPerformanceMetrics | null,
): AiLogPerformanceMetrics {
  if (!metrics) return {};

  const sanitized: AiLogPerformanceMetrics = {};
  for (const [key, value] of Object.entries(metrics) as Array<
    [keyof AiLogPerformanceMetrics, AiLogPerformanceMetrics[keyof AiLogPerformanceMetrics]]
  >) {
    if (value == null) continue;
    if (INTEGER_FIELDS.has(key)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      sanitized[key] = Math.max(0, Math.round(value)) as never;
      continue;
    }
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    sanitized[key] = value as never;
  }
  return sanitized;
}

export function mergePerformanceMetrics(
  ...items: Array<AiLogPerformanceMetrics | null | undefined>
): AiLogPerformanceMetrics {
  const merged: AiLogPerformanceMetrics = {};
  for (const item of items) {
    if (!item) continue;
    const sanitized = sanitizePerformanceMetrics(item);
    for (const [key, value] of Object.entries(sanitized) as Array<
      [keyof AiLogPerformanceMetrics, AiLogPerformanceMetrics[keyof AiLogPerformanceMetrics]]
    >) {
      merged[key] = value as never;
    }
  }
  return merged;
}

export class AiRequestProbe {
  private readonly startedAt = probeNow();
  private metrics: AiLogPerformanceMetrics;

  constructor(initial?: AiLogPerformanceMetrics) {
    this.metrics = sanitizePerformanceMetrics(initial);
  }

  set(metrics: AiLogPerformanceMetrics): void {
    this.metrics = mergePerformanceMetrics(this.metrics, metrics);
  }

  snapshot(overrides?: AiLogPerformanceMetrics): AiLogPerformanceMetrics {
    return mergePerformanceMetrics(this.metrics, overrides);
  }

  elapsed(): number {
    return elapsedMs(this.startedAt);
  }

  mark(): number {
    return probeNow();
  }

  since(mark: number): number {
    return elapsedMs(mark);
  }
}
