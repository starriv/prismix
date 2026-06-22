export const CLIENT_FORMATS = ["openai", "anthropic"] as const;

export type ClientFormat = (typeof CLIENT_FORMATS)[number];

export function isClientFormat(value: string): value is ClientFormat {
  return (CLIENT_FORMATS as readonly string[]).includes(value);
}

export function defaultClientFormatForProvider(apiFormat: string): ClientFormat {
  return apiFormat === "anthropic" ? "anthropic" : "openai";
}

export function isNativePassthroughProvider(
  clientFormat: ClientFormat,
  providerApiFormat: string,
): boolean {
  if (clientFormat === "anthropic") return providerApiFormat === "anthropic";
  return providerApiFormat === "openai" || providerApiFormat === "azure-openai";
}

export function canAttachProviderToClientFormat(
  clientFormat: ClientFormat,
  providerApiFormat: string,
): boolean {
  // OpenAI chat/completions can still use adapters for Anthropic, Gemini, and Bedrock sources.
  if (clientFormat === "openai") return true;
  return providerApiFormat === "anthropic";
}
