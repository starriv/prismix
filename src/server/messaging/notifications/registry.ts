import type { ChannelType, NotificationChannel } from "./channel";

const channels = new Map<ChannelType, NotificationChannel>();

export function registerChannel(channel: NotificationChannel): void {
  channels.set(channel.name, channel);
}

export function getChannel(name: ChannelType): NotificationChannel | undefined {
  return channels.get(name);
}

export function listChannels(): NotificationChannel[] {
  return [...channels.values()];
}
