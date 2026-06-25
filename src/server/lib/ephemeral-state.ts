/**
 * Short-lived auth state backed by Redis.
 *
 * These values bridge multi-request login flows (SIWE nonce, OAuth state,
 * one-time exchange codes). They must be readable across Railway replicas.
 */
import { getRedis } from "./redis";

const CONSUME_SCRIPT = `
local value = redis.call("GET", KEYS[1])
if value then
  redis.call("DEL", KEYS[1])
end
return value
`;

function redisKey(namespace: string, key: string): string {
  return `ephemeral:${namespace}:${key}`;
}

function encode<T>(value: T): string {
  const raw = JSON.stringify(value);
  if (raw === undefined) {
    throw new Error("Ephemeral state value must be JSON-serializable");
  }
  return raw;
}

function decode<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function normalizeRedisString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

export async function setEphemeralState<T>(
  namespace: string,
  key: string,
  value: T,
  ttlMs: number,
): Promise<void> {
  await getRedis().set(redisKey(namespace, key), encode(value), "PX", ttlMs);
}

export async function getEphemeralState<T>(namespace: string, key: string): Promise<T | undefined> {
  const raw = await getRedis().get(redisKey(namespace, key));
  return raw == null ? undefined : decode<T>(raw);
}

export async function consumeEphemeralState<T>(
  namespace: string,
  key: string,
): Promise<T | undefined> {
  const raw = normalizeRedisString(
    await getRedis().eval(CONSUME_SCRIPT, 1, redisKey(namespace, key)),
  );
  return raw == null ? undefined : decode<T>(raw);
}

export async function deleteEphemeralState(namespace: string, key: string): Promise<void> {
  await getRedis().del(redisKey(namespace, key));
}

export async function countEphemeralState(namespace: string): Promise<number> {
  const redis = getRedis();
  const pattern = redisKey(namespace, "*");
  let cursor = "0";
  let count = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;
    count += keys.length;
  } while (cursor !== "0");
  return count;
}
