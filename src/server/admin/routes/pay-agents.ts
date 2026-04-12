/**
 * Admin Pay Agent management routes.
 *
 * Mounted at /api/admin/pay-agents — requires adminAuthMiddleware.
 */
import { Hono } from "hono";

import { createAgentBody, manualTopupBody, updateAgentBody } from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import {
  parseBody,
  parseIntParam,
  parsePaginationLimit,
  parsePaginationOffset,
} from "@/server/lib/validate";
import { ensureAgentWallet } from "@/server/lib/wallet";
import { payAgentRepo, payAgentTransactionRepo, userRepo } from "@/server/repos";
import { safePlus } from "@/shared/number";

const payAgentsRouter = new Hono();

// ── List all pay agents ──────────────────────────────────────────────

payAgentsRouter.get("/", async (c) => {
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));
  const userName = c.req.query("userName") || undefined;
  const address = c.req.query("address") || undefined;

  const agents = await payAgentRepo.findAll(limit, offset, { address });

  // Attach owner userId by looking up users.agentId
  const users = await userRepo.findAll();
  const userByAgentId = new Map(users.filter((u) => u.agentId).map((u) => [u.agentId, u]));
  let enriched = agents.map((a) => {
    const owner = userByAgentId.get(a.id);
    return { ...a, userId: owner?.id ?? null, userName: owner?.name ?? null };
  });

  // Post-filter by owner userName (lives in users table, not pay_agents)
  if (userName) {
    const needle = userName.toLowerCase();
    enriched = enriched.filter((a) => a.userName && a.userName.toLowerCase().includes(needle));
  }

  return ok(c, enriched);
});

// ── Create a new pay agent ───────────────────────────────────────────

payAgentsRouter.post("/", async (c) => {
  const parsed = await parseBody(c, createAgentBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const agent = await payAgentRepo.create({
    name: body.name.trim(),
    description: body.description ?? null,
    type: "ledger",
    defaultMarkupPercent: body.defaultMarkupPercent ?? null,
  });

  // Generate wallet in background — do not block response
  ensureAgentWallet(agent.id).catch((err) =>
    log.admin.warn({ err, agentId: agent.id }, "Failed to generate agent wallet on creation"),
  );

  log.admin.info({ agentId: agent.id, name: agent.name }, "Pay agent created");
  return ok(c, agent, 201);
});

// ── Global transaction list (filtered) ───────────────────────────────
// NOTE: This must be registered BEFORE /:id routes to avoid matching "txns" as an id param.

payAgentsRouter.get("/txns", async (c) => {
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));
  const agentId = parseIntParam(c.req.query("agentId"));
  const type = c.req.query("type") || undefined;

  const rows = await payAgentTransactionRepo.findFiltered(
    { agentId: agentId ?? undefined, type },
    limit,
    offset,
  );
  return ok(c, rows);
});

// ── Get single agent detail ──────────────────────────────────────────

payAgentsRouter.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid agent ID" }, 400);

  const agent = await payAgentRepo.findById(id);
  if (!agent) return c.json({ error: "Pay agent not found" }, 404);

  return ok(c, agent);
});

// ── Update agent ─────────────────────────────────────────────────────

payAgentsRouter.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid agent ID" }, 400);

  const parsed = await parseBody(c, updateAgentBody);
  if (!parsed.ok) return parsed.response;

  const { id: _bodyId, ...data } = parsed.data;

  const updated = await payAgentRepo.update(id, data);
  if (!updated) return c.json({ error: "Pay agent not found" }, 404);

  log.admin.info({ agentId: id }, "Pay agent updated");
  return ok(c, updated);
});

// ── Delete agent ─────────────────────────────────────────────────────

payAgentsRouter.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid agent ID" }, 400);

  const existing = await payAgentRepo.findById(id);
  if (!existing) return c.json({ error: "Pay agent not found" }, 404);

  // Delete transactions first (no FK — manual cleanup)
  await payAgentTransactionRepo.deleteByAgentId(id);
  await payAgentRepo.delete(id);

  log.admin.info({ agentId: id, name: existing.name }, "Pay agent deleted");
  return ok(c, { success: true });
});

// ── Manual top-up (admin balance credit) ─────────────────────────────

payAgentsRouter.post("/:id/manual-topup", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid agent ID" }, 400);

  const parsed = await parseBody(c, manualTopupBody);
  if (!parsed.ok) return parsed.response;
  const { amount, note } = parsed.data;

  const agent = await payAgentRepo.findById(id);
  if (!agent) return c.json({ error: "Pay agent not found" }, 404);

  const balanceBefore = agent.balance;
  const credited = await payAgentRepo.creditBalance(id, amount);

  await payAgentTransactionRepo.insert({
    agentId: id,
    type: "top_up",
    amount,
    balanceBefore,
    balanceAfter: credited.balance,
    description: note ?? null,
    source: "platform",
  });

  log.admin.info({ agentId: id, amount, balanceAfter: credited.balance }, "Manual top-up");
  return ok(c, credited);
});

// ── Manual debit (admin balance deduction) ──────────────────────────

payAgentsRouter.post("/:id/debit", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid agent ID" }, 400);

  const parsed = await parseBody(c, manualTopupBody); // reuse same schema (amount + note)
  if (!parsed.ok) return parsed.response;
  const { amount, note } = parsed.data;

  const agent = await payAgentRepo.findById(id);
  if (!agent) return c.json({ error: "Pay agent not found" }, 404);

  const debited = await payAgentRepo.debitBalance(id, amount);
  if (!debited) return c.json({ error: "Insufficient balance" }, 400);

  await payAgentTransactionRepo.insert({
    agentId: id,
    type: "admin_debit",
    amount,
    balanceBefore: safePlus(debited.balance, amount),
    balanceAfter: debited.balance,
    description: note ?? "Admin deduction",
    source: "platform",
  });

  log.admin.info({ agentId: id, amount, balanceAfter: debited.balance }, "Manual debit");
  return ok(c, debited);
});

// ── Agent transaction history ────────────────────────────────────────

payAgentsRouter.get("/:id/txns", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid agent ID" }, 400);

  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));

  const rows = await payAgentTransactionRepo.findByAgentId(id, limit, offset);
  return ok(c, rows);
});

export default payAgentsRouter;
