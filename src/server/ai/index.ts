/**
 * AI Module barrel — single entry point for external consumers.
 *
 * Internal AI module files import each other via relative paths.
 * Everything outside `src/server/ai/` imports from this barrel.
 */

// ── Credential balancer ────────────────────────────────────────────────

export { invalidateCredentialPool } from "./lib/credential-balancer";

// ── Routes ──────────────────────────────────────────────────────────────

export { default as adminAiRouter } from "./routes/admin-ai";
export { default as adminAiEndpointsRouter } from "./routes/admin-ai-endpoints";
export { default as adminAiModelsRouter } from "./routes/admin-ai-models";
export { default as adminAiCredentialsRouter } from "./routes/admin-ai-credentials";
export { default as adminAiUpstreamsRouter } from "./routes/admin-ai-upstreams";
export { default as aiRelayRouter } from "./routes/relay";
export { default as aiMcpRouter } from "./routes/mcp";
export { consumerAnthropicRelayRouter, consumerOpenAiRelayRouter } from "./routes/consumer-relay";
export { default as relayKeysRouter } from "./routes/relay-keys";
export { consumerKeyAuthMiddleware } from "./middleware/consumer-key-auth";

export { initAiAdapters, initAiWriteHandlers } from "./init";
