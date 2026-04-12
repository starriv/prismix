import type { Context } from "hono";

type SuccessStatus = 200 | 201;

export function ok<T>(c: Context, data: T, status: SuccessStatus = 200) {
  return c.json({ data }, status);
}
