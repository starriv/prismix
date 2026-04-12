import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { del, get, post, put } from "./client";
import {
  API_WEBHOOK_EVENTS,
  API_WEBHOOKS,
  apiWebhookDeliveries,
  apiWebhookDeliveryRetry,
  apiWebhookDetail,
  apiWebhookRotateSecret,
  apiWebhookTest,
  DEFAULT_PAGE_SIZE,
} from "./constants";
import { queryKeys } from "./query-keys";
import type { CreateWebhookEndpointBody, UpdateWebhookEndpointBody } from "./schemas";
import {
  webhookDeliveryListSchema,
  webhookEndpointSchema,
  webhookEventsResponseSchema,
} from "./schemas";

// ── Webhooks ──────────────────────────────────────────────────────────

export function useWebhooks() {
  return useQuery({
    queryKey: queryKeys.webhooks(),
    queryFn: () => get(API_WEBHOOKS, z.array(webhookEndpointSchema)),
  });
}

export function useWebhookEvents() {
  return useQuery({
    queryKey: queryKeys.webhookEvents(),
    queryFn: () => get(API_WEBHOOK_EVENTS, webhookEventsResponseSchema),
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWebhookEndpointBody) =>
      post(API_WEBHOOKS, body, webhookEndpointSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.webhooks() });
    },
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateWebhookEndpointBody & { id: number }) =>
      put(apiWebhookDetail(id), body, webhookEndpointSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.webhooks() });
    },
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiWebhookDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.webhooks() });
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: (id: number) =>
      post(apiWebhookTest(id), {}, z.object({ success: z.boolean(), deliveryId: z.number() })),
  });
}

export function useRotateWebhookSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post(apiWebhookRotateSecret(id), {}, webhookEndpointSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.webhooks() });
    },
  });
}

export function useWebhookDeliveries(endpointId: number | null, page?: number) {
  const p = page ?? 0;
  const params = new URLSearchParams();
  params.set("limit", String(DEFAULT_PAGE_SIZE));
  params.set("offset", String(p * DEFAULT_PAGE_SIZE));
  const qs = params.toString();

  return useQuery({
    queryKey: queryKeys.webhookDeliveries(endpointId ?? 0, p),
    queryFn: () => get(`${apiWebhookDeliveries(endpointId!)}?${qs}`, webhookDeliveryListSchema),
    enabled: endpointId !== null,
    placeholderData: keepPreviousData,
  });
}

export function useRetryWebhookDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ endpointId, deliveryId }: { endpointId: number; deliveryId: number }) =>
      post(apiWebhookDeliveryRetry(endpointId, deliveryId), {}, z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.webhookDeliveriesAll() });
    },
  });
}
