/**
 * RequestLogStore — Strategy interface for AI request/response body storage.
 *
 * Implementations:
 * - RedisRequestLogStore (default, TTL-based auto-expiry)
 * - Future: MongoRequestLogStore
 *
 * Created via `createRequestLogStore()` factory in index.ts.
 * Consumers import from the barrel only.
 */

/** A captured AI request + response pair, keyed by requestId. */
export interface RequestLogEntry {
  requestId: string;
  consumerKeyId: number | null;
  modelId: string;
  /** Serialized request body (the full messages/input JSON sent to upstream). */
  requestBody: string;
  /** Response body — non-streaming: full JSON; streaming: accumulated SSE frames. */
  responseBody: string;
  createdAt: string;
}

export interface RequestLogStore {
  /** Save a request log entry (fire-and-forget, must not throw on the hot path). */
  save(entry: RequestLogEntry): Promise<void>;

  /** Retrieve a request log by requestId. Returns null if expired or not found. */
  get(requestId: string): Promise<RequestLogEntry | null>;

  /** Graceful shutdown. */
  close(): Promise<void>;
}
