import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { del, get, post, put } from "./client";
import {
  API_PAY_AGENT_SYNC_ALL,
  API_PAY_AGENT_TXNS,
  API_PAY_AGENTS,
  API_TOPUP_ORDERS,
  apiPayAgentDebit,
  apiPayAgentDetail,
  apiPayAgentManualTopup,
  apiPayAgentResources,
  apiPayAgentSync,
  apiPayAgentTopup,
  apiPayAgentTxns,
  apiTopupOrderConfirm,
  apiTopupOrderReject,
  DEFAULT_PAGE_SIZE,
} from "./constants";
import { queryKeys } from "./query-keys";
import {
  type ConfirmTopupBody,
  type CreateAgentBody,
  type ManualTopupBody,
  type PayAgent,
  payAgentSchema,
  payAgentTransactionSchema,
  type RejectTopupBody,
  topUpOrderListSchema,
  topUpOrderSchema,
  type UpdateAgentBody,
} from "./schemas";

// ── Pay Agents ────────────────────────────────────────────────────────

export function usePayAgents() {
  return useQuery<PayAgent[]>({
    queryKey: queryKeys.payAgents(),
    queryFn: () => get(API_PAY_AGENTS, z.array(payAgentSchema)),
  });
}

export function useCreatePayAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAgentBody) => post(API_PAY_AGENTS, body, payAgentSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.payAgents() });
    },
  });
}

export function useUpdatePayAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAgentBody) => put(apiPayAgentDetail(body.id), body, payAgentSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.payAgents() });
    },
  });
}

export function useDeletePayAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiPayAgentDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.payAgents() });
    },
  });
}

export function useTopupPayAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      txHash,
      network,
    }: {
      agentId: number;
      txHash: string;
      network: string;
    }) => post(apiPayAgentTopup(agentId), { txHash, network }, payAgentSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.payAgents() });
    },
  });
}

export function useManualTopupPayAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, ...body }: ManualTopupBody & { agentId: number }) =>
      post(apiPayAgentManualTopup(agentId), body, payAgentSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.payAgents() });
    },
  });
}

export function useDebitPayAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, ...body }: ManualTopupBody & { agentId: number }) =>
      post(apiPayAgentDebit(agentId), body, payAgentSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.payAgents() });
    },
  });
}

export function useSyncPayAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: number) => post(apiPayAgentSync(agentId), {}, payAgentSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.payAgents() });
    },
  });
}

const syncAllResultSchema = z.object({
  synced: z.number(),
  failed: z.number(),
  errors: z.array(z.string()),
});

export function useSyncAllAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post(API_PAY_AGENT_SYNC_ALL, {}, syncAllResultSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.payAgents() });
      qc.invalidateQueries({ queryKey: queryKeys.payAgentTxnsAll() });
    },
  });
}

export function usePayAgentTransactions(agentId: number | null) {
  return useQuery({
    queryKey: queryKeys.payAgentTransactions(agentId ?? 0),
    queryFn: () => get(apiPayAgentTxns(agentId!), z.array(payAgentTransactionSchema)),
    enabled: agentId !== null,
  });
}

export function usePayAgentTxnsList(params: {
  agentId?: number;
  type?: string;
  source?: string;
  page?: number;
}) {
  const qp = new URLSearchParams();
  if (params.agentId) qp.set("agentId", String(params.agentId));
  if (params.type) qp.set("type", params.type);
  if (params.source) qp.set("source", params.source);
  qp.set("limit", String(DEFAULT_PAGE_SIZE));
  qp.set("offset", String((params.page ?? 0) * DEFAULT_PAGE_SIZE));
  const url = `${API_PAY_AGENT_TXNS}?${qp}`;
  return useQuery({
    queryKey: queryKeys.payAgentTxnsList(params),
    queryFn: () => get(url, z.array(payAgentTransactionSchema)),
    placeholderData: keepPreviousData,
  });
}

export function usePayAgentResources(agentId: number | null) {
  return useQuery({
    queryKey: queryKeys.payAgentResources(agentId ?? 0),
    queryFn: () =>
      get(
        apiPayAgentResources(agentId!),
        z.array(
          z.object({ id: z.number(), name: z.string(), path: z.string(), price: z.string() }),
        ),
      ),
    enabled: agentId !== null,
  });
}

// ── Top-up Orders ─────────────────────────────────────────────────────

export function useTopupOrders(params?: { status?: string; page?: number }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.page) {
    searchParams.set("limit", String(DEFAULT_PAGE_SIZE));
    searchParams.set("offset", String(params.page * DEFAULT_PAGE_SIZE));
  }
  const qs = searchParams.toString();
  const url = qs ? `${API_TOPUP_ORDERS}?${qs}` : API_TOPUP_ORDERS;

  return useQuery({
    queryKey: queryKeys.topupOrders(params),
    queryFn: () => get(url, topUpOrderListSchema),
    placeholderData: keepPreviousData,
  });
}

export function useConfirmTopupOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ConfirmTopupBody & { id: number }) =>
      put(apiTopupOrderConfirm(id), body, topUpOrderSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.topupOrdersAll() });
      qc.invalidateQueries({ queryKey: queryKeys.payAgents() });
    },
  });
}

export function useRejectTopupOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: RejectTopupBody & { id: number }) =>
      put(apiTopupOrderReject(id), body, topUpOrderSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.topupOrdersAll() });
    },
  });
}
