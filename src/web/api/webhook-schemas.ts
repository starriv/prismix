import { z } from "zod";

// ── Webhook Endpoints ────────────────────────────────────────────

export const webhookEndpointSchema = z.object({
  id: z.number(),
  url: z.string(),
  description: z.string(),
  secret: z.string(), // masked on list, plain on create/rotate
  events: z.array(z.string()),
  status: z.string(), // active | paused | disabled
  failureCount: z.number(),
  lastFailureAt: z.string().or(z.number()).nullable().optional(),
  updatedAt: z.string().or(z.number()),
  createdAt: z.string().or(z.number()),
});
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

/** Returned on create / rotate — contains the one-time plain secret. */
export type WebhookEndpointWithSecret = WebhookEndpoint;

export const createWebhookEndpointBody = z.object({
  url: z.string().min(1, "webhook.valid.url-required").max(2048),
  description: z.string().max(200).default(""),
  events: z.array(z.string().min(1)).min(1, "webhook.valid.events-required"),
});
export type CreateWebhookEndpointBody = z.infer<typeof createWebhookEndpointBody>;

export const updateWebhookEndpointBody = z.object({
  url: z.string().min(1, "common.valid.required").max(2048).optional(),
  description: z.string().max(200).optional(),
  events: z.array(z.string().min(1)).min(1, "common.valid.required").optional(),
  status: z.enum(["active", "paused"]).optional(),
});
export type UpdateWebhookEndpointBody = z.infer<typeof updateWebhookEndpointBody>;

export const webhookEventGroupSchema = z.object({
  key: z.string(),
  events: z.array(z.string()),
});

export const webhookEventsResponseSchema = z.object({
  groups: z.array(webhookEventGroupSchema),
});
export type WebhookEventsResponse = z.infer<typeof webhookEventsResponseSchema>;

export const webhookDeliverySchema = z.object({
  id: z.number(),
  endpointId: z.number(),
  eventId: z.string(),
  eventType: z.string(),
  payload: z.string(),
  status: z.string(), // pending | success | failed
  attempts: z.number(),
  nextRetryAt: z.string().or(z.number()).nullable().optional(),
  responseStatus: z.number().nullable().optional(),
  responseBody: z.string().nullable().optional(),
  latencyMs: z.number().nullable().optional(),
  lastError: z.string().nullable().optional(),
  createdAt: z.string().or(z.number()),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export const webhookDeliveryListSchema = z.object({
  items: z.array(webhookDeliverySchema),
  total: z.number(),
});
