export const AI_API_FORMATS = ["openai", "anthropic", "gemini", "azure-openai", "bedrock"] as const;

export type AiApiFormat = (typeof AI_API_FORMATS)[number];
