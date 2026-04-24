/**
 * AI Usage Log repository — append-only writes + queries for `ai_usage_logs` table.
 */
import { and, count, desc, eq, gte, inArray, isNotNull, lt, lte, sql, sum } from "drizzle-orm";

import {
  type AiUsageLog,
  aiUsageLogs,
  db,
  exec,
  type NewAiUsageLog,
  queryAll,
  queryOne,
} from "@/server/db";

export interface AiUsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCost: number;
  errorCount: number;
  errorRate: number;
  byProvider: Array<{
    providerId: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
  }>;
  byModel: Array<{
    providerId: string;
    modelId: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
  }>;
}

export interface DailyUsageRow {
  date: string;
  requests: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface ConsumerKeyUsageRow {
  consumerKeyId: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface ErrorOverview {
  total4xx: number;
  total5xx: number;
  last24h4xx: number;
  last24h5xx: number;
  peak4xx: number;
  peak4xxDate: string | null;
  peak5xx: number;
  peak5xxDate: string | null;
}

export interface ErrorDailyRow {
  date: string;
  clientErrors: number;
  serverErrors: number;
  totalErrors: number;
}

export interface AiKeyUsageSummaryRow {
  keyId: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: string;
  upstreamCost: string;
}

export interface AiOwnerUsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: string;
  upstreamCost: string;
}

export interface UpstreamHourlyRow {
  hour: string;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  avgLatencyMs: number;
}

export interface UpstreamUsageOverviewRow {
  upstreamId: number;
  upstreamName: string | null;
  upstreamBaseUrl: string | null;
  requests24h: number;
  clientErrors24h: number;
  serverErrors24h: number;
  totalTokens24h: number;
  avgLatencyMs24h: number;
  lastSeenAt: string | null;
  /** Requests in the last 30 minutes (health-check window). */
  recentRequests: number;
  /** 5xx errors in the last 30 minutes (health-check window). */
  recentServerErrors: number;
  /** Total errors (4xx+5xx) in the last 30 minutes (health-check window). */
  recentTotalErrors: number;
}

// ── Helpers ──────────────────────────────────────────────────────

function floorToUtcHour(value: Date): Date {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date;
}

function addUtcHours(value: Date, hours: number): Date {
  const date = new Date(value);
  date.setUTCHours(date.getUTCHours() + hours);
  return date;
}

export function parseDbTimestamp(value: Date | number | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(
      Date.UTC(
        value.getFullYear(),
        value.getMonth(),
        value.getDate(),
        value.getHours(),
        value.getMinutes(),
        value.getSeconds(),
        value.getMilliseconds(),
      ),
    );
  }

  const raw = typeof value === "string" ? value.trim() : value;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    const date = new Date(`${raw.replace(" ", "T")}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDbTimestamp(value: Date | number | string | null | undefined): string | null {
  return parseDbTimestamp(value)?.toISOString() ?? null;
}

function normalizeUsageLogTimestamps(row: AiUsageLog): AiUsageLog {
  return {
    ...row,
    createdAt: parseDbTimestamp(row.createdAt) ?? row.createdAt,
  };
}

export function buildUpstreamHourlySeries(
  rows: Array<{
    hour: Date | string | null;
    requests: number | string | null;
    clientErrors: number | string | null;
    serverErrors: number | string | null;
    avgLatencyMs: number | string | null;
  }>,
  hours: number,
  now = new Date(),
): UpstreamHourlyRow[] {
  const bucketCount = Math.max(Math.trunc(hours), 1);
  const endHour = floorToUtcHour(now);
  const startHour = addUtcHours(endHour, -(bucketCount - 1));

  const rowsByHour = new Map<string, UpstreamHourlyRow>(
    rows.flatMap((row) => {
      const hourDate = parseDbTimestamp(row.hour);
      if (!hourDate) return [];

      const hour = floorToUtcHour(hourDate).toISOString();
      return [
        [
          hour,
          {
            hour,
            requests: Number(row.requests ?? 0),
            clientErrors: Number(row.clientErrors ?? 0),
            serverErrors: Number(row.serverErrors ?? 0),
            avgLatencyMs: Math.round(Number(row.avgLatencyMs ?? 0)),
          } satisfies UpstreamHourlyRow,
        ] as const,
      ];
    }),
  );

  return Array.from({ length: bucketCount }, (_, index) => {
    const hour = addUtcHours(startHour, index).toISOString();
    return (
      rowsByHour.get(hour) ?? {
        hour,
        requests: 0,
        clientErrors: 0,
        serverErrors: 0,
        avgLatencyMs: 0,
      }
    );
  });
}

interface UsageFilters {
  consumerKeyId?: number;
  userId?: number;
  ownerId?: number;
  keyId?: number;
  upstreamId?: number;
  modelId?: string;
  providerId?: string;
  statusCode?: number;
  statusClass?: "4xx" | "5xx";
  requestId?: string;
  from?: Date;
  to?: Date;
}

function buildConditions(filters: UsageFilters) {
  const conditions = [];
  if (filters.consumerKeyId != null) {
    conditions.push(eq(aiUsageLogs.consumerKeyId, filters.consumerKeyId));
  }
  if (filters.userId != null) {
    conditions.push(eq(aiUsageLogs.userId, filters.userId));
  }
  if (filters.ownerId != null) {
    conditions.push(eq(aiUsageLogs.keyOwnerId, filters.ownerId));
  }
  if (filters.keyId != null) {
    conditions.push(eq(aiUsageLogs.keyId, filters.keyId));
  }
  if (filters.upstreamId != null) {
    conditions.push(eq(aiUsageLogs.upstreamId, filters.upstreamId));
  }
  if (filters.modelId) conditions.push(eq(aiUsageLogs.modelId, filters.modelId));
  if (filters.providerId) conditions.push(eq(aiUsageLogs.providerId, filters.providerId));
  if (filters.statusClass === "4xx") {
    conditions.push(sql`(${aiUsageLogs.statusCode} >= 400 AND ${aiUsageLogs.statusCode} < 500)`);
  } else if (filters.statusClass === "5xx") {
    conditions.push(sql`(${aiUsageLogs.statusCode} >= 500 AND ${aiUsageLogs.statusCode} < 600)`);
  } else if (filters.statusCode != null) {
    conditions.push(eq(aiUsageLogs.statusCode, filters.statusCode));
  }
  if (filters.requestId) conditions.push(eq(aiUsageLogs.requestId, filters.requestId));
  if (filters.from) conditions.push(gte(aiUsageLogs.createdAt, filters.from));
  if (filters.to) conditions.push(lte(aiUsageLogs.createdAt, filters.to));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export const aiUsageLogRepo = {
  /** Insert a usage log entry (called from write queue handler). */
  async insert(data: NewAiUsageLog): Promise<void> {
    await exec(db.insert(aiUsageLogs).values(data));
  },

  /** Batch insert multiple usage log entries in a single multi-row INSERT. */
  async insertMany(rows: NewAiUsageLog[]): Promise<void> {
    if (rows.length === 0) return;
    await exec(db.insert(aiUsageLogs).values(rows));
  },

  /** List usage logs, newest first. */
  async findAll(limit = 50, offset = 0, filters?: UsageFilters): Promise<AiUsageLog[]> {
    const rows = await queryAll<AiUsageLog>(
      db
        .select()
        .from(aiUsageLogs)
        .where(filters ? buildConditions(filters) : undefined)
        .orderBy(desc(aiUsageLogs.createdAt))
        .limit(limit)
        .offset(offset),
    );
    return rows.map(normalizeUsageLogTimestamps);
  },

  /** Count logs matching filters. */
  async count(filters?: UsageFilters): Promise<number> {
    const row = await queryOne<{ total: number }>(
      db
        .select({ total: count() })
        .from(aiUsageLogs)
        .where(filters ? buildConditions(filters) : undefined),
    );
    return row?.total ?? 0;
  },

  /**
   * Batch-fetch the most recent usage log per upstream (DISTINCT ON).
   * Uses simple per-upstream queries for reliability across Drizzle execution paths.
   * Upstream counts are expected to be small in admin usage, so this is acceptable.
   */
  async findLatestByUpstreamIds(upstreamIds: number[]): Promise<Map<number, AiUsageLog>> {
    if (upstreamIds.length === 0) return new Map();

    const map = new Map<number, AiUsageLog>();
    const rows: Array<[number, AiUsageLog] | null> = await Promise.all(
      upstreamIds.map(async (upstreamId) => {
        const [latest] = await this.findAll(1, 0, { upstreamId });
        return latest ? [upstreamId, latest] : null;
      }),
    );

    for (const row of rows) {
      if (row) map.set(row[0], row[1]);
    }

    return map;
  },

  async upstreamOverview(hours = 24): Promise<UpstreamUsageOverviewRow[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recent30m = sql`NOW() - interval '30 minutes'`;
    const rows = await queryAll<{
      upstreamId: number | null;
      upstreamName: string | null;
      upstreamBaseUrl: string | null;
      requests24h: number;
      clientErrors24h: number;
      serverErrors24h: number;
      totalTokens24h: string | null;
      avgLatencyMs24h: string | null;
      lastSeenAt: Date | string | null;
      recentRequests: number;
      recentServerErrors: number;
      recentTotalErrors: number;
    }>(
      db
        .select({
          upstreamId: aiUsageLogs.upstreamId,
          upstreamName: sql<string | null>`MAX(${aiUsageLogs.upstreamName})`,
          upstreamBaseUrl: sql<string | null>`MAX(${aiUsageLogs.upstreamBaseUrl})`,
          requests24h: count(),
          clientErrors24h: sql<number>`SUM(CASE WHEN ${aiUsageLogs.statusCode} >= 400 AND ${aiUsageLogs.statusCode} < 500 THEN 1 ELSE 0 END)`,
          serverErrors24h: sql<number>`SUM(CASE WHEN ${aiUsageLogs.statusCode} >= 500 AND ${aiUsageLogs.statusCode} < 600 THEN 1 ELSE 0 END)`,
          totalTokens24h: sum(aiUsageLogs.totalTokens),
          avgLatencyMs24h: sql<string>`AVG(${aiUsageLogs.latencyMs})`,
          lastSeenAt: sql<Date | string | null>`MAX(${aiUsageLogs.createdAt})`,
          recentRequests: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.createdAt} >= ${recent30m})`,
          recentServerErrors: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 500 AND ${aiUsageLogs.statusCode} < 600 AND ${aiUsageLogs.createdAt} >= ${recent30m})`,
          recentTotalErrors: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 400 AND ${aiUsageLogs.statusCode} < 600 AND ${aiUsageLogs.createdAt} >= ${recent30m})`,
        })
        .from(aiUsageLogs)
        .where(and(isNotNull(aiUsageLogs.upstreamId), gte(aiUsageLogs.createdAt, since)))
        .groupBy(aiUsageLogs.upstreamId),
    );

    return rows
      .filter((row): row is typeof row & { upstreamId: number } => row.upstreamId != null)
      .map((row) => ({
        upstreamId: row.upstreamId,
        upstreamName: row.upstreamName ?? null,
        upstreamBaseUrl: row.upstreamBaseUrl ?? null,
        requests24h: Number(row.requests24h ?? 0),
        clientErrors24h: Number(row.clientErrors24h ?? 0),
        serverErrors24h: Number(row.serverErrors24h ?? 0),
        totalTokens24h: Number(row.totalTokens24h ?? 0),
        avgLatencyMs24h: Math.round(Number(row.avgLatencyMs24h ?? 0)),
        lastSeenAt: formatDbTimestamp(row.lastSeenAt),
        recentRequests: Number(row.recentRequests ?? 0),
        recentServerErrors: Number(row.recentServerErrors ?? 0),
        recentTotalErrors: Number(row.recentTotalErrors ?? 0),
      }));
  },

  async summaryByOwnerAndAiKeyIds(
    ownerId: number,
    keyIds: number[],
  ): Promise<AiKeyUsageSummaryRow[]> {
    if (keyIds.length === 0) return [];

    const rows = await queryAll<{
      keyId: number | null;
      requests: number;
      inputTokens: string | null;
      outputTokens: string | null;
      totalTokens: string | null;
      estimatedCost: string | null;
      upstreamCost: string | null;
    }>(
      db
        .select({
          keyId: aiUsageLogs.keyId,
          requests: count(),
          inputTokens: sum(aiUsageLogs.inputTokens),
          outputTokens: sum(aiUsageLogs.outputTokens),
          totalTokens: sum(aiUsageLogs.totalTokens),
          estimatedCost: sql<string>`COALESCE(SUM(CAST(${aiUsageLogs.estimatedCost} AS NUMERIC)), 0)::text`,
          upstreamCost: sql<string>`COALESCE(SUM(CAST(${aiUsageLogs.upstreamCost} AS NUMERIC)), 0)::text`,
        })
        .from(aiUsageLogs)
        .where(and(eq(aiUsageLogs.keyOwnerId, ownerId), inArray(aiUsageLogs.keyId, keyIds)))
        .groupBy(aiUsageLogs.keyId),
    );

    return rows
      .filter((row): row is NonNullable<typeof row> & { keyId: number } => row.keyId != null)
      .map((row) => ({
        keyId: row.keyId,
        requests: row.requests,
        inputTokens: Number(row.inputTokens ?? 0),
        outputTokens: Number(row.outputTokens ?? 0),
        totalTokens: Number(row.totalTokens ?? 0),
        estimatedCost: row.estimatedCost ?? "0",
        upstreamCost: row.upstreamCost ?? "0",
      }));
  },

  async totalsByOwnerId(ownerId: number): Promise<AiOwnerUsageTotals> {
    const row = await queryOne<{
      requests: number;
      inputTokens: string | null;
      outputTokens: string | null;
      totalTokens: string | null;
      estimatedCost: string | null;
      upstreamCost: string | null;
    }>(
      db
        .select({
          requests: count(),
          inputTokens: sum(aiUsageLogs.inputTokens),
          outputTokens: sum(aiUsageLogs.outputTokens),
          totalTokens: sum(aiUsageLogs.totalTokens),
          estimatedCost: sql<string>`COALESCE(SUM(CAST(${aiUsageLogs.estimatedCost} AS NUMERIC)), 0)::text`,
          upstreamCost: sql<string>`COALESCE(SUM(CAST(${aiUsageLogs.upstreamCost} AS NUMERIC)), 0)::text`,
        })
        .from(aiUsageLogs)
        .where(eq(aiUsageLogs.keyOwnerId, ownerId)),
    );

    return {
      requests: row?.requests ?? 0,
      inputTokens: Number(row?.inputTokens ?? 0),
      outputTokens: Number(row?.outputTokens ?? 0),
      totalTokens: Number(row?.totalTokens ?? 0),
      estimatedCost: row?.estimatedCost ?? "0",
      upstreamCost: row?.upstreamCost ?? "0",
    };
  },

  /** Aggregated usage summary (optionally filtered by consumer key, user, date range, etc.). */
  async summary(
    from?: Date,
    to?: Date,
    consumerKeyId?: number,
    userId?: number,
  ): Promise<AiUsageSummary> {
    const where = buildConditions({ consumerKeyId, userId, from, to });

    const totalsRow = await queryOne<{
      totalRequests: number;
      totalInput: string | null;
      totalOutput: string | null;
      totalCost: string | null;
      errorCount: string | null;
    }>(
      db
        .select({
          totalRequests: count(),
          totalInput: sum(aiUsageLogs.inputTokens),
          totalOutput: sum(aiUsageLogs.outputTokens),
          totalCost: sql<string>`SUM(CAST(${aiUsageLogs.estimatedCost} AS NUMERIC))`,
          errorCount: sql<string>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 400 OR ${aiUsageLogs.statusCode} = 0)`,
        })
        .from(aiUsageLogs)
        .where(where),
    );

    const totalRequests = totalsRow?.totalRequests ?? 0;
    const totalInputTokens = Number(totalsRow?.totalInput ?? 0);
    const totalOutputTokens = Number(totalsRow?.totalOutput ?? 0);
    const totalEstimatedCost = Number(totalsRow?.totalCost ?? 0);
    const errorCount = Number(totalsRow?.errorCount ?? 0);

    const byProvider = await queryAll<{
      providerId: string | null;
      requests: number;
      inputTokens: string | null;
      outputTokens: string | null;
      cost: string | null;
    }>(
      db
        .select({
          providerId: aiUsageLogs.providerId,
          requests: count(),
          inputTokens: sum(aiUsageLogs.inputTokens),
          outputTokens: sum(aiUsageLogs.outputTokens),
          cost: sql<string>`SUM(CAST(${aiUsageLogs.estimatedCost} AS NUMERIC))`,
        })
        .from(aiUsageLogs)
        .where(where)
        .groupBy(aiUsageLogs.providerId)
        .orderBy(sql`count(*) desc`),
    );

    const byModel = await queryAll<{
      providerId: string | null;
      modelId: string | null;
      requests: number;
      inputTokens: string | null;
      outputTokens: string | null;
      cost: string | null;
    }>(
      db
        .select({
          providerId: aiUsageLogs.providerId,
          modelId: aiUsageLogs.modelId,
          requests: count(),
          inputTokens: sum(aiUsageLogs.inputTokens),
          outputTokens: sum(aiUsageLogs.outputTokens),
          cost: sql<string>`SUM(CAST(${aiUsageLogs.estimatedCost} AS NUMERIC))`,
        })
        .from(aiUsageLogs)
        .where(where)
        .groupBy(aiUsageLogs.providerId, aiUsageLogs.modelId)
        .orderBy(sql`count(*) desc`),
    );

    return {
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalEstimatedCost,
      errorCount,
      errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
      byProvider: byProvider.map((r) => ({
        providerId: r.providerId ?? "",
        requests: r.requests,
        inputTokens: Number(r.inputTokens ?? 0),
        outputTokens: Number(r.outputTokens ?? 0),
        totalTokens: Number(r.inputTokens ?? 0) + Number(r.outputTokens ?? 0),
        estimatedCost: Number(r.cost ?? 0),
      })),
      byModel: byModel.map((r) => ({
        providerId: r.providerId ?? "",
        modelId: r.modelId ?? "",
        requests: r.requests,
        inputTokens: Number(r.inputTokens ?? 0),
        outputTokens: Number(r.outputTokens ?? 0),
        totalTokens: Number(r.inputTokens ?? 0) + Number(r.outputTokens ?? 0),
        estimatedCost: Number(r.cost ?? 0),
      })),
    };
  },

  /** Daily aggregated usage for time-series chart. */
  async dailySummary(days = 30, consumerKeyId?: number, userId?: number): Promise<DailyUsageRow[]> {
    const conditions = [gte(aiUsageLogs.createdAt, sql`NOW() - make_interval(days => ${days})`)];
    if (consumerKeyId != null) {
      conditions.push(eq(aiUsageLogs.consumerKeyId, consumerKeyId));
    }
    if (userId != null) {
      conditions.push(eq(aiUsageLogs.userId, userId));
    }

    return queryAll<DailyUsageRow>(
      db
        .select({
          date: sql<string>`date_trunc('day', ${aiUsageLogs.createdAt})::text`,
          requests: count(),
          totalTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)`,
          estimatedCost: sql<number>`COALESCE(SUM(CAST(${aiUsageLogs.estimatedCost} AS NUMERIC)), 0)`,
        })
        .from(aiUsageLogs)
        .where(and(...conditions))
        .groupBy(sql`date_trunc('day', ${aiUsageLogs.createdAt})`)
        .orderBy(sql`date_trunc('day', ${aiUsageLogs.createdAt})`),
    );
  },

  /** Per-consumer-key aggregated usage for the overview "By Key" table. */
  async summaryByConsumerKey(
    from?: Date,
    to?: Date,
    userId?: number,
  ): Promise<ConsumerKeyUsageRow[]> {
    const conditions = [sql`${aiUsageLogs.consumerKeyId} IS NOT NULL`];
    if (from) conditions.push(gte(aiUsageLogs.createdAt, from));
    if (to) conditions.push(lte(aiUsageLogs.createdAt, to));
    if (userId != null) conditions.push(eq(aiUsageLogs.userId, userId));

    const rows = await queryAll<{
      consumerKeyId: number | null;
      requests: number;
      inputTokens: string | null;
      outputTokens: string | null;
      cost: string | null;
    }>(
      db
        .select({
          consumerKeyId: aiUsageLogs.consumerKeyId,
          requests: count(),
          inputTokens: sum(aiUsageLogs.inputTokens),
          outputTokens: sum(aiUsageLogs.outputTokens),
          cost: sql<string>`COALESCE(SUM(CAST(${aiUsageLogs.estimatedCost} AS NUMERIC)), 0)`,
        })
        .from(aiUsageLogs)
        .where(and(...conditions))
        .groupBy(aiUsageLogs.consumerKeyId)
        .orderBy(sql`count(*) desc`),
    );

    return rows.map((r) => ({
      consumerKeyId: r.consumerKeyId ?? 0,
      requests: r.requests,
      inputTokens: Number(r.inputTokens ?? 0),
      outputTokens: Number(r.outputTokens ?? 0),
      totalTokens: Number(r.inputTokens ?? 0) + Number(r.outputTokens ?? 0),
      estimatedCost: Number(r.cost ?? 0),
    }));
  },

  async errorOverview(days = 30, userId?: number): Promise<ErrorOverview> {
    const where = userId != null ? eq(aiUsageLogs.userId, userId) : undefined;
    const totals = await queryOne<{
      total4xx: string | null;
      total5xx: string | null;
      last24h4xx: string | null;
      last24h5xx: string | null;
    }>(
      db
        .select({
          total4xx: sql<string>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 400 AND ${aiUsageLogs.statusCode} < 500 AND ${aiUsageLogs.createdAt} >= NOW() - make_interval(days => ${days}))`,
          total5xx: sql<string>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 500 AND ${aiUsageLogs.statusCode} < 600 AND ${aiUsageLogs.createdAt} >= NOW() - make_interval(days => ${days}))`,
          last24h4xx: sql<string>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 400 AND ${aiUsageLogs.statusCode} < 500 AND ${aiUsageLogs.createdAt} >= NOW() - interval '24 hours')`,
          last24h5xx: sql<string>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 500 AND ${aiUsageLogs.statusCode} < 600 AND ${aiUsageLogs.createdAt} >= NOW() - interval '24 hours')`,
        })
        .from(aiUsageLogs)
        .where(where),
    );

    const peaks = await queryAll<{
      date: string;
      clientErrors: number;
      serverErrors: number;
    }>(
      db
        .select({
          date: sql<string>`date_trunc('day', ${aiUsageLogs.createdAt})::date::text`,
          clientErrors: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 400 AND ${aiUsageLogs.statusCode} < 500)`,
          serverErrors: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 500 AND ${aiUsageLogs.statusCode} < 600)`,
        })
        .from(aiUsageLogs)
        .where(
          and(
            gte(aiUsageLogs.createdAt, sql`NOW() - make_interval(days => ${days})`),
            ...(userId != null ? [eq(aiUsageLogs.userId, userId)] : []),
          ),
        )
        .groupBy(sql`date_trunc('day', ${aiUsageLogs.createdAt})`)
        .orderBy(sql`date_trunc('day', ${aiUsageLogs.createdAt})`),
    );

    const peak4xx = peaks.reduce(
      (best, row) =>
        row.clientErrors > best.count ? { count: row.clientErrors, date: row.date } : best,
      { count: 0, date: null as string | null },
    );
    const peak5xx = peaks.reduce(
      (best, row) =>
        row.serverErrors > best.count ? { count: row.serverErrors, date: row.date } : best,
      { count: 0, date: null as string | null },
    );

    return {
      total4xx: Number(totals?.total4xx ?? 0),
      total5xx: Number(totals?.total5xx ?? 0),
      last24h4xx: Number(totals?.last24h4xx ?? 0),
      last24h5xx: Number(totals?.last24h5xx ?? 0),
      peak4xx: peak4xx.count,
      peak4xxDate: peak4xx.date,
      peak5xx: peak5xx.count,
      peak5xxDate: peak5xx.date,
    };
  },

  async errorDaily(days = 30, userId?: number): Promise<ErrorDailyRow[]> {
    return queryAll<ErrorDailyRow>(
      db
        .select({
          date: sql<string>`date_trunc('day', ${aiUsageLogs.createdAt})::date::text`,
          clientErrors: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 400 AND ${aiUsageLogs.statusCode} < 500)`,
          serverErrors: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 500 AND ${aiUsageLogs.statusCode} < 600)`,
          totalErrors: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 400 AND ${aiUsageLogs.statusCode} < 600)`,
        })
        .from(aiUsageLogs)
        .where(
          and(
            gte(aiUsageLogs.createdAt, sql`NOW() - make_interval(days => ${days})`),
            ...(userId != null ? [eq(aiUsageLogs.userId, userId)] : []),
          ),
        )
        .groupBy(sql`date_trunc('day', ${aiUsageLogs.createdAt})`)
        .orderBy(sql`date_trunc('day', ${aiUsageLogs.createdAt})`),
    );
  },

  /** Hourly usage breakdown for a single upstream (time-series chart). */
  async hourlyByUpstream(upstreamId: number, hours = 24): Promise<UpstreamHourlyRow[]> {
    const bucketCount = Math.max(Math.trunc(hours), 1);
    const endHour = floorToUtcHour(new Date());
    const startHour = addUtcHours(endHour, -(bucketCount - 1));

    const rows = await queryAll<{
      hour: Date | string | null;
      requests: number | string | null;
      clientErrors: number | string | null;
      serverErrors: number | string | null;
      avgLatencyMs: number | string | null;
    }>(
      db
        .select({
          hour: sql<Date | string>`date_trunc('hour', ${aiUsageLogs.createdAt})`,
          requests: count(),
          clientErrors: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 400 AND ${aiUsageLogs.statusCode} < 500)`,
          serverErrors: sql<number>`COUNT(*) FILTER (WHERE ${aiUsageLogs.statusCode} >= 500 AND ${aiUsageLogs.statusCode} < 600)`,
          avgLatencyMs: sql<string>`COALESCE(AVG(${aiUsageLogs.latencyMs}), 0)`,
        })
        .from(aiUsageLogs)
        .where(
          and(
            eq(aiUsageLogs.upstreamId, upstreamId),
            gte(aiUsageLogs.createdAt, startHour),
            lt(aiUsageLogs.createdAt, addUtcHours(endHour, 1)),
          ),
        )
        .groupBy(sql`date_trunc('hour', ${aiUsageLogs.createdAt})`)
        .orderBy(sql`date_trunc('hour', ${aiUsageLogs.createdAt})`),
    );

    return buildUpstreamHourlySeries(rows, bucketCount, endHour);
  },
};
