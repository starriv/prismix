/**
 * Resend email provider — sends via Resend SDK.
 *
 * @see https://resend.com/docs/send-with-nodejs
 */
import { Resend } from "resend";

import { log } from "@/server/lib/logger";

import type { EmailMessage, EmailProvider } from "./provider";

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  async send(message: EmailMessage, config: Record<string, unknown>): Promise<void> {
    const apiKey = config.resendApiKey as string;
    if (!apiKey) throw new Error("Resend API key not configured");

    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html ?? undefined,
    });

    if (error) {
      throw new Error(`Resend error: ${error.message}`);
    }

    log.notification.info({ to: message.to, provider: "resend" }, "Email sent via Resend");
  }
}
