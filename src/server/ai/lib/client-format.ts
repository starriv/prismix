export const CLIENT_FORMATS = ["openai", "anthropic"] as const;

export type ClientFormat = (typeof CLIENT_FORMATS)[number];

export function isNativePassthroughEndpoint(
  clientFormat: ClientFormat,
  endpointApiFormat: string,
): boolean {
  if (clientFormat === "anthropic") return endpointApiFormat === "anthropic";
  return endpointApiFormat === "openai" || endpointApiFormat === "azure-openai";
}

export function canServeClientFormat(
  clientFormat: ClientFormat,
  endpointApiFormat: string,
): boolean {
  // OpenAI chat/completions can still use adapters for Anthropic, Gemini, and Bedrock sources.
  if (clientFormat === "openai") return true;
  return ["anthropic", "openai", "azure-openai"].includes(endpointApiFormat);
}
