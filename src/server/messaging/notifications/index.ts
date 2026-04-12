// ── Register ALL built-in notification channels ──────────────────────
// All channels are always registered. The "enabled" check is done at
// the dispatcher level via isChannelEnabled() from notification-provider-config.
import { EmailChannel } from "./channels/email";
import { TelegramChannel } from "./channels/telegram";
import { WebhookChannel } from "./channels/webhook";
import { registerChannel } from "./registry";

export type { ChannelType, NotificationChannel, NotificationPayload } from "./channel";
export { getChannel, listChannels, registerChannel } from "./registry";
export { emitNotification } from "./dispatcher";

registerChannel(new EmailChannel());
registerChannel(new TelegramChannel());
registerChannel(new WebhookChannel());
