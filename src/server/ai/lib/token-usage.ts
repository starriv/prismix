import type { TokenUsage } from "../protocol-adapters/types";

function numericField(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function extractTokenUsageFromUsageObject(
  usage: Record<string, unknown> | null | undefined,
  options?: { returnZeroWhenEmpty?: boolean },
): TokenUsage | null {
  if (!usage) return null;

  const prompt = numericField(usage, "prompt_tokens");
  const completion = numericField(usage, "completion_tokens");
  const input = numericField(usage, "input_tokens");
  const output = numericField(usage, "output_tokens");
  const cacheCreation = numericField(usage, "cache_creation_input_tokens") ?? 0;
  const cacheRead = numericField(usage, "cache_read_input_tokens") ?? 0;
  const completionDetails = usage.completion_tokens_details as Record<string, unknown> | undefined;
  const reasoningTokens =
    typeof completionDetails?.reasoning_tokens === "number"
      ? completionDetails.reasoning_tokens
      : 0;
  const reportedTotal = numericField(usage, "total_tokens") ?? numericField(usage, "totalTokens");

  let inputTokens =
    (prompt && prompt > 0 ? prompt : (input ?? prompt ?? 0)) + cacheCreation + cacheRead;
  let outputTokens = completion && completion > 0 ? completion : (output ?? completion ?? 0);

  if (reportedTotal !== undefined) {
    if (inputTokens === 0 && outputTokens > 0 && reportedTotal > outputTokens) {
      inputTokens = reportedTotal - outputTokens;
    } else if (outputTokens === 0 && inputTokens > 0 && reportedTotal > inputTokens) {
      outputTokens = reportedTotal - inputTokens;
    }
  }

  if (inputTokens === 0 && outputTokens === 0 && !options?.returnZeroWhenEmpty) return null;

  return {
    inputTokens,
    outputTokens,
    totalTokens: reportedTotal ?? inputTokens + outputTokens,
    cacheCreationInputTokens: cacheCreation || undefined,
    cacheReadInputTokens: cacheRead || undefined,
    reasoningTokens: reasoningTokens || undefined,
  };
}
