import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { del, get, post, put } from "./client";
import {
  API_NOTIFICATION_CONFIGS,
  API_NOTIFICATION_EVENTS,
  API_NOTIFICATION_LOGS,
  apiNotificationConfigDetail,
  apiNotificationConfigTest,
  DEFAULT_PAGE_SIZE,
} from "./constants";
import { queryKeys } from "./query-keys";
import type { CreateNotificationConfigBody, UpdateNotificationConfigBody } from "./schemas";
import {
  notificationConfigSchema,
  notificationEventsResponseSchema,
  notificationLogSchema,
} from "./schemas";

const paginatedNotificationLogsSchema = z.object({
  items: z.array(notificationLogSchema),
  total: z.number(),
});

// ── Notifications ─────────────────────────────────────────────────────

export function useNotificationEvents() {
  return useQuery({
    queryKey: queryKeys.notificationEvents(),
    queryFn: () => get(API_NOTIFICATION_EVENTS, notificationEventsResponseSchema),
  });
}

export function useNotificationConfigs() {
  return useQuery({
    queryKey: queryKeys.notificationConfigs(),
    queryFn: () => get(API_NOTIFICATION_CONFIGS, z.array(notificationConfigSchema)),
  });
}

export function useCreateNotificationConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateNotificationConfigBody) =>
      post(API_NOTIFICATION_CONFIGS, body, notificationConfigSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notificationConfigs() });
    },
  });
}

export function useUpdateNotificationConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateNotificationConfigBody & { id: number }) =>
      put(apiNotificationConfigDetail(id), body, notificationConfigSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notificationConfigs() });
    },
  });
}

export function useDeleteNotificationConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      del(apiNotificationConfigDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notificationConfigs() });
    },
  });
}

export function useTestNotificationConfig() {
  return useMutation({
    mutationFn: (id: number) =>
      post(
        apiNotificationConfigTest(id),
        {},
        z.object({ success: z.boolean(), message: z.string() }),
      ),
  });
}

export function useNotificationLogs(params?: {
  event?: string;
  channel?: string;
  status?: string;
  page?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.event) searchParams.set("event", params.event);
  if (params?.channel) searchParams.set("channel", params.channel);
  if (params?.status) searchParams.set("status", params.status);
  searchParams.set("limit", String(DEFAULT_PAGE_SIZE));
  searchParams.set("offset", String((params?.page ?? 0) * DEFAULT_PAGE_SIZE));
  const url = `${API_NOTIFICATION_LOGS}?${searchParams}`;

  return useQuery({
    queryKey: queryKeys.notificationLogs(params),
    queryFn: () => get(url, paginatedNotificationLogsSchema),
    placeholderData: keepPreviousData,
  });
}
