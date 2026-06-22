import type { ClientFormat } from "../lib/client-format";
import type { OpenAIChatBody, OpenAIChatResponse } from "../providers/types";

export type ClientProtocolRequestResult =
  | { ok: true; body: OpenAIChatBody }
  | { ok: false; statusCode: 400; error: string };

export interface StreamOutputEvent {
  event?: string;
  data: string;
}

export interface ClientStreamTransformer {
  transformEvent(openAiEventData: string): StreamOutputEvent[];
  transformDone(): StreamOutputEvent[];
}

export interface ClientProtocolAdapter {
  readonly format: ClientFormat;
  transformRequest(body: unknown): ClientProtocolRequestResult;
  transformResponse(body: OpenAIChatResponse): unknown;
  createStreamTransformer(model: string): ClientStreamTransformer;
}
