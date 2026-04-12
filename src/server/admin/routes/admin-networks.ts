import { Hono } from "hono";

import { transaction } from "@/server/db";
import { createNetworkBody, updateNetworkBody } from "@/server/lib/body-schemas";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { networkRepo } from "@/server/repos";

const router = new Hono();

// ── Supported Networks ───────────────────────────────────────────

router.get("/networks", async (c) => {
  const all = await networkRepo.findAllNetworks();
  return ok(c, all);
});

router.post("/networks", async (c) => {
  const parsed = await parseBody(c, createNetworkBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const existing = await networkRepo.findNetworkByChainId(body.chainId);
  if (existing) {
    return c.json({ error: "Network already exists" }, 409);
  }

  const created = await networkRepo.createNetwork(body);
  return ok(c, created, 201);
});

router.put("/networks", async (c) => {
  const parsed = await parseBody(c, updateNetworkBody);
  if (!parsed.ok) return parsed.response;

  const { id, ...fields } = parsed.data;
  const result = await networkRepo.updateNetwork(id, fields);
  if (!result) return c.json({ error: "Network not found" }, 404);
  return ok(c, result);
});

router.delete("/networks", async (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ error: "Missing id" }, 400);

  const existing = await networkRepo.findNetworkById(Number(id));
  if (!existing) return c.json({ error: "Network not found" }, 404);

  // Also remove all allowed_tokens on this network
  await transaction(async () => {
    await networkRepo.deleteTokensByNetwork(existing.networkId);
    await networkRepo.deleteNetwork(Number(id));
  });
  return ok(c, { success: true });
});

// ── Circle USDC Networks ─────────────────────────────────────────
// Source of truth: https://www.circle.com/multi-chain-usdc
// Replaces the old chainlist.org proxy — only Circle native USDC networks are offered.

router.get("/circle-networks", async (c) => {
  const { CIRCLE_NETWORKS } = await import("@/shared/circle-networks");
  const existingIds = new Set((await networkRepo.findAllNetworks()).map((n) => n.chainId));

  const entries = CIRCLE_NETWORKS.map((net) => ({
    chainId: net.chainId,
    name: net.name,
    shortName: net.shortName,
    explorerUrl: net.explorerUrl,
    testnet: net.testnet,
    iconUrl: net.iconUrl,
    alreadyAdded: existingIds.has(net.chainId),
  }));

  return ok(c, entries);
});

export default router;
