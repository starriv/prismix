import { z } from "zod";

// ── Auth — logged-in user info returned by /me ──────────────────

export const userInfoSchema = z.object({
  id: z.number(),
  uuid: z.string().nullable().optional(),
  address: z.string().nullable(),
  email: z.string().nullable(),
  avatar: z.string().nullable(),
  name: z.string(),
  agentId: z.number().nullable().optional(),
  status: z.number(), // 1=active, 2=disabled
  providers: z.array(z.string()).optional(), // identity providers (siwe, credentials, google, etc.)
  updatedAt: z.string().optional(),
  createdAt: z.string().optional(),
});
export type UserInfo = z.infer<typeof userInfoSchema>;

export const walletInfoSchema = z.object({
  agentId: z.number(),
  balance: z.string(),
  address: z.string().nullable(),
  status: z.string(),
});

export const adminUserDetailSchema = userInfoSchema.extend({
  wallet: walletInfoSchema.nullable(),
});
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;

/** @deprecated Use `userInfoSchema` / `UserInfo` instead */
export const merchantSchema = userInfoSchema;
/** @deprecated Use `UserInfo` instead */
export type MerchantInfo = UserInfo;

// ── Allowed Token ───────────────────────────────────────────────

export const allowedTokenSchema = z.object({
  id: z.number(),
  symbol: z.string(),
  network: z.string(),
  contractAddress: z.string(),
  decimals: z.number(),
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type AllowedToken = z.infer<typeof allowedTokenSchema>;

// ── Known Token (static registry from server) ───────────────────

export const knownTokenSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  decimals: z.number(),
  addresses: z.array(z.object({ networkId: z.string(), address: z.string() })),
});
export type KnownTokenInfo = z.infer<typeof knownTokenSchema>;

// ── Supported Network (from DB) ─────────────────────────────────

export const supportedNetworkSchema = z.object({
  id: z.number(),
  chainId: z.number(),
  networkId: z.string(),
  name: z.string(),
  shortName: z.string(),
  explorerUrl: z.string(),
  testnet: z.boolean(),
  iconUrl: z.string(),
  enabled: z.boolean(),
  rpcUrl: z.string(),
  createdAt: z.string(),
});
export type SupportedNetwork = z.infer<typeof supportedNetworkSchema>;

// ── Circle USDC network entry ───────────────────────────────────

export const circleNetworkEntrySchema = z.object({
  chainId: z.number(),
  name: z.string(),
  shortName: z.string(),
  explorerUrl: z.string(),
  testnet: z.boolean(),
  iconUrl: z.string(),
  alreadyAdded: z.boolean(),
});
export type CircleNetworkEntry = z.infer<typeof circleNetworkEntrySchema>;

// ── Auth Responses ──────────────────────────────────────────────

export const nonceResponseSchema = z.object({
  message: z.string(),
  nonce: z.string(),
});

export const verifyResponseSchema = z.object({
  token: z.string(),
  refreshToken: z.string(),
  user: userInfoSchema,
});

export const meResponseSchema = z.object({
  user: userInfoSchema,
});

// ── Admin Auth ──────────────────────────────────────────────────

export const adminInfoSchema = z.object({
  id: z.number(),
  address: z.string().nullable(),
  email: z.string().nullable(),
  name: z.string(),
});
export type AdminInfo = z.infer<typeof adminInfoSchema>;

export const adminVerifyResponseSchema = z.object({
  token: z.string(),
  refreshToken: z.string(),
  admin: adminInfoSchema,
});

export const adminMeResponseSchema = z.object({
  admin: adminInfoSchema,
});

export const refreshResponseSchema = z.object({
  token: z.string(),
});

export const authProvidersSchema = z.object({
  providers: z.array(z.string()),
});

export const exchangeResponseSchema = verifyResponseSchema;

// ── API Key ─────────────────────────────────────────────────────

export const apiKeySchema = z.object({
  id: z.number(),
  name: z.string(),
  clientId: z.string(),
  secretPrefix: z.string(),
  scopes: z.string().nullable(),
  status: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

// API Key with one-time secret (returned on create/rotate)
export const apiKeyWithSecretSchema = apiKeySchema.extend({
  secret: z.string(),
});
export type ApiKeyWithSecret = z.infer<typeof apiKeyWithSecretSchema>;

export const createApiKeyBody = z.object({
  name: z.string().min(1, "common.valid.name-required").max(100),
  expiresInDays: z.number().int().positive().max(365).optional(),
});
export type CreateApiKeyBody = z.infer<typeof createApiKeyBody>;

export const updateApiKeyBody = z.object({
  name: z.string().min(1, "common.valid.name-required").max(100),
});
export type UpdateApiKeyBody = z.infer<typeof updateApiKeyBody>;

// ── Fiat Configs ────────────────────────────────────────────────

export const fiatConfigSchema = z.object({
  id: z.number(),
  method: z.string(),
  displayName: z.string(),
  config: z.string(), // JSON string — parsed at component level
  enabled: z.coerce.boolean(),
  sortOrder: z.number(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type FiatConfig = z.infer<typeof fiatConfigSchema>;

export const createFiatConfigBody = z.object({
  method: z.enum(["bank_transfer", "alipay", "wechat", "paypal"]),
  displayName: z.string().min(1, "common.valid.name-required").max(100),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});
export type CreateFiatConfigBody = z.infer<typeof createFiatConfigBody>;

export const updateFiatConfigBody = z.object({
  id: z.number(),
  displayName: z.string().min(1, "common.valid.name-required").max(100).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateFiatConfigBody = z.infer<typeof updateFiatConfigBody>;

// ── Announcements ────────────────────────────────────────────────

export const announcementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable().optional(),
  status: z.string(),
  createdBy: z.string(),
  createdAt: z.string().or(z.number()),
  sentAt: z.string().or(z.number()).nullable(),
});
export type Announcement = z.infer<typeof announcementSchema>;

export const createAnnouncementBody = z.object({
  title: z.string().min(1, "common.valid.required").max(200),
  body: z.string().min(1, "common.valid.required").max(5000),
  link: z.string().url("common.valid.invalid-url").max(500).optional().or(z.literal("")),
});
export type CreateAnnouncementBody = z.infer<typeof createAnnouncementBody>;

export const updateAnnouncementBody = z.object({
  title: z.string().min(1, "common.valid.required").max(200).optional(),
  body: z.string().min(1, "common.valid.required").max(5000).optional(),
  link: z.string().url("common.valid.invalid-url").max(500).optional().or(z.literal("")),
});
export type UpdateAnnouncementBody = z.infer<typeof updateAnnouncementBody>;

// ── User Portal ────────────────────────────────────────────────

export const userPortalInfoSchema = z.object({
  id: z.number(),
  uuid: z.string().nullable().optional(),
  address: z.string().nullable(),
  email: z.string().nullable(),
  name: z.string(),
  avatar: z.string().nullable(),
  status: z.number(),
});
export type UserPortalInfo = z.infer<typeof userPortalInfoSchema>;

/** /api/auth/me returns { merchant: ... } — we alias to `user` in the hook layer */
export const userMeResponseSchema = z.object({
  user: userPortalInfoSchema,
});

/** /api/auth/:provider/authenticate returns { token, refreshToken, merchant: ... } */
export const userVerifyResponseSchema = z.object({
  token: z.string(),
  refreshToken: z.string(),
  user: userPortalInfoSchema,
});

export const userKeySchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable().optional(),
  apiKeyPrefix: z.string(),
  status: z.string(),
  markupPercent: z.number().nullable().optional(),
  rateLimitRpm: z.number().nullable().optional(),
  allowedModels: z.string(),
  expiresAt: z.string().nullable().optional(),
  lastUsedAt: z.string().nullable().optional(),
  createdAt: z.string().or(z.number()),
});
export type UserKey = z.infer<typeof userKeySchema>;

// ── User Wallet ────────────────────────────────────────────────

export const userWalletSchema = z.object({
  balance: z.string(),
  address: z.string().nullable(),
  agentId: z.number(),
  name: z.string(),
});
export type UserWallet = z.infer<typeof userWalletSchema>;

export const depositNetworkSchema = z.object({
  chainId: z.number(),
  networkId: z.string(),
  name: z.string(),
  usdcAddress: z.string(),
});

export const depositInfoSchema = z.object({
  address: z.string(),
  networks: z.array(depositNetworkSchema),
});
export type DepositInfo = z.infer<typeof depositInfoSchema>;

export const createWalletTopupBody = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  network: z.string(),
});
export type CreateWalletTopupBody = z.infer<typeof createWalletTopupBody>;

export const userWalletTopupOrderSchema = z.object({
  id: z.number(),
  agentId: z.number(),
  amount: z.string(),
  fiatAmount: z.string().nullable().optional(),
  fiatCurrency: z.string(),
  status: z.string(),
  paymentMethod: z.string().nullable().optional(),
  paymentProof: z.string().nullable().optional(),
  adminNote: z.string().nullable().optional(),
  network: z.string().nullable().optional(),
  toAddress: z.string().nullable().optional(),
  txHash: z.string().nullable().optional(),
  confirmedAt: z.string().or(z.number()).nullable().optional(),
  expiredAt: z.string().or(z.number()).nullable().optional(),
  expiresAt: z.string(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type UserWalletTopupOrder = z.infer<typeof userWalletTopupOrderSchema>;

export const userWalletTopupOrderListSchema = z.array(userWalletTopupOrderSchema);
export type UserWalletTopupOrderList = z.infer<typeof userWalletTopupOrderListSchema>;

export const verifyDepositResultSchema = z.object({
  success: z.boolean(),
  amount: z.string(),
  agentId: z.number(),
});

export const walletTransactionSchema = z.object({
  id: z.number(),
  agentId: z.number(),
  userId: z.number().nullable(),
  userUuid: z.string().nullable().optional(),
  type: z.string(),
  amount: z.string(),
  balanceBefore: z.string(),
  balanceAfter: z.string(),
  description: z.string().nullable(),
  txHash: z.string().nullable(),
  network: z.string().nullable(),
  source: z.string(),
  createdAt: z.string(),
});
export type WalletTransaction = z.infer<typeof walletTransactionSchema>;

// ── Withdraw Orders ─────────────────────────────────────────────

export const withdrawOrderSchema = z.object({
  id: z.number(),
  agentId: z.number(),
  userId: z.number().nullable(),
  userUuid: z.string().nullable().optional(),
  toAddress: z.string(),
  amount: z.string(),
  network: z.string(),
  status: z.string(),
  txHash: z.string().nullable(),
  fee: z.string().nullable(),
  failReason: z.string().nullable(),
  reviewedBy: z.number().nullable().optional(),
  reviewedAt: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
  createdAt: z.string(),
});
export type WithdrawOrder = z.infer<typeof withdrawOrderSchema>;

export const createWithdrawBody = z.object({
  toAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount: z.string().optional(),
  withdrawAll: z.boolean().optional(),
  network: z.string(),
});
export type CreateWithdrawBody = z.infer<typeof createWithdrawBody>;

export const verifyDepositBody = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  network: z.string(),
});
export type VerifyDepositBody = z.infer<typeof verifyDepositBody>;
