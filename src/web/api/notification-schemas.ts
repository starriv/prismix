import { z } from "zod";

// ── Notifications ────────────────────────────────────────────────

export const notificationConfigSchema = z.object({
  id: z.number(),
  channel: z.string(),
  label: z.string(),
  target: z.string(),
  secret: z.string().nullable(),
  events: z.array(z.string()),
  enabled: z.coerce.boolean(),
  createdAt: z.string().or(z.number()),
  updatedAt: z.string().or(z.number()),
});
export type NotificationConfig = z.infer<typeof notificationConfigSchema>;

export const createNotificationConfigBody = z.object({
  channel: z.enum(["email", "telegram", "webhook", "whatsapp"]),
  label: z.string().max(100).default(""),
  target: z.string().min(1, "common.valid.required").max(500),
  secret: z.string().max(500).optional(),
  events: z.array(z.string().min(1)).min(1, "common.valid.required"),
  enabled: z.boolean().default(true),
});
export type CreateNotificationConfigBody = z.infer<typeof createNotificationConfigBody>;

export const updateNotificationConfigBody = z.object({
  label: z.string().max(100).optional(),
  target: z.string().min(1, "common.valid.required").max(500).optional(),
  secret: z.string().max(500).optional(),
  events: z.array(z.string().min(1)).min(1, "common.valid.required").optional(),
  enabled: z.boolean().optional(),
});
export type UpdateNotificationConfigBody = z.infer<typeof updateNotificationConfigBody>;

export const notificationEventGroupSchema = z.object({
  key: z.string(),
  events: z.array(z.string()),
});

export const notificationEventsResponseSchema = z.object({
  groups: z.array(notificationEventGroupSchema),
  enabledChannels: z.array(z.string()),
});
export type NotificationEventsResponse = z.infer<typeof notificationEventsResponseSchema>;

export const notificationLogSchema = z.object({
  id: z.number(),
  configId: z.number().nullable(),
  channel: z.string(),
  event: z.string(),
  target: z.string(),
  payload: z.string(),
  status: z.string(),
  attempts: z.number(),
  lastError: z.string().nullable(),
  createdAt: z.string().or(z.number()),
  sentAt: z.string().or(z.number()).nullable(),
});
export type NotificationLog = z.infer<typeof notificationLogSchema>;

// Admin notification providers config
export const notificationProvidersConfigSchema = z.record(
  z.string(),
  z.record(z.string(), z.unknown()),
);
export type NotificationProvidersConfig = z.infer<typeof notificationProvidersConfigSchema>;
