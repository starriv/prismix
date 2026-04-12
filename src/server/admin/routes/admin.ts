import { Hono } from "hono";
import { groupBy } from "lodash-es";

import { transaction } from "@/server/db";
import { createAdminBody } from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { getAdminSession } from "@/server/middleware/auth";
import { adminRepo, identityRepo } from "@/server/repos";

const admin = new Hono();

// ── Admin Members CRUD ────────────────────────────────────────────

// GET /admins — list all admins with their identities
admin.get("/admins", async (c) => {
  const admins = await adminRepo.findAll();
  if (admins.length === 0) return ok(c, []);

  const adminIds = admins.map((a) => a.id);
  const allIdentities = await identityRepo.findByUserIds(adminIds, "admin");
  const identitiesByAdmin = groupBy(allIdentities, "userId");

  const result = admins.map((a) => {
    const identities = identitiesByAdmin[a.id] || [];
    return {
      id: a.id,
      name: a.name,
      address: a.address,
      email: a.email,
      createdAt: a.createdAt,
      identities: identities.map((i) => ({
        id: i.id,
        provider: i.provider,
        providerAccountId: i.providerAccountId,
      })),
    };
  });
  return ok(c, result);
});

// POST /admins — create a new admin with an identity
admin.post("/admins", async (c) => {
  const parsed = await parseBody(c, createAdminBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Check if identity already exists
  const existing = await identityRepo.findByProviderAndAccount(
    body.provider,
    body.providerAccountId,
    "admin",
  );
  if (existing) {
    return c.json({ error: "An admin with this identity already exists" }, 409);
  }

  const newAdmin = await transaction(async () => {
    const created = await adminRepo.create({
      name: body.name.trim(),
      email: body.email ?? null,
      address: body.address?.toLowerCase() ?? null,
    });

    await identityRepo.create({
      userId: created.id,
      userRole: "admin",
      provider: body.provider,
      providerAccountId: body.providerAccountId.toLowerCase(),
    });

    return created;
  });

  log.admin.info({ adminId: newAdmin.id, provider: body.provider }, "Admin member created");
  return ok(c, newAdmin, 201);
});

// DELETE /admins?id=N — delete an admin and their identities
admin.delete("/admins", async (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ error: "Missing id" }, 400);
  const adminId = Number(id);

  // Prevent deleting the last admin
  const all = await adminRepo.findAll();
  if (all.length <= 1) {
    return c.json({ error: "Cannot delete the last admin" }, 400);
  }

  const target = await adminRepo.findById(adminId);
  if (!target) return c.json({ error: "Admin not found" }, 404);

  // Prevent self-deletion
  const session = c.get("admin" as never) as { adminId: number } | undefined;
  if (session?.adminId === adminId) {
    return c.json({ error: "Cannot delete yourself" }, 400);
  }

  await transaction(async () => {
    await identityRepo.deleteByUserId(adminId, "admin");
    await adminRepo.delete(adminId);
  });

  log.admin.info({ adminId }, "Admin member deleted");
  return ok(c, { success: true });
});

// ── Hot Wallet Status ────────────────────────────────────────────────

admin.get("/wallet/hot-wallet", async (c) => {
  const { isHotWalletConfigured, getHotWalletAddress, getHotWalletBalances } =
    await import("@/server/lib/hot-wallet");
  if (!isHotWalletConfigured()) {
    return ok(c, { configured: false, address: null, balances: [] });
  }
  const address = getHotWalletAddress();
  const balances = await getHotWalletBalances();
  return ok(c, { configured: true, address, balances });
});

// GET /wallet/deposits — all on-chain deposit transactions
admin.get("/wallet/deposits", async (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const offset = Number(c.req.query("offset") ?? 0);
  const { payAgentTransactionRepo } = await import("@/server/repos");
  const rows = await payAgentTransactionRepo.findFiltered(
    { type: "top_up", source: "on_chain" },
    limit,
    offset,
  );
  return ok(c, rows);
});

// GET /wallet/withdrawals — all withdrawal orders
admin.get("/wallet/withdrawals", async (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const offset = Number(c.req.query("offset") ?? 0);
  const status = c.req.query("status") || undefined;
  const { withdrawOrderRepo } = await import("@/server/repos");
  const rows = await withdrawOrderRepo.findAll({ status, limit, offset });
  return ok(c, rows);
});

// GET /wallet/withdrawals/count — count by status (for badges)
admin.get("/wallet/withdrawals/count", async (c) => {
  const { withdrawOrderRepo } = await import("@/server/repos");
  const pending = await withdrawOrderRepo.count("pending");
  return ok(c, { pending });
});

// PUT /wallet/withdrawals/:id/approve — debit balance + execute on-chain transfer
admin.put("/wallet/withdrawals/:id/approve", async (c) => {
  const session = getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const { withdrawOrderRepo, payAgentRepo, payAgentTransactionRepo } =
    await import("@/server/repos");
  const order = await withdrawOrderRepo.findById(id);
  if (!order) return c.json({ error: "Withdrawal order not found" }, 404);
  if (order.status !== "pending") {
    return c.json({ error: `Cannot approve order with status: ${order.status}` }, 400);
  }

  const { isHotWalletConfigured, sendUsdc } = await import("@/server/lib/hot-wallet");
  if (!isHotWalletConfigured()) {
    return c.json({ error: "Hot wallet not configured, cannot execute transfer" }, 503);
  }

  // Debit balance at approval time (not at submission)
  const debited = await payAgentRepo.debitBalance(order.agentId, order.amount);
  if (!debited) {
    await withdrawOrderRepo.updateStatus(id, "failed", {
      failReason: "Insufficient balance at approval time",
      reviewedBy: session.adminId,
    });
    return c.json({ error: "Insufficient balance" }, 400);
  }

  // Mark as processing
  await withdrawOrderRepo.updateStatus(id, "processing", { reviewedBy: session.adminId });

  try {
    const { txHash } = await sendUsdc({
      toAddress: order.toAddress as `0x${string}`,
      amount: order.amount,
      networkId: order.network,
    });

    const updated = await withdrawOrderRepo.updateStatus(id, "completed", { txHash });

    // Record withdraw transaction
    const { safePlus } = await import("@/shared/number");
    await payAgentTransactionRepo.insert({
      agentId: order.agentId,
      userId: order.userId,
      type: "withdraw",
      amount: order.amount,
      balanceBefore: safePlus(debited.balance, order.amount),
      balanceAfter: debited.balance,
      txHash,
      network: order.network,
      source: "on_chain",
      description: `Withdrawal to ${order.toAddress}`,
    });

    return ok(c, updated);
  } catch (err) {
    // On-chain transfer failed — refund the debited balance
    await payAgentRepo.creditBalance(order.agentId, order.amount);
    const failReason = err instanceof Error ? err.message : String(err);
    await withdrawOrderRepo.updateStatus(id, "failed", { failReason, reviewedBy: session.adminId });

    log.blockchain.error(
      { err, orderId: id },
      "Approved withdrawal on-chain transfer failed, refunded",
    );
    return c.json({ error: "Transfer failed, balance refunded", detail: failReason }, 500);
  }
});

// PUT /wallet/withdrawals/:id/reject — cancel order (no balance change)
admin.put("/wallet/withdrawals/:id/reject", async (c) => {
  const session = getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const body = await c.req.json<{ reason?: string }>().catch((): { reason?: string } => ({}));

  const { withdrawOrderRepo } = await import("@/server/repos");
  const order = await withdrawOrderRepo.findById(id);
  if (!order) return c.json({ error: "Withdrawal order not found" }, 404);
  if (order.status !== "pending") {
    return c.json({ error: `Cannot reject order with status: ${order.status}` }, 400);
  }

  // Simply cancel — balance was never debited, no refund needed
  const failReason = body.reason || "Rejected by admin";
  const updated = await withdrawOrderRepo.updateStatus(id, "cancelled", {
    failReason,
    reviewedBy: session.adminId,
  });

  return ok(c, updated);
});

export default admin;
