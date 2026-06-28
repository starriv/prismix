/**
 * AI credential and endpoint-credential routes.
 *
 * A credential is the real secret owned by a supplier. An endpoint credential
 * binds that secret to a callable endpoint/upstream with routing weight.
 */
import { Hono } from "hono";

import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
import {
  createAiCredentialBody,
  createAiEndpointCredentialBody,
  updateAiCredentialBody,
  updateAiEndpointCredentialBody,
} from "@/server/lib/body-schemas";
import { decrypt, encrypt, hashApiKey } from "@/server/lib/crypto";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { getAdminSession } from "@/server/middleware/auth";
import {
  aiCredentialRepo,
  aiEndpointCredentialRepo,
  aiEndpointRepo,
  aiModelRepo,
  aiSupplierRepo,
  aiUpstreamAssignmentRepo,
  aiUpstreamRepo,
} from "@/server/repos";

import { invalidateCredentialPool } from "../lib/credential-balancer";
import { pingEndpoint } from "../lib/endpoint-health";
import { formatCredentials, formatEndpointCredentials } from "./admin-ai-helpers";

const AI_CREDENTIAL_DOMAIN_TAG = "ai-merchant-key";
const CREDENTIAL_TEST_TIMEOUT_MS = 10_000;

const router = new Hono();

function redactCredentialForResponse<T extends { encryptedKey?: unknown; keyHash?: unknown }>(
  credential: T,
) {
  const safe: Record<string, unknown> = { ...credential };
  delete safe.encryptedKey;
  delete safe.keyHash;
  return safe;
}

function emitCredentialPoolInvalidated(endpointId: number, upstreamId?: number | null): void {
  invalidateCredentialPool(endpointId, upstreamId);
  emit(DOMAIN_EVENT_TYPES.AI_CREDENTIAL_POOL_INVALIDATED, null, {
    endpointId,
    upstreamId: upstreamId ?? undefined,
  });
}

function hasChatCapability(capabilities: string): boolean {
  try {
    const parsed = JSON.parse(capabilities) as unknown;
    return Array.isArray(parsed) && parsed.includes("chat");
  } catch {
    return false;
  }
}

async function findAnthropicProbeModelId(
  endpointId: number,
  apiFormat: string,
): Promise<string | null> {
  if (apiFormat !== "anthropic") return null;

  const models = await aiModelRepo.findEnabledByEndpointId(endpointId);
  const anthropicModels = models.filter((model) => model.clientFormat === "anthropic");
  return (
    anthropicModels.find((model) => hasChatCapability(model.capabilities))?.modelId ??
    anthropicModels[0]?.modelId ??
    null
  );
}

async function validateEndpointCredentialTarget(
  endpointId: number,
  credentialId: number,
  upstreamId: number | null | undefined,
) {
  const endpoint = await aiEndpointRepo.findById(endpointId);
  if (!endpoint || !endpoint.enabled) {
    return { ok: false as const, response: { error: "Endpoint not found or disabled" } };
  }

  const credential = await aiCredentialRepo.findById(credentialId);
  if (!credential || !credential.enabled) {
    return { ok: false as const, response: { error: "Credential not found or disabled" } };
  }

  if (credential.supplierId !== endpoint.supplierId) {
    return {
      ok: false as const,
      response: { error: "Credential supplier must match endpoint supplier" },
    };
  }

  if (upstreamId != null) {
    const upstream = await aiUpstreamRepo.findById(upstreamId);
    if (!upstream || !upstream.enabled) {
      return { ok: false as const, response: { error: "Upstream not found or disabled" } };
    }
    const assignment = await aiUpstreamAssignmentRepo.findByEndpointAndUpstreamId(
      endpointId,
      upstreamId,
    );
    if (!assignment || !assignment.enabled) {
      return cError("Upstream not assigned to this endpoint or assignment is disabled");
    }
  }

  return { ok: true as const, endpoint, credential };
}

function cError(error: string) {
  return { ok: false as const, response: { error } };
}

// ── Credentials ──────────────────────────────────────────────────────

router.get("/credentials", async (c) => {
  getAdminSession(c);
  const credentials = await aiCredentialRepo.findAll();
  return ok(c, await formatCredentials(credentials));
});

router.post("/credentials", async (c) => {
  getAdminSession(c);
  const parsed = await parseBody(c, createAiCredentialBody);
  if (!parsed.ok) return parsed.response;
  const { supplierId, name, apiKey, ownerId } = parsed.data;

  const supplier = await aiSupplierRepo.findById(supplierId);
  if (!supplier || !supplier.enabled) {
    return c.json({ error: "Supplier not found or disabled" }, 400);
  }

  const keyHash = hashApiKey(apiKey);
  const existing = await aiCredentialRepo.findByKeyHash(keyHash);
  if (existing) return c.json({ error: "Credential already exists" }, 409);

  const encryptedKey = encrypt(apiKey, AI_CREDENTIAL_DOMAIN_TAG);
  const keyPrefix = apiKey.length > 8 ? `${apiKey.slice(0, 8)}...` : apiKey;

  const created = await aiCredentialRepo.create({
    supplierId,
    name,
    encryptedKey,
    keyHash,
    keyPrefix,
    ownerId: ownerId ?? null,
  });

  log.auth.info(
    { supplierId: supplier.supplierId, credentialId: created.id },
    "AI credential created",
  );
  return ok(c, { ...redactCredentialForResponse(created), supplierName: supplier.name }, 201);
});

router.put("/credentials/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiCredentialRepo.findById(id);
  if (!existing) return c.json({ error: "Credential not found" }, 404);

  const parsed = await parseBody(c, updateAiCredentialBody);
  if (!parsed.ok) return parsed.response;

  const updated = await aiCredentialRepo.update(id, parsed.data);
  if (!updated) return c.json({ error: "Update failed" }, 500);

  const assignments = await aiEndpointCredentialRepo.findByCredentialId(id);
  for (const assignment of assignments) {
    emitCredentialPoolInvalidated(assignment.endpointId, assignment.upstreamId ?? null);
  }

  return ok(c, redactCredentialForResponse(updated));
});

router.delete("/credentials/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiCredentialRepo.findById(id);
  if (!existing) return c.json({ error: "Credential not found" }, 404);

  const assignments = await aiEndpointCredentialRepo.findByCredentialId(id);
  await aiCredentialRepo.delete(id);
  for (const assignment of assignments) {
    emitCredentialPoolInvalidated(assignment.endpointId, assignment.upstreamId ?? null);
  }

  return ok(c, { success: true });
});

// ── Endpoint credentials ─────────────────────────────────────────────

router.get("/endpoint-credentials", async (c) => {
  getAdminSession(c);
  const credentials = await aiEndpointCredentialRepo.findAll();
  return ok(c, await formatEndpointCredentials(credentials));
});

router.post("/endpoint-credentials", async (c) => {
  getAdminSession(c);
  const parsed = await parseBody(c, createAiEndpointCredentialBody);
  if (!parsed.ok) return parsed.response;
  const { endpointId, credentialId, upstreamId, name, weight, enabled } = parsed.data;

  const target = await validateEndpointCredentialTarget(endpointId, credentialId, upstreamId);
  if (!target.ok) return c.json(target.response, 400);

  const created = await aiEndpointCredentialRepo.create({
    endpointId,
    credentialId,
    upstreamId: upstreamId ?? null,
    name: name ?? target.credential.name,
    weight: weight ?? 1,
    enabled: enabled ?? true,
  });

  emitCredentialPoolInvalidated(endpointId, upstreamId ?? null);
  log.auth.info(
    { endpointId: target.endpoint.endpointId, credentialId },
    "AI endpoint credential created",
  );
  const createdWithCredential = await aiEndpointCredentialRepo.findById(created.id);
  return ok(c, (await formatEndpointCredentials([createdWithCredential!]))[0], 201);
});

router.put("/endpoint-credentials/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiEndpointCredentialRepo.findById(id);
  if (!existing) return c.json({ error: "Endpoint credential not found" }, 404);

  const parsed = await parseBody(c, updateAiEndpointCredentialBody);
  if (!parsed.ok) return parsed.response;

  if (parsed.data.upstreamId !== undefined) {
    const target = await validateEndpointCredentialTarget(
      existing.endpointId,
      existing.credentialId,
      parsed.data.upstreamId,
    );
    if (!target.ok) return c.json(target.response, 400);
  }

  const updated = await aiEndpointCredentialRepo.update(id, parsed.data);
  if (!updated) return c.json({ error: "Update failed" }, 500);

  emitCredentialPoolInvalidated(existing.endpointId, existing.upstreamId ?? null);
  emitCredentialPoolInvalidated(updated.endpointId, updated.upstreamId ?? null);
  const updatedWithCredential = await aiEndpointCredentialRepo.findById(updated.id);
  return ok(c, (await formatEndpointCredentials([updatedWithCredential!]))[0]);
});

router.delete("/endpoint-credentials/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiEndpointCredentialRepo.findById(id);
  if (!existing) return c.json({ error: "Endpoint credential not found" }, 404);

  await aiEndpointCredentialRepo.delete(id);
  emitCredentialPoolInvalidated(existing.endpointId, existing.upstreamId ?? null);
  return ok(c, { success: true });
});

// ── Test endpoint credential connectivity ────────────────────────────

router.post("/endpoint-credentials/:id/test", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const endpointCredential = await aiEndpointCredentialRepo.findById(id);
  if (!endpointCredential) return c.json({ error: "Endpoint credential not found" }, 404);

  const endpoint = await aiEndpointRepo.findById(endpointCredential.endpointId);
  if (!endpoint) return c.json({ error: "Endpoint not found" }, 404);

  let plainKey: string;
  try {
    plainKey = decrypt(endpointCredential.encryptedKey, AI_CREDENTIAL_DOMAIN_TAG);
  } catch {
    return c.json({ success: false, error: "Failed to decrypt credential" });
  }

  const start = Date.now();
  try {
    const upstream = endpointCredential.upstreamId
      ? await aiUpstreamRepo.findById(endpointCredential.upstreamId)
      : null;
    if (endpointCredential.upstreamId != null) {
      const assignment = await aiUpstreamAssignmentRepo.findByEndpointAndUpstreamId(
        endpointCredential.endpointId,
        endpointCredential.upstreamId,
      );
      if (!upstream || !upstream.enabled || !assignment || !assignment.enabled) {
        return c.json(
          { success: false, error: "Bound upstream is unavailable for this endpoint" },
          400,
        );
      }
    }

    const baseUrl = upstream?.baseUrl ?? endpoint.baseUrl;
    const modelsEndpointOverride = upstream?.modelsEndpoint ?? null;
    const anthropicProbeModelId = await findAnthropicProbeModelId(endpoint.id, endpoint.apiFormat);
    const finalResult = await pingEndpoint({
      endpoint,
      baseUrl,
      modelsEndpointOverride,
      plainKey,
      anthropicProbeModelId,
      timeoutMs: CREDENTIAL_TEST_TIMEOUT_MS,
    });
    const latencyMs = Date.now() - start;

    if (finalResult.ok) {
      await aiEndpointCredentialRepo.updateLastUsed(id);
      return ok(c, { success: true, latencyMs, status: finalResult.status });
    }

    return ok(c, {
      success: false,
      latencyMs,
      status: finalResult.status,
      error: finalResult.error?.slice(0, 500),
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return ok(c, { success: false, latencyMs, error: message });
  }
});

export default router;
