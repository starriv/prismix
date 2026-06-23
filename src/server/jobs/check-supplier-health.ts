/**
 * Periodic job: supplier (AI provider + upstream) connectivity health check.
 *
 * Runs every 1 minute via BullMQ repeatable job. For each enabled provider:
 *   1. Pings provider.baseUrl + all bound enabled+!autoDisabled upstreams
 *   2. On success: recordSuccess (or markAutoReenabled if was auto-disabled)
 *   3. On failure: recordFailure (increments consecutiveFailures)
 *   4. When consecutiveFailures >= threshold (1): markAutoDisabled + notify
 *   5. On success after auto-disabled: markAutoReenabled + notify
 *
 * Multi-instance safe: BullMQ repeatable job's jobId ensures only one
 * scheduling across all instances. Worker concurrency limits per-tick
 * parallelism (5 providers checked simultaneously).
 *
 * See: docs/rfcs/rfc-supplier-health-check.md
 */
import { Queue, type RepeatableJob, Worker } from "bullmq";

import { pingEndpoint, type PingResult } from "@/server/ai/lib/supplier-health";
import type { AiProvider, AiUpstream } from "@/server/db";
import { emit } from "@/server/events";
import { decrypt } from "@/server/lib/crypto";
import { log } from "@/server/lib/logger";
import { emitNotification } from "@/server/messaging/notifications";
import { aiKeyRepo, aiModelRepo, aiProviderRepo, aiUpstreamRepo } from "@/server/repos";
import { aiUpstreamAssignmentRepo } from "@/server/repos/ai-upstream-assignment-repo";

const QUEUE_NAME = "supplier-health-check";
const REPEAT_JOB_ID = "supplier-health-check-recurring";

const AI_KEY_DOMAIN_TAG = "ai-merchant-key";

const CHECK_INTERVAL_MS = Number(process.env.SUPPLIER_HEALTH_CHECK_INTERVAL_MS) || 60 * 1000;
const FAILURE_THRESHOLD = Number(process.env.SUPPLIER_HEALTH_CHECK_FAILURE_THRESHOLD) || 1;
const REQUEST_TIMEOUT_MS = Number(process.env.SUPPLIER_HEALTH_CHECK_TIMEOUT_MS) || 10_000;
const PROVIDER_CONCURRENCY = 5;

let queue: Queue | null = null;
let worker: Worker | null = null;

interface CheckTarget {
  kind: "provider" | "upstream";
  id: number;
  keyUpstreamId: number | null;
  disableOnFailure: boolean;
  name: string;
  baseUrl: string;
  modelsEndpointOverride: string | null;
  provider: AiProvider;
}

function hasChatCapability(capabilities: string): boolean {
  try {
    const parsed = JSON.parse(capabilities) as unknown;
    return Array.isArray(parsed) && parsed.includes("chat");
  } catch {
    return false;
  }
}

async function findAnthropicProbeModelId(provider: AiProvider): Promise<string | null> {
  if (provider.apiFormat !== "anthropic") return null;

  const models = await aiModelRepo.findEnabledByProviderId(provider.id);
  const anthropicModels = models.filter((model) => model.clientFormat === "anthropic");
  return (
    anthropicModels.find((model) => hasChatCapability(model.capabilities))?.modelId ??
    anthropicModels[0]?.modelId ??
    null
  );
}

async function checkAllSuppliers(): Promise<void> {
  const providers = await aiProviderRepo.findAllForHealthCheck();
  if (providers.length === 0) return;

  for (let i = 0; i < providers.length; i += PROVIDER_CONCURRENCY) {
    const batch = providers.slice(i, i + PROVIDER_CONCURRENCY);
    await Promise.allSettled(batch.map((provider) => checkProvider(provider)));
  }
}

export async function checkProvider(provider: AiProvider): Promise<void> {
  // Skip admin-disabled (enabled=false && autoDisabled=false) — do not auto-restore
  if (!provider.enabled && !provider.autoDisabled) {
    return;
  }

  const targets: CheckTarget[] = [];
  const anthropicProbeModelId = await findAnthropicProbeModelId(provider);

  const assignments = await aiUpstreamAssignmentRepo.findByProviderId(provider.id);
  const upstreamIds = assignments.map((a) => a.upstreamId);
  const upstreams = await aiUpstreamRepo.findByIds(upstreamIds);
  const checkableUpstreams = upstreams.filter(
    (upstream) => upstream.enabled || upstream.autoDisabled,
  );

  targets.push({
    kind: "provider",
    id: provider.id,
    keyUpstreamId: null,
    disableOnFailure: checkableUpstreams.length === 0,
    name: provider.name,
    baseUrl: provider.baseUrl,
    modelsEndpointOverride: null,
    provider,
  });

  for (const upstream of checkableUpstreams) {
    targets.push({
      kind: "upstream",
      id: upstream.id,
      keyUpstreamId: upstream.id,
      disableOnFailure: true,
      name: upstream.name,
      baseUrl: upstream.baseUrl,
      modelsEndpointOverride: upstream.modelsEndpoint,
      provider,
    });
  }

  const results = await Promise.all(
    targets.map(async (target) => {
      const key =
        target.keyUpstreamId == null
          ? await aiKeyRepo.findAnyEnabledByProvider(provider.id)
          : await aiKeyRepo.findAnyEnabledByUpstream(provider.id, target.keyUpstreamId);

      if (!key) {
        await markTargetConfigError(target, "No enabled API key configured");
        log.supplier.warn(
          {
            kind: target.kind,
            providerId: provider.id,
            targetId: target.id,
            name: target.name,
            keyUpstreamId: target.keyUpstreamId,
          },
          "No API key — skipping target",
        );
        return null;
      }

      let plainKey: string;
      try {
        plainKey = decrypt(key.encryptedKey, AI_KEY_DOMAIN_TAG);
      } catch (err) {
        await markTargetConfigError(target, "Failed to decrypt API key");
        log.supplier.error(
          { err, providerId: provider.id, keyId: key.id, targetId: target.id },
          "Key decryption failed",
        );
        return null;
      }

      const result = await pingEndpoint({
        provider: target.provider,
        baseUrl: target.baseUrl,
        modelsEndpointOverride: target.modelsEndpointOverride,
        plainKey,
        anthropicProbeModelId,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      return { target, result };
    }),
  );

  for (const item of results) {
    if (!item) continue;
    const { target, result } = item;
    await applyHealthResult(target, result);
  }
}

async function markTargetConfigError(target: CheckTarget, error: string): Promise<void> {
  const repo = target.kind === "provider" ? aiProviderRepo : aiUpstreamRepo;
  await repo.updateHealth(target.id, {
    healthStatus: "degraded",
    lastCheckedAt: new Date(),
    lastError: error,
  });
}

interface SupplierNotifyMeta {
  kind: "provider" | "upstream";
  id: number;
  name: string;
  baseUrl: string;
  providerId: number;
  providerName: string;
  error?: string;
  consecutiveFailures?: number;
}

function buildSupplierBody(summary: string, meta: SupplierNotifyMeta): string {
  const kindLabel = meta.kind === "upstream" ? "上游" : "供应商";
  const rows: string[] = [`类型: ${kindLabel}`, `ID: ${meta.id}`, `名称: ${meta.name}`];
  if (meta.baseUrl) rows.push(`Base URL: ${meta.baseUrl}`);
  if (meta.providerName) rows.push(`所属供应商: ${meta.providerName}`);
  rows.push(`Provider ID: ${meta.providerId}`);
  if (meta.consecutiveFailures != null) rows.push(`连续失败: ${meta.consecutiveFailures}`);
  if (meta.error) rows.push(`最后错误: ${meta.error}`);
  return `${summary}\n\n详细信息:\n${rows.join("\n")}`;
}

export async function applyHealthResult(target: CheckTarget, result: PingResult): Promise<void> {
  const repo = target.kind === "provider" ? aiProviderRepo : aiUpstreamRepo;
  const entity = await repo.findById(target.id);
  if (!entity) return;

  if (result.ok) {
    if (entity.autoDisabled) {
      await repo.markAutoReenabled(target.id);
      emitHealthInvalidation(target);
      log.supplier.info(
        { kind: target.kind, id: target.id, name: target.name, latencyMs: result.latencyMs },
        "Supplier auto-reenabled",
      );
      const meta: SupplierNotifyMeta = {
        kind: target.kind,
        id: target.id,
        name: target.name,
        baseUrl: target.baseUrl,
        providerId: target.provider.id,
        providerName: target.provider.name,
      };
      await emitNotification("supplier.reenabled", {
        title: `供应商已自动恢复: ${target.name}`,
        body: buildSupplierBody(
          `${target.kind === "provider" ? "供应商" : "上游"} "${target.name}" 连通性恢复正常，已自动恢复启用。`,
          meta,
        ),
        metadata: { ...meta },
      });
    } else {
      await repo.recordSuccess(target.id);
      log.supplier.debug(
        { kind: target.kind, id: target.id, latencyMs: result.latencyMs },
        "Health check ok",
      );
    }
    return;
  }

  const errorMsg = result.error ?? `HTTP ${result.status}`;
  await repo.recordFailure(target.id, errorMsg);

  log.supplier.warn(
    {
      kind: target.kind,
      id: target.id,
      name: target.name,
      status: result.status,
      error: errorMsg,
      consecutiveFailures: entity.consecutiveFailures + 1,
    },
    "Health check failed",
  );

  // Auto-disable when threshold reached
  const updated = await repo.findById(target.id);
  if (
    updated &&
    updated.consecutiveFailures >= FAILURE_THRESHOLD &&
    !updated.autoDisabled &&
    target.disableOnFailure
  ) {
    await repo.markAutoDisabled(target.id, errorMsg);
    emitHealthInvalidation(target);
    log.supplier.error(
      {
        kind: target.kind,
        id: target.id,
        name: target.name,
        consecutiveFailures: updated.consecutiveFailures,
        error: errorMsg,
      },
      "Supplier auto-disabled after threshold failures",
    );
    const meta: SupplierNotifyMeta = {
      kind: target.kind,
      id: target.id,
      name: target.name,
      baseUrl: target.baseUrl,
      providerId: target.provider.id,
      providerName: target.provider.name,
      error: errorMsg,
      consecutiveFailures: updated.consecutiveFailures,
    };
    await emitNotification("supplier.disabled", {
      title: `供应商已自动禁用: ${target.name}`,
      body: buildSupplierBody(
        `${target.kind === "provider" ? "供应商" : "上游"} "${target.name}" 连续 ${FAILURE_THRESHOLD} 次连通性检查失败，已自动禁用。最后错误: ${errorMsg}`,
        meta,
      ),
      metadata: { ...meta },
    });
  }
}

function emitHealthInvalidation(target: CheckTarget): void {
  if (target.kind === "provider") {
    emit("ai.upstream-cache-invalidated", null, { providerId: target.id });
    emit("ai.key-pool-invalidated", null, { providerId: target.id });
    return;
  }

  emit("ai.upstream-cache-invalidated", null, { upstreamId: target.id });
}

async function removeStaleRepeatableJobs(queue: Queue): Promise<void> {
  const repeatableJobs: RepeatableJob[] = await queue.getRepeatableJobs();
  const expectedEvery = String(CHECK_INTERVAL_MS);
  for (const job of repeatableJobs) {
    if (job.name !== "check-all") continue;
    if (job.id !== REPEAT_JOB_ID) continue;
    if (job.every === expectedEvery) continue;

    await queue.removeRepeatableByKey(job.key);
    log.supplier.info(
      { repeatKey: job.key, previousEvery: job.every, nextEvery: expectedEvery },
      "Removed stale supplier health repeatable job",
    );
  }
}

/** Initialize the supplier health check BullMQ queue + worker. Call from bootstrap. */
export async function initSupplierHealthCheckJob(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.supplier.warn("REDIS_URL not set — supplier health check disabled");
    return;
  }

  const connection = { url: redisUrl };

  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 },
    },
  });

  await removeStaleRepeatableJobs(queue);

  // Register repeatable job — jobId ensures only one schedule across instances
  await queue.add(
    "check-all",
    {},
    {
      repeat: { every: CHECK_INTERVAL_MS },
      jobId: REPEAT_JOB_ID,
    },
  );

  worker = new Worker(
    QUEUE_NAME,
    async () => {
      await checkAllSuppliers();
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (_job, err) => {
    log.supplier.error({ err }, "Supplier health check job failed");
  });

  worker.on("error", (err) => {
    log.supplier.error({ err }, "Supplier health check worker error");
  });

  log.supplier.info(
    {
      intervalMs: CHECK_INTERVAL_MS,
      failureThreshold: FAILURE_THRESHOLD,
      timeoutMs: REQUEST_TIMEOUT_MS,
    },
    "Supplier health check job started",
  );
}

/** Graceful shutdown — close queue + worker. */
export async function closeSupplierHealthCheckJob(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
