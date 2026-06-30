/**
 * Periodic job: endpoint and upstream connectivity health check.
 *
 * For each enabled endpoint, checks the endpoint's official base URL and each
 * bound upstream using an enabled endpoint credential.
 */
import { Queue, Worker } from "bullmq";

import type { SupplierRuntimeDefaults } from "@/server/ai/lib/connector-runtime-config";
import { pingEndpoint, type PingResult } from "@/server/ai/lib/endpoint-health";
import type { AiSupplierConnection } from "@/server/db";
import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
import { removeStaleRepeatableJobs } from "@/server/jobs/repeatable";
import { decrypt } from "@/server/lib/crypto";
import { log } from "@/server/lib/logger";
import {
  aiEndpointCredentialRepo,
  aiEndpointRepo,
  aiModelRepo,
  aiUpstreamAssignmentRepo,
  aiUpstreamRepo,
} from "@/server/repos";

const QUEUE_NAME = "endpoint-health-check";
const JOB_NAME = "check-all";
const REPEAT_JOB_ID = "endpoint-health-check-recurring";

const AI_CREDENTIAL_DOMAIN_TAG = "ai-merchant-key";

const CHECK_INTERVAL_MS = Number(process.env.ENDPOINT_HEALTH_CHECK_INTERVAL_MS) || 60 * 1000;
const FAILURE_THRESHOLD = Number(process.env.ENDPOINT_HEALTH_CHECK_FAILURE_THRESHOLD) || 2;
const FAILURE_WINDOW_MS =
  Number(process.env.ENDPOINT_HEALTH_CHECK_FAILURE_WINDOW_MS) || 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = Number(process.env.ENDPOINT_HEALTH_CHECK_TIMEOUT_MS) || 10_000;
const ENDPOINT_CONCURRENCY = 5;

type HealthCheckEndpoint = AiSupplierConnection & {
  supplier?: SupplierRuntimeDefaults | null;
};

let queue: Queue | null = null;
let worker: Worker | null = null;

interface CheckTarget {
  kind: "endpoint" | "upstream";
  id: number;
  credentialUpstreamId: number | null;
  disableOnFailure: boolean;
  name: string;
  baseUrl: string;
  modelsEndpointOverride: string | null;
  endpoint: HealthCheckEndpoint;
}

interface HealthEntity {
  autoDisabled: boolean;
  consecutiveFailures: number;
  lastFailureAt?: Date | null;
}

function hasChatCapability(capabilities: string): boolean {
  try {
    const parsed = JSON.parse(capabilities) as unknown;
    return Array.isArray(parsed) && parsed.includes("chat");
  } catch {
    return false;
  }
}

async function findAnthropicProbeModelId(endpoint: HealthCheckEndpoint): Promise<string | null> {
  if (endpoint.apiFormat !== "anthropic") return null;

  const models = await aiModelRepo.findEnabledByEndpointId(endpoint.id);
  return (
    models.find((model) => hasChatCapability(model.capabilities))?.modelId ??
    models[0]?.modelId ??
    null
  );
}

async function checkAllEndpoints(): Promise<void> {
  const endpoints = await aiEndpointRepo.findAllForHealthCheckWithSupplier();
  if (endpoints.length === 0) return;

  for (let i = 0; i < endpoints.length; i += ENDPOINT_CONCURRENCY) {
    const batch = endpoints.slice(i, i + ENDPOINT_CONCURRENCY);
    await Promise.allSettled(batch.map((endpoint) => checkEndpoint(endpoint)));
  }
}

export async function checkEndpoint(endpoint: HealthCheckEndpoint): Promise<void> {
  // Skip admin-disabled endpoints (enabled=false && autoDisabled=false).
  if (!endpoint.enabled && !endpoint.autoDisabled) {
    return;
  }

  const targets: CheckTarget[] = [];
  const anthropicProbeModelId = await findAnthropicProbeModelId(endpoint);

  const assignments = await aiUpstreamAssignmentRepo.findByEndpointId(endpoint.id);
  const upstreamIds = assignments.map((assignment) => assignment.upstreamId);
  const upstreams = await aiUpstreamRepo.findByIds(upstreamIds);
  const checkableUpstreams = upstreams.filter(
    (upstream) => upstream.enabled || upstream.autoDisabled,
  );

  targets.push({
    kind: "endpoint",
    id: endpoint.id,
    credentialUpstreamId: null,
    disableOnFailure: checkableUpstreams.length === 0,
    name: endpoint.name,
    baseUrl: endpoint.baseUrl,
    modelsEndpointOverride: null,
    endpoint,
  });

  for (const upstream of checkableUpstreams) {
    targets.push({
      kind: "upstream",
      id: upstream.id,
      credentialUpstreamId: upstream.id,
      disableOnFailure: true,
      name: upstream.name,
      baseUrl: upstream.baseUrl,
      modelsEndpointOverride: upstream.modelsEndpoint,
      endpoint,
    });
  }

  const results = await Promise.all(
    targets.map(async (target) => {
      const credential =
        target.credentialUpstreamId == null
          ? await aiEndpointCredentialRepo.findAnyEnabledByEndpoint(endpoint.id)
          : await aiEndpointCredentialRepo.findAnyEnabledByUpstream(
              endpoint.id,
              target.credentialUpstreamId,
            );

      if (!credential) {
        await markTargetConfigError(target, "No enabled endpoint credential configured");
        log.endpoint.warn(
          {
            kind: target.kind,
            endpointId: endpoint.id,
            targetId: target.id,
            name: target.name,
            credentialUpstreamId: target.credentialUpstreamId,
          },
          "No endpoint credential — skipping target",
        );
        return null;
      }

      let plainKey: string;
      try {
        plainKey = decrypt(credential.encryptedKey, AI_CREDENTIAL_DOMAIN_TAG);
      } catch (err) {
        await markTargetConfigError(target, "Failed to decrypt endpoint credential");
        log.endpoint.error(
          {
            err,
            endpointId: endpoint.id,
            endpointCredentialId: credential.id,
            targetId: target.id,
          },
          "Endpoint credential decryption failed",
        );
        return null;
      }

      const result = await pingEndpoint({
        endpoint: target.endpoint,
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
    await applyHealthResult(item.target, item.result);
  }
}

async function markTargetConfigError(target: CheckTarget, error: string): Promise<void> {
  const repo = target.kind === "endpoint" ? aiEndpointRepo : aiUpstreamRepo;
  await repo.updateHealth(target.id, {
    healthStatus: "degraded",
    lastCheckedAt: new Date(),
    lastError: error,
  });
}

interface EndpointNotifyMeta {
  kind: "endpoint" | "upstream";
  id: number;
  name: string;
  baseUrl: string;
  endpointId: number;
  endpointName: string;
  error?: string;
  consecutiveFailures?: number;
}

function buildEndpointBody(summary: string, meta: EndpointNotifyMeta): string {
  const kindLabel = meta.kind === "upstream" ? "上游" : "Endpoint";
  const rows: string[] = [`类型: ${kindLabel}`, `ID: ${meta.id}`, `名称: ${meta.name}`];
  if (meta.baseUrl) rows.push(`Base URL: ${meta.baseUrl}`);
  if (meta.endpointName) rows.push(`所属 Endpoint: ${meta.endpointName}`);
  rows.push(`Endpoint ID: ${meta.endpointId}`);
  if (meta.consecutiveFailures != null) rows.push(`连续失败: ${meta.consecutiveFailures}`);
  if (meta.error) rows.push(`最后错误: ${meta.error}`);
  return `${summary}\n\n详细信息:\n${rows.join("\n")}`;
}

function isFailureWindowExpired(entity: HealthEntity): boolean {
  if (entity.consecutiveFailures === 0) return false;
  if (!entity.lastFailureAt) return false;
  return Date.now() - entity.lastFailureAt.getTime() > FAILURE_WINDOW_MS;
}

function formatFailureWindow(): string {
  const minutes = FAILURE_WINDOW_MS / 60_000;
  if (Number.isInteger(minutes)) return `${minutes} 分钟`;
  return `${Math.round(FAILURE_WINDOW_MS / 1000)} 秒`;
}

export async function applyHealthResult(target: CheckTarget, result: PingResult): Promise<void> {
  const repo = target.kind === "endpoint" ? aiEndpointRepo : aiUpstreamRepo;
  const entity = await repo.findById(target.id);
  if (!entity) return;

  if (result.ok) {
    if (entity.autoDisabled) {
      await repo.markAutoReenabled(target.id);
      emitHealthInvalidation(target);
      log.endpoint.info(
        { kind: target.kind, id: target.id, name: target.name, latencyMs: result.latencyMs },
        "Endpoint resource auto-reenabled",
      );
      const meta: EndpointNotifyMeta = {
        kind: target.kind,
        id: target.id,
        name: target.name,
        baseUrl: target.baseUrl,
        endpointId: target.endpoint.id,
        endpointName: target.endpoint.name,
      };
      emit(DOMAIN_EVENT_TYPES.ENDPOINT_REENABLED, null, {
        ...meta,
        title: `Endpoint 已自动恢复: ${target.name}`,
        body: buildEndpointBody(
          `${target.kind === "endpoint" ? "Endpoint" : "上游"} "${target.name}" 连通性恢复正常，已自动恢复启用。`,
          meta,
        ),
      });
    } else {
      await repo.recordSuccess(target.id);
      log.endpoint.debug(
        { kind: target.kind, id: target.id, latencyMs: result.latencyMs },
        "Endpoint health check ok",
      );
    }
    return;
  }

  const errorMsg = result.error ?? `HTTP ${result.status}`;
  if (!entity.autoDisabled && isFailureWindowExpired(entity)) {
    await repo.updateHealth(target.id, { consecutiveFailures: 0 });
  }
  await repo.recordFailure(target.id, errorMsg);
  const updated = await repo.findById(target.id);
  const consecutiveFailures = updated?.consecutiveFailures ?? entity.consecutiveFailures + 1;

  log.endpoint.warn(
    {
      kind: target.kind,
      id: target.id,
      name: target.name,
      status: result.status,
      error: errorMsg,
      consecutiveFailures,
      failureThreshold: FAILURE_THRESHOLD,
      failureWindowMs: FAILURE_WINDOW_MS,
    },
    "Endpoint health check failed",
  );

  if (
    updated &&
    updated.consecutiveFailures >= FAILURE_THRESHOLD &&
    !updated.autoDisabled &&
    target.disableOnFailure
  ) {
    await repo.markAutoDisabled(target.id, errorMsg);
    emitHealthInvalidation(target);
    log.endpoint.error(
      {
        kind: target.kind,
        id: target.id,
        name: target.name,
        consecutiveFailures: updated.consecutiveFailures,
        error: errorMsg,
      },
      "Endpoint resource auto-disabled after threshold failures",
    );
    const meta: EndpointNotifyMeta = {
      kind: target.kind,
      id: target.id,
      name: target.name,
      baseUrl: target.baseUrl,
      endpointId: target.endpoint.id,
      endpointName: target.endpoint.name,
      error: errorMsg,
      consecutiveFailures: updated.consecutiveFailures,
    };
    emit(DOMAIN_EVENT_TYPES.ENDPOINT_DISABLED, null, {
      ...meta,
      title: `Endpoint 已自动禁用: ${target.name}`,
      body: buildEndpointBody(
        `${target.kind === "endpoint" ? "Endpoint" : "上游"} "${target.name}" 在 ${formatFailureWindow()}内累计 ${FAILURE_THRESHOLD} 次连通性检查失败，已自动禁用。最后错误: ${errorMsg}`,
        meta,
      ),
    });
  }
}

function emitHealthInvalidation(target: CheckTarget): void {
  if (target.kind === "endpoint") {
    emit(DOMAIN_EVENT_TYPES.AI_UPSTREAM_CACHE_INVALIDATED, null, { endpointId: target.id });
    emit(DOMAIN_EVENT_TYPES.AI_CREDENTIAL_POOL_INVALIDATED, null, { endpointId: target.id });
    return;
  }

  emit(DOMAIN_EVENT_TYPES.AI_UPSTREAM_CACHE_INVALIDATED, null, { upstreamId: target.id });
}

/** Initialize the endpoint health check BullMQ queue + worker. Call from bootstrap. */
export async function initEndpointHealthCheckJob(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.endpoint.warn("REDIS_URL not set — endpoint health check disabled");
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

  await removeStaleRepeatableJobs(queue, {
    jobName: JOB_NAME,
    repeatJobId: REPEAT_JOB_ID,
    everyMs: CHECK_INTERVAL_MS,
    log: log.endpoint,
    label: "endpoint health",
  });

  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: { every: CHECK_INTERVAL_MS },
      jobId: REPEAT_JOB_ID,
    },
  );

  worker = new Worker(
    QUEUE_NAME,
    async () => {
      await checkAllEndpoints();
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (_job, err) => {
    log.endpoint.error({ err }, "Endpoint health check job failed");
  });

  worker.on("error", (err) => {
    log.endpoint.error({ err }, "Endpoint health check worker error");
  });

  log.endpoint.info(
    {
      intervalMs: CHECK_INTERVAL_MS,
      failureThreshold: FAILURE_THRESHOLD,
      timeoutMs: REQUEST_TIMEOUT_MS,
    },
    "Endpoint health check job started",
  );
}

/** Graceful shutdown — close queue + worker. */
export async function closeEndpointHealthCheckJob(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
