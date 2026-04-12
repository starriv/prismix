/**
 * EmailProvider — Strategy interface for email delivery backends.
 *
 * Each implementation handles a specific email service (SMTP, Resend, etc.).
 * The EmailChannel selects the provider based on admin config.
 */

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;

  /** Send an email. Throws on failure. */
  send(message: EmailMessage, config: Record<string, unknown>): Promise<void>;
}
