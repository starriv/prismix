import type { Hono } from "hono";

import admin from "../admin/routes/admin";
import adminAnnouncements from "../admin/routes/admin-announcements";
import adminAuth from "../admin/routes/admin-auth";
import adminConfig from "../admin/routes/admin-config";
import adminNetworks from "../admin/routes/admin-networks";
import adminTokens from "../admin/routes/admin-tokens";
import adminUsers from "../admin/routes/admin-users";
import adminKeyProviders from "../admin/routes/key-providers";
import adminPayAgents from "../admin/routes/pay-agents";
import {
  adminAiRouter,
  aiMcpRouter,
  aiRelayRouter,
  consumerKeyAuthMiddleware,
  consumerRelayRouter,
  relayKeysRouter,
} from "../ai";
import authRoutes from "../auth/routes/auth";
import { createRefreshToken, signAccessToken } from "../lib/jwt";
import { adminAuthMiddleware, userAuthMiddleware } from "../middleware/auth";
import { idempotencyGuard } from "../middleware/idempotency";
import userRoutes from "../user/routes/user";
import events from "./events";
import health from "./health";

export function registerRoutes(app: Hono) {
  // ── Public (no auth) ──────────────────────────────
  app.route("/api", health);
  app.route("/api/auth", authRoutes);
  app.route("/api/admin-auth", adminAuth);

  // ── Dev-only test token endpoint ───────────────────
  // Double guard: NODE_ENV + explicit DEV_SECRET to prevent accidental exposure
  if (process.env.NODE_ENV === "development" && process.env.DEV_SECRET) {
    app.post("/api/dev/admin-token", async (c) => {
      const token = await signAccessToken({ userId: 1, address: "0xtest", role: "admin" });
      const refreshToken = await createRefreshToken(1, "0xtest", "admin");
      return c.json({ token, refreshToken });
    });
  }

  // ── AI Gateway endpoint (consumerKeyAuthMiddleware) ───────
  app.use("/api/gateway/ai/*", consumerKeyAuthMiddleware);
  app.route("/api/gateway/ai/endpoint", consumerRelayRouter);

  // ── SSE Events (token checked internally) ─────────
  app.route("/api/events", events);

  // ── Admin (adminAuthMiddleware) ───────────────────
  app.use("/api/admin/*", adminAuthMiddleware);
  app.use("/api/admin/*", idempotencyGuard());
  app.route("/api/admin", admin);
  app.route("/api/admin", adminUsers);
  app.route("/api/admin", adminTokens);
  app.route("/api/admin", adminNetworks);
  app.route("/api/admin", adminConfig);
  app.route("/api/admin", adminAnnouncements);
  app.route("/api/admin/pay-agents", adminPayAgents);
  app.route("/api/admin/key-providers", adminKeyProviders);

  // ── User portal (userAuthMiddleware) ──────────────
  app.use("/api/user/*", userAuthMiddleware);
  app.route("/api/user", userRoutes);

  // ── AI (admin auth) ────────────────────────────
  app.route("/api/admin/ai", adminAiRouter);
  app.route("/api/admin/ai/relay", aiRelayRouter);
  app.route("/api/admin/ai/mcp", aiMcpRouter);
  app.route("/api/admin/relay-keys", relayKeysRouter);
}
