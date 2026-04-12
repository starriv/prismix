import { z } from "zod";

export const METHODS = ["bank_transfer", "alipay", "wechat", "paypal"] as const;
export type FiatMethod = (typeof METHODS)[number];

export const fiatConfigFormSchema = z.object({
  method: z.enum(["bank_transfer", "alipay", "wechat", "paypal"]),
  displayName: z.string().min(1, "fiat.valid.display-name-required").max(100),
  config: z.record(z.string(), z.string()),
  enabled: z.boolean(),
});

export type FiatConfigFormValues = z.infer<typeof fiatConfigFormSchema>;

export function safeParseConfig(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        result[k] = String(v ?? "");
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}
