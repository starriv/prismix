/**
 * MCP Gateway — exposes AI relay capabilities as MCP tools over HTTP.
 *
 * Provides a lightweight MCP-compatible JSON-RPC endpoint that AI agents
 * can connect to for model interaction, discovery, and usage tracking.
 *
 * Tools exposed:
 * - chat_completion: proxy a chat completion request through the relay
 * - list_models: discover available models with capabilities and pricing
 * - check_usage: get usage summary
 *
 * Transport: HTTP POST with JSON-RPC 2.0 (not stdio — suitable for server deployment).
 */
import { Hono } from "hono";
import { match } from "ts-pattern";

import { log } from "@/server/lib/logger";
import { getAdminSession } from "@/server/middleware/auth";
import { aiKeyRepo, aiModelRepo, aiProviderRepo, aiUsageLogRepo } from "@/server/repos";

const mcp = new Hono();

// ── Tool Definitions ─────────────────────────────────────────────────

const TOOLS = [
  {
    name: "check_model",
    description: "Check if a model is available and get its relay endpoint info",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Model ID (e.g., gpt-4o, claude-sonnet-4-20250514)" },
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string", enum: ["system", "user", "assistant"] },
              content: { type: "string" },
            },
            required: ["role", "content"],
          },
          description: "Chat messages",
        },
        max_tokens: { type: "number", description: "Maximum tokens to generate" },
        temperature: { type: "number", description: "Sampling temperature (0-2)" },
      },
      required: ["model", "messages"],
    },
  },
  {
    name: "list_models",
    description: "List available AI models with capabilities and pricing",
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description: "Filter by capability (e.g., chat, vision, tools)",
        },
      },
    },
  },
  {
    name: "check_usage",
    description: "Get AI usage summary",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── JSON-RPC Handler ─────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

mcp.post("/", async (c) => {
  let req: JsonRpcRequest;
  try {
    req = (await c.req.json()) as JsonRpcRequest;
  } catch {
    return c.json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
  }

  if (req.jsonrpc !== "2.0" || !req.method) {
    return c.json({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Invalid Request" },
      id: req.id ?? null,
    });
  }

  // Verify admin session (auth middleware applied by parent)
  getAdminSession(c);

  try {
    const result = await handleMethod(req.method, req.params ?? {});
    return c.json({ jsonrpc: "2.0", result, id: req.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as Record<string, unknown>)?.code as number | undefined;
    log.gateway.error({ err, method: req.method }, "MCP gateway error");
    return c.json({
      jsonrpc: "2.0",
      error: { code: code ?? -32603, message },
      id: req.id,
    });
  }
});

export default mcp;

// ── Method Dispatch ──────────────────────────────────────────────────

async function handleMethod(method: string, params: Record<string, unknown>): Promise<unknown> {
  return match(method)
    .with("tools/list", () => ({ tools: TOOLS }))
    .with("tools/call", () => handleToolCall(params))
    .with("initialize", () => ({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "prismix-ai-relay", version: "1.0.0" },
    }))
    .with("notifications/initialized", "notifications/cancelled", () => ({}))
    .with("ping", () => ({}))
    .otherwise((m) => {
      throw Object.assign(new Error(`Method not found: ${m}`), { code: -32601 });
    });
}

async function handleToolCall(params: Record<string, unknown>): Promise<unknown> {
  const toolName = params.name as string;
  const args = (params.arguments as Record<string, unknown>) ?? {};

  return match(toolName)
    .with("check_model", async () => {
      const model = args.model as string;
      if (!model) return { content: [{ type: "text", text: "Error: model is required" }] };

      const messages = args.messages as Array<{ role: string; content: string }>;
      if (!messages?.length)
        return { content: [{ type: "text", text: "Error: messages are required" }] };

      const result = await aiModelRepo.findEnabledByModelId(model);
      if (!result) return { content: [{ type: "text", text: `Model "${model}" not found` }] };

      return {
        content: [
          {
            type: "text",
            text: `Model "${model}" is available via provider "${result.provider.providerId}". Use the relay endpoint POST /api/admin/ai/relay/v1/chat/completions to send requests.`,
          },
        ],
      };
    })
    .with("list_models", async () => {
      const providers = await aiProviderRepo.findAllEnabled();
      const keys = await aiKeyRepo.findAll();
      const keyProviderIds = new Set(keys.filter((k) => k.enabled).map((k) => k.providerId));

      const models = [];
      for (const provider of providers) {
        const providerModels = await aiModelRepo.findEnabledByProviderId(provider.id);
        for (const m of providerModels) {
          const caps = JSON.parse(m.capabilities) as string[];
          const capFilter = args.capability as string | undefined;
          if (capFilter && !caps.includes(capFilter)) continue;

          models.push({
            modelId: m.modelId,
            provider: provider.providerId,
            capabilities: caps,
            inputPrice: m.inputPrice,
            outputPrice: m.outputPrice,
            hasKey: keyProviderIds.has(provider.id),
          });
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(models, null, 2) }],
      };
    })
    .with("check_usage", async () => {
      const summary = await aiUsageLogRepo.summary();
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    })
    .otherwise((name) => ({
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    }));
}
