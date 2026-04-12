/**
 * NotificationChannel — Strategy interface for notification delivery.
 *
 * Each channel (email, telegram, webhook, whatsapp) implements this
 * interface. Channels are registered unconditionally; the "enabled"
 * check happens at the dispatcher level via notification-provider-config.
 */

export type ChannelType = "email" | "telegram" | "webhook" | "whatsapp";

export interface NotificationPayload {
  event: string;
  title: string;
  body: string;
  html?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface NotificationChannel {
  readonly name: ChannelType;

  /** Send a notification to the given target. */
  send(
    target: string,
    payload: NotificationPayload,
    options?: {
      secret?: string; // decrypted webhook HMAC secret
      providerConfig: Record<string, unknown>; // decrypted global provider config
    },
  ): Promise<void>;

  /** Validate target format. Returns null if valid, error string if invalid. */
  validateTarget(target: string): string | null;
}
