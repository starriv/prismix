import { Hono } from "hono";
import { groupBy } from "lodash-es";

import { transaction } from "@/server/db";
import { creditUserBody, updateUserBody } from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody, parsePaginationLimit, parsePaginationOffset } from "@/server/lib/validate";
import { ensureAgentWallet } from "@/server/lib/wallet";
import {
  identityRepo,
  payAgentRepo,
  payAgentTransactionRepo,
  refreshTokenRepo,
  userRepo,
  withdrawOrderRepo,
} from "@/server/repos";
import { gt } from "@/shared/number";

const router = new Hono();

// GET /users — list all registered users (enriched with identity providers)
router.get("/users", async (c) => {
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));
  const idRaw = c.req.query("id");
  const id =
    idRaw && Number.isFinite(Number(idRaw)) && Number(idRaw) > 0 ? Number(idRaw) : undefined;
  const uuid = c.req.query("uuid")?.trim() || undefined;
  const name = c.req.query("name")?.trim() || undefined;
  const email = c.req.query("email")?.trim() || undefined;
  const address = c.req.query("address")?.trim() || undefined;
  const filters = { id, uuid, name, email, address };
  const [all, total] = await Promise.all([
    userRepo.findAll(limit, offset, filters),
    userRepo.count(filters),
  ]);
  const userIds = all.map((u) => u.id);
  const identities = userIds.length ? await identityRepo.findByUserIds(userIds) : [];
  const identitiesByUserId = groupBy(identities, "userId");

  const enriched = all.map((u) => ({
    ...u,
    providers: (identitiesByUserId[u.id] ?? []).map((i) => i.provider),
  }));
  return ok(c, { items: enriched, total });
});

// DELETE /users?id=N — delete user + cascade
router.delete("/users", async (c) => {
  const id = c.req.query("id");
  if (!id) {
    return c.json({ error: "Missing id" }, 400);
  }
  const userId = Number(id);

  const existing = await userRepo.findById(userId);
  if (!existing) {
    return c.json({ error: "User not found" }, 404);
  }

  // Block deletion if wallet has remaining balance
  const agentId = existing.agentId;
  if (agentId) {
    const agent = await payAgentRepo.findById(agentId);
    if (agent && gt(agent.balance, "0")) {
      return c.json(
        {
          error: `User wallet has ${agent.balance} USDC remaining. Withdraw or zero the balance before deleting.`,
        },
        400,
      );
    }
  }

  // CASCADE auto-deletes: relay_consumer_keys (via userId FK)
  // Manual delete needed: polymorphic tables + pay agent (no CASCADE)
  await transaction(async () => {
    await refreshTokenRepo.deleteByUser(userId, "user");
    await identityRepo.deleteByUserId(userId, "user");
    // Delete pay agent transactions + agent itself (no FK, manual cleanup)
    if (agentId) {
      await payAgentTransactionRepo.deleteByAgentId(agentId);
      await withdrawOrderRepo.deleteByAgent(agentId);
      await payAgentRepo.delete(agentId);
    }
    await userRepo.delete(userId);
  });

  log.admin.info({ userId }, "User deleted with full cleanup");
  return ok(c, { success: true });
});

// GET /users/:id — single user detail with optional wallet info
router.get("/users/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid user ID" }, 400);
  }

  const user = await userRepo.findById(id);
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  let wallet: { agentId: number; balance: string; address: string | null; status: string } | null =
    null;
  if (user.agentId) {
    const agent = await payAgentRepo.findById(user.agentId);
    if (agent) {
      wallet = {
        agentId: agent.id,
        balance: agent.balance,
        address: agent.address,
        status: agent.status,
      };
    }
  }

  return ok(c, { ...user, wallet });
});

// PUT /users/:id — update user fields
router.put("/users/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid user ID" }, 400);
  }

  const parsed = await parseBody(c, updateUserBody);
  if (!parsed.ok) return parsed.response;

  const existing = await userRepo.findById(id);
  if (!existing) {
    return c.json({ error: "User not found" }, 404);
  }

  const updated = await userRepo.update(id, parsed.data);
  log.admin.info({ userId: id, fields: Object.keys(parsed.data) }, "User updated");
  return ok(c, updated);
});

// POST /users/:id/create-agent — always create a NEW pay agent and link to user
router.post("/users/:id/create-agent", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid user ID" }, 400);
  }

  const user = await userRepo.findById(id);
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Always create a fresh agent (unlike ensureUserAgent which is idempotent)
  const agent = await payAgentRepo.create({
    name: `[Wallet] ${user.name || user.email || `User #${id}`}`,
    description: null,
    type: "ledger",
  });

  await userRepo.setAgentId(id, agent.id);

  // Generate deposit wallet in background
  ensureAgentWallet(agent.id).catch((err) =>
    log.admin.warn({ err, agentId: agent.id }, "Failed to generate wallet for new agent"),
  );

  const updated = await userRepo.findById(id);
  log.admin.info({ userId: id, agentId: agent.id }, "New pay agent created for user");
  return ok(c, updated);
});

// POST /users/:id/disable — disable user
// Consumer keys are NOT modified — the auth middleware checks user status
// at request time via LEFT JOIN, so individually-suspended keys are preserved.
router.post("/users/:id/disable", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid user ID" }, 400);
  }

  const existing = await userRepo.findById(id);
  if (!existing) {
    return c.json({ error: "User not found" }, 404);
  }
  if (existing.status === 2) {
    return c.json({ error: "User is already disabled" }, 400);
  }

  await userRepo.update(id, { status: 2 });

  log.admin.info({ userId: id }, "User disabled");
  return ok(c, { success: true });
});

// POST /users/:id/enable — re-enable user
// Consumer keys are NOT modified — their individual status is preserved.
router.post("/users/:id/enable", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid user ID" }, 400);
  }

  const existing = await userRepo.findById(id);
  if (!existing) {
    return c.json({ error: "User not found" }, 404);
  }
  if (existing.status === 1) {
    return c.json({ error: "User is already active" }, 400);
  }

  await userRepo.update(id, { status: 1 });

  log.admin.info({ userId: id }, "User re-enabled");
  return ok(c, { success: true });
});

// POST /users/:id/credit — admin credit wallet balance
router.post("/users/:id/credit", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid user ID" }, 400);
  }

  const parsed = await parseBody(c, creditUserBody);
  if (!parsed.ok) return parsed.response;
  const { amount, description } = parsed.data;

  const existing = await userRepo.findById(id);
  if (!existing) {
    return c.json({ error: "User not found" }, 404);
  }
  if (!existing.agentId) {
    return c.json({ error: "User has no wallet (no linked agent)" }, 400);
  }

  const agent = await payAgentRepo.findById(existing.agentId);
  if (!agent) {
    return c.json({ error: "Linked agent not found" }, 404);
  }

  const updatedAgent = await payAgentRepo.creditBalance(agent.id, amount);
  await payAgentTransactionRepo.insert({
    agentId: agent.id,
    userId: id,
    type: "top_up",
    amount,
    balanceBefore: agent.balance,
    balanceAfter: updatedAgent.balance,
    description: description || "Admin credit",
    source: "admin",
  });

  log.admin.info({ userId: id, agentId: agent.id, amount }, "Admin credited user wallet");
  return ok(c, { success: true, balance: updatedAgent.balance });
});

export default router;
