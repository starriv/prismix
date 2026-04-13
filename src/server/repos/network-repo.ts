/**
 * Network repository — CRUD for `supported_networks` and `allowed_tokens` tables.
 */
import { and, eq } from "drizzle-orm";

import {
  type AllowedToken,
  allowedTokens,
  db,
  exec,
  type NewAllowedToken,
  type NewSupportedNetwork,
  queryAll,
  queryOne,
  returningOne,
  type SupportedNetwork,
  supportedNetworks,
} from "@/server/db";

export const networkRepo = {
  // ── Supported Networks ──────────────────────────────────────────────

  async findEnabledNetworks(): Promise<SupportedNetwork[]> {
    return queryAll(db.select().from(supportedNetworks).where(eq(supportedNetworks.enabled, true)));
  },

  async findAllNetworks(limit = 200, offset = 0): Promise<SupportedNetwork[]> {
    return queryAll(db.select().from(supportedNetworks).limit(limit).offset(offset));
  },

  async findNetworkByChainId(chainId: number): Promise<SupportedNetwork | undefined> {
    return queryOne(
      db.select().from(supportedNetworks).where(eq(supportedNetworks.chainId, chainId)),
    );
  },

  async findNetworkById(id: number): Promise<SupportedNetwork | undefined> {
    return queryOne(db.select().from(supportedNetworks).where(eq(supportedNetworks.id, id)));
  },

  async createNetwork(data: NewSupportedNetwork): Promise<SupportedNetwork> {
    return returningOne(db.insert(supportedNetworks).values(data));
  },

  async updateNetwork(
    id: number,
    data: Partial<SupportedNetwork>,
  ): Promise<SupportedNetwork | undefined> {
    return returningOne(
      db
        .update(supportedNetworks)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(supportedNetworks.id, id)),
    );
  },

  async deleteNetwork(id: number): Promise<void> {
    await exec(db.delete(supportedNetworks).where(eq(supportedNetworks.id, id)));
  },

  // ── Allowed Tokens ──────────────────────────────────────────────────

  async findEnabledTokens(): Promise<AllowedToken[]> {
    return queryAll(db.select().from(allowedTokens).where(eq(allowedTokens.enabled, true)));
  },

  async findAllTokens(limit = 200, offset = 0): Promise<AllowedToken[]> {
    return queryAll(db.select().from(allowedTokens).limit(limit).offset(offset));
  },

  async findTokenBySymbolAndNetwork(
    symbol: string,
    network: string,
  ): Promise<AllowedToken | undefined> {
    return queryOne(
      db
        .select()
        .from(allowedTokens)
        .where(and(eq(allowedTokens.symbol, symbol), eq(allowedTokens.network, network))),
    );
  },

  async findTokenById(id: number): Promise<AllowedToken | undefined> {
    return queryOne(db.select().from(allowedTokens).where(eq(allowedTokens.id, id)));
  },

  async createToken(data: NewAllowedToken): Promise<AllowedToken> {
    return returningOne(db.insert(allowedTokens).values(data));
  },

  async updateToken(id: number, data: Partial<AllowedToken>): Promise<AllowedToken | undefined> {
    return returningOne(
      db
        .update(allowedTokens)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(allowedTokens.id, id)),
    );
  },

  async deleteToken(id: number): Promise<void> {
    await exec(db.delete(allowedTokens).where(eq(allowedTokens.id, id)));
  },

  async deleteTokensByNetwork(networkId: string): Promise<void> {
    await exec(db.delete(allowedTokens).where(eq(allowedTokens.network, networkId)));
  },

  /**
   * Returns enabled tokens filtered to only those whose network is also enabled.
   * Combines findEnabledNetworks + findEnabledTokens in one call to avoid duplication.
   */
  async findAllowedTokens(): Promise<AllowedToken[]> {
    const enabledNetworkIds = (await this.findEnabledNetworks()).map((n) => n.networkId);
    const tokens = await this.findEnabledTokens();
    return tokens.filter((t) => enabledNetworkIds.includes(t.network));
  },

  async findEnabledUsdcDepositNetworks(): Promise<
    Array<SupportedNetwork & { usdcAddress: string }>
  > {
    const networks = await this.findEnabledNetworks();
    const usdcTokens = (await this.findEnabledTokens()).filter(
      (token) => token.symbol === "USDC" && !!token.contractAddress,
    );
    const usdcByNetwork = new Map(
      usdcTokens.map((token) => [token.network, token.contractAddress]),
    );

    return networks
      .map((network) => {
        const usdcAddress = usdcByNetwork.get(network.networkId);
        return usdcAddress ? { ...network, usdcAddress } : null;
      })
      .filter((network): network is SupportedNetwork & { usdcAddress: string } => network !== null);
  },
};
