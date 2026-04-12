import { Hono } from "hono";

import { createAllowedTokenBody, updateAllowedTokenBody } from "@/server/lib/body-schemas";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { networkRepo } from "@/server/repos";
import { getKnownAddressesForToken, KNOWN_TOKENS } from "@/shared/tokens";

const router = new Hono();

// GET /known-tokens — static registry of well-known tokens + addresses
router.get("/known-tokens", async (c) => {
  const enabledNetworks = (await networkRepo.findAllNetworks()).map((n) => n.networkId);

  const result = KNOWN_TOKENS.map((token) => ({
    ...token,
    addresses: getKnownAddressesForToken(token.symbol).filter((a) =>
      enabledNetworks.includes(a.networkId),
    ),
  }));
  return ok(c, result);
});

// ── Allowed Tokens ────────────────────────────────────────────────

// GET /allowed-tokens — list all allowed tokens
router.get("/allowed-tokens", async (c) => {
  const all = await networkRepo.findAllTokens();
  return ok(c, all);
});

// POST /allowed-tokens — create a new allowed token
router.post("/allowed-tokens", async (c) => {
  const parsed = await parseBody(c, createAllowedTokenBody);
  if (!parsed.ok) return parsed.response;
  const { symbol, network, contractAddress } = parsed.data;

  // Check duplicate
  const existing = await networkRepo.findTokenBySymbolAndNetwork(symbol, network);
  if (existing) {
    return c.json({ error: "Token already exists for this network" }, 409);
  }

  const created = await networkRepo.createToken({ symbol, network, contractAddress });
  return ok(c, created, 201);
});

// PUT /allowed-tokens — update enabled status
router.put("/allowed-tokens", async (c) => {
  const parsed = await parseBody(c, updateAllowedTokenBody);
  if (!parsed.ok) return parsed.response;
  const { id, enabled } = parsed.data;

  const updates: Record<string, unknown> = {};
  if (enabled !== undefined) updates.enabled = enabled;

  const result = await networkRepo.updateToken(id, updates);
  if (!result) {
    return c.json({ error: "Token not found" }, 404);
  }
  return ok(c, result);
});

// DELETE /allowed-tokens?id=N
router.delete("/allowed-tokens", async (c) => {
  const id = c.req.query("id");
  if (!id) {
    return c.json({ error: "Missing id" }, 400);
  }

  const existing = await networkRepo.findTokenById(Number(id));
  if (!existing) {
    return c.json({ error: "Token not found" }, 404);
  }

  await networkRepo.deleteToken(Number(id));
  return ok(c, { success: true });
});

export default router;
