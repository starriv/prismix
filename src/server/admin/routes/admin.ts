import argon2 from "argon2";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { groupBy } from "lodash-es";

import {
  payAgents,
  payAgentTransactions,
  topUpOrders,
  transaction,
  users,
  withdrawOrders,
} from "@/server/db";
import {
  confirmTopupOrderBody,
  createAdminBody,
  createFiatConfigBody,
  rejectTopupOrderBody,
  reorderFiatConfigsBody,
  settleTopupOrderBody,
  updateFiatConfigBody,
} from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody, parsePaginationLimit, parsePaginationOffset } from "@/server/lib/validate";
import { getAdminSession } from "@/server/middleware/auth";
import {
  adminRepo,
  fiatConfigRepo,
  identityRepo,
  topupOrderRepo,
  userRepo,
  withdrawOrderRepo,
} from "@/server/repos";
import { safeMinus, safePlus } from "@/shared/number";

const PASSWORD_COMPLEXITY_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

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

  // Hash password for credentials provider (mandatory)
  let passwordHash: string | undefined;
  if (body.provider === "credentials") {
    if (!body.password) {
      return c.json({ error: "Password is required for credentials provider" }, 400);
    }
    if (!PASSWORD_COMPLEXITY_RE.test(body.password)) {
      return c.json(
        { error: "Password must contain at least one uppercase, one lowercase, and one digit" },
        400,
      );
    }
    passwordHash = await argon2.hash(body.password);
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
      passwordHash: passwordHash ?? null,
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

  // Only the primary admin (id=1) can delete other admins
  const session = getAdminSession(c);
  if (session.adminId !== 1) {
    return c.json({ error: "Only the primary admin can remove members" }, 403);
  }

  // Prevent self-deletion
  if (session.adminId === adminId) {
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

// ── Fiat Configs ──────────────────────────────────────────────────────

admin.get("/fiat-configs", async (c) => {
  return ok(c, await fiatConfigRepo.findAll());
});

admin.post("/fiat-configs", async (c) => {
  const parsed = await parseBody(c, createFiatConfigBody);
  if (!parsed.ok) return parsed.response;

  const current = await fiatConfigRepo.findAll();
  const created = await fiatConfigRepo.create({
    ...parsed.data,
    config: JSON.stringify(parsed.data.config),
    enabled: parsed.data.enabled ?? true,
    sortOrder: current.length,
  });
  return ok(c, created, 201);
});

// NOTE: /reorder must be registered BEFORE /:id to avoid Hono matching "reorder" as :id
admin.put("/fiat-configs/reorder", async (c) => {
  const parsed = await parseBody(c, reorderFiatConfigsBody);
  if (!parsed.ok) return parsed.response;
  await fiatConfigRepo.reorder(parsed.data.ids);
  return ok(c, await fiatConfigRepo.findAll());
});

admin.put("/fiat-configs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const parsed = await parseBody(c, updateFiatConfigBody.omit({ id: true }));
  if (!parsed.ok) return parsed.response;

  const payload: {
    displayName?: string;
    enabled?: boolean;
    config?: string;
  } = {
    displayName: parsed.data.displayName,
    enabled: parsed.data.enabled,
    ...(parsed.data.config ? { config: JSON.stringify(parsed.data.config) } : {}),
  };

  const updated = await fiatConfigRepo.update(id, payload);
  if (!updated) return c.json({ error: "Fiat config not found" }, 404);
  return ok(c, updated);
});

admin.delete("/fiat-configs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const inTopups = await topupOrderRepo.findFiatConfigUsageCount(id);
  const inWithdraws = await withdrawOrderRepo.findFiatConfigUsageCount(id);
  if (inTopups > 0 || inWithdraws > 0) {
    return c.json({ error: "Fiat config is already referenced by existing orders" }, 409);
  }

  await fiatConfigRepo.delete(id);
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

// GET /topup-orders — all top-up orders (enriched with owner uuid)
admin.get("/topup-orders", async (c) => {
  const limit = parsePaginationLimit(c.req.query("limit"), 50, 100);
  const offset = parsePaginationOffset(c.req.query("offset"));
  const status = c.req.query("status") || undefined;

  const items = await topupOrderRepo.findAll({ status, limit, offset });
  const total = await topupOrderRepo.count(status);

  const users = await userRepo.findAll(1000, 0);
  const userByAgentId = new Map(users.filter((u) => u.agentId).map((u) => [u.agentId!, u]));

  return ok(c, {
    items: items.map((order) => {
      const owner = userByAgentId.get(order.agentId);
      return {
        ...order,
        userId: owner?.id ?? null,
        userUuid: owner?.uuid ?? null,
        userName: owner?.name ?? null,
      };
    }),
    total,
  });
});

// PUT /topup-orders/:id/confirm — manually confirm a top-up order
admin.put("/topup-orders/:id/confirm", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const parsed = await parseBody(c, confirmTopupOrderBody);
  if (!parsed.ok) return parsed.response;

  const order = await topupOrderRepo.confirm(id, {
    fiatAmount: parsed.data.fiatAmount,
    note: parsed.data.note,
  });
  if (!order) return c.json({ error: "Top-up order not found or already processed" }, 404);

  return ok(c, order);
});

// PUT /topup-orders/:id/settle — credit wallet + mark order confirmed
admin.put("/topup-orders/:id/settle", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const parsed = await parseBody(c, settleTopupOrderBody);
  if (!parsed.ok) return parsed.response;

  const creditAmount = parsed.data.amount;
  const description = parsed.data.note || `Admin settled top-up order #${id}`;

  try {
    const settled = await transaction(async (tx: any) => {
      // Lock the order row inside the transaction to prevent concurrent settle
      const [existingOrder] = await tx
        .select()
        .from(topUpOrders)
        .where(and(eq(topUpOrders.id, id), eq(topUpOrders.status, "pending")))
        .for("update");

      if (!existingOrder) return null;

      if (existingOrder.type === "fiat" && !parsed.data.fiatAmount) {
        throw new Error("FIAT_AMOUNT_REQUIRED");
      }

      const now = new Date();
      const originalAmount = existingOrder.amount;
      const [confirmed] = await tx
        .update(topUpOrders)
        .set({
          amount: creditAmount,
          status: "confirmed",
          fiatAmount: existingOrder.type === "fiat" ? parsed.data.fiatAmount : undefined,
          adminNote: description,
          confirmedAt: now,
          updatedAt: now,
        })
        .where(eq(topUpOrders.id, id))
        .returning();

      if (!confirmed) return null;

      const [owner] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.agentId, confirmed.agentId))
        .limit(1);
      if (!owner) {
        throw new Error("ORDER_OWNER_WALLET_NOT_FOUND");
      }

      const [credited] = await tx
        .update(payAgents)
        .set({
          balance: sql`CAST(CAST(${payAgents.balance} AS NUMERIC) + CAST(${creditAmount} AS NUMERIC) AS TEXT)`,
          status: "active",
          updatedAt: now,
        })
        .where(eq(payAgents.id, confirmed.agentId))
        .returning();
      if (!credited) {
        throw new Error("ORDER_OWNER_WALLET_NOT_FOUND");
      }

      await tx.insert(payAgentTransactions).values({
        agentId: confirmed.agentId,
        userId: owner.id,
        type: "top_up",
        amount: creditAmount,
        balanceBefore: safeMinus(credited.balance, creditAmount),
        balanceAfter: credited.balance,
        referenceType: "top_up_order",
        referenceId: confirmed.id,
        description,
        source: "platform",
        network: confirmed.network,
      });

      return {
        order: confirmed,
        userId: owner.id,
        originalAmount,
      };
    });

    if (!settled) {
      return c.json({ error: "Top-up order not found or already processed" }, 409);
    }

    log.admin.info(
      {
        orderId: id,
        userId: settled.userId,
        agentId: settled.order.agentId,
        creditAmount,
        originalAmount: settled.originalAmount,
        amountChanged: settled.originalAmount !== creditAmount,
      },
      "Top-up order settled by admin",
    );
    return ok(c, settled.order);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "FIAT_AMOUNT_REQUIRED") {
        return c.json({ error: "Fiat amount is required for fiat top-up settlement" }, 400);
      }
      if (err.message === "ORDER_OWNER_WALLET_NOT_FOUND") {
        return c.json({ error: "Order owner wallet not found" }, 404);
      }
    }
    throw err;
  }
});

// PUT /topup-orders/:id/reject — reject a pending top-up order
admin.put("/topup-orders/:id/reject", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const parsed = await parseBody(c, rejectTopupOrderBody);
  if (!parsed.ok) return parsed.response;

  const order = await topupOrderRepo.reject(id, parsed.data.note);
  if (!order) return c.json({ error: "Top-up order not found or already processed" }, 404);

  return ok(c, order);
});

// GET /wallet/withdrawals — all withdrawal orders
admin.get("/wallet/withdrawals", async (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const offset = Number(c.req.query("offset") ?? 0);
  const status = c.req.query("status") || undefined;
  const userUuid = c.req.query("userUuid") || undefined;
  const { withdrawOrderRepo } = await import("@/server/repos");
  const rows = await withdrawOrderRepo.findAll({ status, userUuid, limit, offset });
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

  const order = await withdrawOrderRepo.findById(id);
  if (!order) return c.json({ error: "Withdrawal order not found" }, 404);
  if (order.status !== "pending") {
    return c.json({ error: `Cannot approve order with status: ${order.status}` }, 400);
  }

  if (order.type === "crypto") {
    const { isHotWalletConfigured } = await import("@/server/lib/hot-wallet");
    if (!isHotWalletConfigured()) {
      return c.json({ error: "Hot wallet not configured, cannot execute transfer" }, 503);
    }
  }

  const approval = await transaction(async (tx: any) => {
    const now = new Date();
    const [processingOrder] = await tx
      .update(withdrawOrders)
      .set({
        status: "processing",
        reviewedBy: session.adminId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(and(eq(withdrawOrders.id, id), eq(withdrawOrders.status, "pending")))
      .returning();

    if (!processingOrder) return null;

    const [debited] = await tx
      .update(payAgents)
      .set({
        balance: sql`CAST(CAST(${payAgents.balance} AS NUMERIC) - CAST(${processingOrder.amount} AS NUMERIC) AS TEXT)`,
        updatedAt: now,
      })
      .where(
        and(
          eq(payAgents.id, processingOrder.agentId),
          sql`CAST(${payAgents.balance} AS NUMERIC) >= CAST(${processingOrder.amount} AS NUMERIC)`,
        ),
      )
      .returning();

    if (!debited) {
      const [failed] = await tx
        .update(withdrawOrders)
        .set({
          status: "failed",
          failReason: "Insufficient balance at approval time",
          reviewedBy: session.adminId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(withdrawOrders.id, id))
        .returning();

      return { kind: "insufficient" as const, order: failed };
    }

    if (processingOrder.type === "fiat") {
      const adminNote = `Fiat withdrawal approved via ${processingOrder.paymentMethod ?? "manual"}`;
      const [completed] = await tx
        .update(withdrawOrders)
        .set({
          status: "completed",
          adminNote,
          updatedAt: now,
        })
        .where(and(eq(withdrawOrders.id, id), eq(withdrawOrders.status, "processing")))
        .returning();

      if (!completed) {
        throw new Error("WITHDRAWAL_APPROVAL_CONFLICT");
      }

      await tx.insert(payAgentTransactions).values({
        agentId: processingOrder.agentId,
        userId: processingOrder.userId,
        type: "withdraw",
        amount: processingOrder.amount,
        balanceBefore: safePlus(debited.balance, processingOrder.amount),
        balanceAfter: debited.balance,
        network: processingOrder.network ?? null,
        source: "platform",
        description: `Fiat withdrawal via ${processingOrder.paymentMethod ?? "manual"}`,
      });

      return { kind: "fiat" as const, order: completed };
    }

    return {
      kind: "crypto" as const,
      order: processingOrder,
      balanceAfter: debited.balance,
    };
  });

  if (!approval) {
    return c.json({ error: "Withdrawal order not found or already processed" }, 409);
  }
  if (approval.kind === "insufficient") {
    return c.json({ error: "Insufficient balance" }, 400);
  }
  if (approval.kind === "fiat") {
    return ok(c, approval.order);
  }

  const { sendUsdc } = await import("@/server/lib/hot-wallet");
  const processingOrder = approval.order;

  try {
    const { txHash } = await sendUsdc({
      toAddress: processingOrder.toAddress as `0x${string}`,
      amount: processingOrder.amount,
      networkId: processingOrder.network!,
    });

    const updated = await transaction(async (tx: any) => {
      const now = new Date();
      const [completed] = await tx
        .update(withdrawOrders)
        .set({
          status: "completed",
          txHash,
          updatedAt: now,
        })
        .where(and(eq(withdrawOrders.id, id), eq(withdrawOrders.status, "processing")))
        .returning();

      if (!completed) {
        throw new Error("WITHDRAWAL_FINALIZATION_CONFLICT");
      }

      await tx.insert(payAgentTransactions).values({
        agentId: processingOrder.agentId,
        userId: processingOrder.userId,
        type: "withdraw",
        amount: processingOrder.amount,
        balanceBefore: safePlus(approval.balanceAfter, processingOrder.amount),
        balanceAfter: approval.balanceAfter,
        txHash,
        network: processingOrder.network,
        source: "on_chain",
        description: `Withdrawal to ${processingOrder.toAddress}`,
      });

      return completed;
    });

    return ok(c, updated);
  } catch (err) {
    const failReason = err instanceof Error ? err.message : String(err);

    if (failReason === "WITHDRAWAL_FINALIZATION_CONFLICT") {
      log.blockchain.error(
        { err, orderId: id },
        "Withdrawal transfer sent but failed to finalize order state",
      );
      return c.json(
        {
          error:
            "Transfer sent but failed to finalize withdrawal order. Manual intervention required.",
        },
        500,
      );
    }

    await transaction(async (tx: any) => {
      const now = new Date();
      await tx
        .update(payAgents)
        .set({
          balance: sql`CAST(CAST(${payAgents.balance} AS NUMERIC) + CAST(${processingOrder.amount} AS NUMERIC) AS TEXT)`,
          status: "active",
          updatedAt: now,
        })
        .where(eq(payAgents.id, processingOrder.agentId));

      await tx
        .update(withdrawOrders)
        .set({
          status: "failed",
          failReason,
          reviewedBy: session.adminId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(withdrawOrders.id, id));
    });

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
