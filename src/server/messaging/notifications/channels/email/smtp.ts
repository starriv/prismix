/**
 * SMTP email provider — sends via nodemailer.
 */
import { log } from "@/server/lib/logger";

import type { EmailMessage, EmailProvider } from "./provider";

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";

  async send(message: EmailMessage, config: Record<string, unknown>): Promise<void> {
    const { createTransport } = await import("nodemailer");
    const transporter = createTransport({
      host: config.smtpHost as string,
      port: (config.smtpPort as number) || 587,
      secure: (config.smtpPort as number) === 465,
      auth: {
        user: config.smtpUser as string,
        pass: config.smtpPass as string,
      },
    });

    await transporter.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    log.notification.info({ to: message.to, provider: "smtp" }, "Email sent via SMTP");
  }
}
