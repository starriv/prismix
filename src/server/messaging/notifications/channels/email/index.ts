/**
 * Email notification channel — delegates to EmailProvider implementations.
 *
 * Provider selection based on admin config `provider` field:
 *   "smtp"   → SmtpEmailProvider (nodemailer)
 *   "resend" → ResendEmailProvider (Resend SDK)
 *
 * Adding a new email provider:
 *   1. Create src/server/notifications/channels/email/<name>.ts implementing EmailProvider
 *   2. Register it in the PROVIDERS map below
 *   3. Add admin UI config fields (if needed)
 */
import type { NotificationChannel, NotificationPayload } from "../../channel";
import type { EmailProvider } from "./provider";
import { ResendEmailProvider } from "./resend";
import { SmtpEmailProvider } from "./smtp";

const PROVIDERS = new Map<string, EmailProvider>([
  ["smtp", new SmtpEmailProvider()],
  ["resend", new ResendEmailProvider()],
]);

export class EmailChannel implements NotificationChannel {
  readonly name = "email" as const;

  async send(
    target: string,
    payload: NotificationPayload,
    options?: { providerConfig: Record<string, unknown> },
  ): Promise<void> {
    const config = options?.providerConfig;
    if (!config) throw new Error("Email provider config is required");

    const providerName = (config.provider as string) || "smtp";
    const provider = PROVIDERS.get(providerName);
    if (!provider) {
      throw new Error(
        `Unknown email provider: "${providerName}". Available: ${[...PROVIDERS.keys()].join(", ")}`,
      );
    }

    const from = `${(config.fromName as string) || "Prismix"} <${(config.fromAddress as string) || "noreply@prismix.app"}>`;

    await provider.send(
      {
        from,
        to: target,
        subject: `[${payload.event}] ${payload.title}`,
        text: payload.body,
        html: payload.html,
      },
      config,
    );
  }

  validateTarget(target: string): string | null {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(target) ? null : "Invalid email address format";
  }
}

export type { EmailProvider } from "./provider";
