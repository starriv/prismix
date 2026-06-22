import crypto from "crypto";

import type { OpenAIChatBody, OpenAIChatMessage, OpenAIChatResponse } from "../providers/types";
import type {
  ClientProtocolAdapter,
  ClientProtocolRequestResult,
  ClientStreamTransformer,
  StreamOutputEvent,
} from "./types";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<Record<string, unknown>>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop_sequences?: string[];
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown> | string;
}

interface OpenAIStreamChoice {
  index?: number;
  delta?: {
    role?: string;
    content?: string | null;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
}

interface OpenAIStreamChunk {
  id?: string;
  model?: string;
  choices?: OpenAIStreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAnthropicMessage(value: unknown): value is AnthropicMessage {
  if (!isRecord(value)) return false;
  if (value.role !== "user" && value.role !== "assistant") return false;
  return typeof value.content === "string" || Array.isArray(value.content);
}

function parseRequest(raw: unknown): AnthropicRequest | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.model !== "string" || raw.model.trim() === "") return null;
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) return null;
  if (!raw.messages.every(isAnthropicMessage)) return null;

  return raw as unknown as AnthropicRequest;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (!isRecord(block)) return "";
      if (block.type === "text" && typeof block.text === "string") return block.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeSystem(system: AnthropicRequest["system"]): string | null {
  if (!system) return null;
  const text = contentToText(system);
  return text.trim() ? text : null;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapTools(tools: AnthropicRequest["tools"]): OpenAITool[] | undefined {
  if (!tools?.length) return undefined;

  return tools
    .filter((tool) => typeof tool.name === "string" && tool.name.trim() !== "")
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name as string,
        description: typeof tool.description === "string" ? tool.description : undefined,
        parameters: isRecord(tool.input_schema) ? tool.input_schema : { type: "object" },
      },
    }));
}

function mapToolChoice(choice: AnthropicRequest["tool_choice"]): unknown {
  if (!choice) return undefined;
  if (typeof choice === "string") return choice === "any" ? "required" : choice;
  if (!isRecord(choice)) return undefined;

  if (choice.type === "auto") return "auto";
  if (choice.type === "any") return "required";
  if (choice.type === "none") return "none";
  if (choice.type === "tool" && typeof choice.name === "string") {
    return { type: "function", function: { name: choice.name } };
  }
  return undefined;
}

function mapAnthropicMessages(messages: AnthropicMessage[]): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [];

  for (const message of messages) {
    if (typeof message.content === "string") {
      result.push({ role: message.role, content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: unknown[] = [];

      for (const block of message.content) {
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text);
        } else if (block.type === "tool_use" && typeof block.name === "string") {
          toolCalls.push({
            id: typeof block.id === "string" ? block.id : `toolu_${toolCalls.length}`,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(parseJsonObject(block.input)),
            },
          });
        }
      }

      result.push({
        role: "assistant",
        content: textParts.length > 0 ? textParts.join("") : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    const textParts: string[] = [];
    const flushText = () => {
      if (textParts.length === 0) return;
      result.push({ role: "user", content: textParts.join("\n") });
      textParts.length = 0;
    };

    for (const block of message.content) {
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      } else if (block.type === "tool_result") {
        flushText();
        const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
        result.push({
          role: "tool",
          tool_call_id: toolUseId,
          content: contentToText(block.content),
        });
      }
    }

    flushText();
  }

  return result;
}

function mapOpenAIStopReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason === "stop") return "end_turn";
  if (reason === "length") return "max_tokens";
  if (reason === "tool_calls") return "tool_use";
  if (reason === "content_filter") return "stop_sequence";
  return reason;
}

function normalizeMessageId(id: string | undefined): string {
  if (!id) return `msg_${crypto.randomUUID().replace(/-/g, "")}`;
  return id.startsWith("msg_") ? id : `msg_${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function textFromOpenAIContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

export const anthropicClientProtocolAdapter: ClientProtocolAdapter = {
  format: "anthropic",

  transformRequest(raw: unknown): ClientProtocolRequestResult {
    const request = parseRequest(raw);
    if (!request) {
      return {
        ok: false,
        statusCode: 400,
        error: "Invalid Anthropic Messages request body",
      };
    }

    const messages = mapAnthropicMessages(request.messages);
    const system = normalizeSystem(request.system);
    if (system) messages.unshift({ role: "system", content: system });
    if (messages.length === 0) {
      return {
        ok: false,
        statusCode: 400,
        error: "Anthropic request must contain at least one text or tool message",
      };
    }

    const tools = mapTools(request.tools);
    const toolChoice = mapToolChoice(request.tool_choice);
    const body: OpenAIChatBody = {
      model: request.model,
      messages,
      stream: request.stream === true,
      ...(typeof request.max_tokens === "number" ? { max_tokens: request.max_tokens } : {}),
      ...(typeof request.temperature === "number" ? { temperature: request.temperature } : {}),
      ...(typeof request.top_p === "number" ? { top_p: request.top_p } : {}),
      ...(request.stop_sequences?.length ? { stop: request.stop_sequences } : {}),
      ...(tools?.length ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    };

    return { ok: true, body };
  },

  transformResponse(response: OpenAIChatResponse): unknown {
    const choice = response.choices[0];
    const message = choice?.message;
    const contentBlocks: Array<Record<string, unknown>> = [];
    const text = textFromOpenAIContent(message?.content);

    if (text.length > 0) {
      contentBlocks.push({ type: "text", text });
    }

    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    for (const rawToolCall of toolCalls) {
      if (!isRecord(rawToolCall)) continue;
      const fn = isRecord(rawToolCall.function) ? rawToolCall.function : {};
      if (typeof fn.name !== "string") continue;
      contentBlocks.push({
        type: "tool_use",
        id: typeof rawToolCall.id === "string" ? rawToolCall.id : `toolu_${contentBlocks.length}`,
        name: fn.name,
        input: parseJsonObject(fn.arguments),
      });
    }

    if (contentBlocks.length === 0) {
      contentBlocks.push({ type: "text", text: "" });
    }

    return {
      id: normalizeMessageId(response.id),
      type: "message",
      role: "assistant",
      model: response.model,
      content: contentBlocks,
      stop_reason: mapOpenAIStopReason(choice?.finish_reason),
      stop_sequence: null,
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
      },
    };
  },

  createStreamTransformer(model: string): ClientStreamTransformer {
    return createAnthropicStreamTransformer(model);
  },
};

export function estimateAnthropicInputTokens(body: OpenAIChatBody): number {
  const serializedLength =
    body.messages.reduce((sum, message) => sum + estimateContentLength(message.content), 0) +
    estimateContentLength(body.tools) +
    estimateContentLength(body.tool_choice) +
    estimateContentLength(body.stop);

  return Math.max(1, Math.ceil(serializedLength / 4) + body.messages.length * 4);
}

function estimateContentLength(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function createAnthropicStreamTransformer(defaultModel: string): ClientStreamTransformer {
  const state = {
    messageStarted: false,
    messageId: "",
    model: defaultModel,
    nextBlockIndex: 0,
    textBlockIndex: null as number | null,
    textBlockStarted: false,
    toolBlocks: new Map<number, { blockIndex: number; id: string; name: string }>(),
    stopReason: "end_turn" as string | null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };

  const ensureMessageStart = (chunk?: OpenAIStreamChunk): StreamOutputEvent[] => {
    if (state.messageStarted) return [];
    state.messageStarted = true;
    state.messageId = normalizeMessageId(chunk?.id);
    state.model = chunk?.model ?? defaultModel;
    return [
      {
        event: "message_start",
        data: JSON.stringify({
          type: "message_start",
          message: {
            id: state.messageId,
            type: "message",
            role: "assistant",
            model: state.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: state.usage.input_tokens, output_tokens: 0 },
          },
        }),
      },
    ];
  };

  const ensureTextBlock = (): StreamOutputEvent[] => {
    if (state.textBlockStarted) return [];
    state.textBlockStarted = true;
    state.textBlockIndex = state.nextBlockIndex++;
    return [
      {
        event: "content_block_start",
        data: JSON.stringify({
          type: "content_block_start",
          index: state.textBlockIndex,
          content_block: { type: "text", text: "" },
        }),
      },
    ];
  };

  const ensureToolBlock = (
    openAiIndex: number,
    id?: string,
    name?: string,
  ): StreamOutputEvent[] => {
    const existing = state.toolBlocks.get(openAiIndex);
    if (existing) return [];

    const block = {
      blockIndex: state.nextBlockIndex++,
      id: id ?? `toolu_${openAiIndex}`,
      name: name ?? "",
    };
    state.toolBlocks.set(openAiIndex, block);
    return [
      {
        event: "content_block_start",
        data: JSON.stringify({
          type: "content_block_start",
          index: block.blockIndex,
          content_block: {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: {},
          },
        }),
      },
    ];
  };

  return {
    transformEvent(openAiEventData: string): StreamOutputEvent[] {
      let chunk: OpenAIStreamChunk;
      try {
        chunk = JSON.parse(openAiEventData) as OpenAIStreamChunk;
      } catch {
        return [];
      }

      const out: StreamOutputEvent[] = [];
      if (chunk.usage) {
        state.usage = {
          input_tokens: chunk.usage.prompt_tokens ?? state.usage.input_tokens,
          output_tokens: chunk.usage.completion_tokens ?? state.usage.output_tokens,
        };
      }

      for (const choice of chunk.choices ?? []) {
        if (choice.finish_reason) state.stopReason = mapOpenAIStopReason(choice.finish_reason);

        const content = choice.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          out.push(...ensureMessageStart(chunk));
          out.push(...ensureTextBlock());
          out.push({
            event: "content_block_delta",
            data: JSON.stringify({
              type: "content_block_delta",
              index: state.textBlockIndex,
              delta: { type: "text_delta", text: content },
            }),
          });
        }

        for (const toolCall of choice.delta?.tool_calls ?? []) {
          const openAiIndex = toolCall.index ?? 0;
          out.push(...ensureMessageStart(chunk));
          out.push(...ensureToolBlock(openAiIndex, toolCall.id, toolCall.function?.name));

          const block = state.toolBlocks.get(openAiIndex);
          const partialJson = toolCall.function?.arguments;
          if (block && typeof partialJson === "string" && partialJson.length > 0) {
            out.push({
              event: "content_block_delta",
              data: JSON.stringify({
                type: "content_block_delta",
                index: block.blockIndex,
                delta: { type: "input_json_delta", partial_json: partialJson },
              }),
            });
          }
        }
      }

      return out;
    },

    transformDone(): StreamOutputEvent[] {
      const out: StreamOutputEvent[] = [];
      out.push(...ensureMessageStart());

      if (!state.textBlockStarted && state.toolBlocks.size === 0) {
        out.push(...ensureTextBlock());
      }

      if (state.textBlockStarted && state.textBlockIndex !== null) {
        out.push({
          event: "content_block_stop",
          data: JSON.stringify({
            type: "content_block_stop",
            index: state.textBlockIndex,
          }),
        });
      }

      for (const block of state.toolBlocks.values()) {
        out.push({
          event: "content_block_stop",
          data: JSON.stringify({
            type: "content_block_stop",
            index: block.blockIndex,
          }),
        });
      }

      out.push({
        event: "message_delta",
        data: JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: state.stopReason ?? "end_turn", stop_sequence: null },
          usage: { output_tokens: state.usage.output_tokens },
        }),
      });
      out.push({ event: "message_stop", data: JSON.stringify({ type: "message_stop" }) });
      return out;
    },
  };
}
