import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { subscribeToEvents } from "@/server/lib/sse";
import { verifyTokenForSSE } from "@/server/middleware/auth";

const events = new Hono();

/**
 * GET /api/events
 *
 * Authenticated SSE stream. Admin sees all events; user sees
 * events scoped to their userId.
 */
events.get("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const queryToken = c.req.query("token");
  const raw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : (queryToken ?? null);

  if (!raw) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const session = await verifyTokenForSSE(raw);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Admin sees all events (null scope); user sees only their own
  const scope = session.role === "admin" ? null : `user:${session.userId}`;

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({ time: new Date().toISOString() }),
    });

    // Heartbeat every 30s to keep the connection alive through proxies
    const heartbeat = setInterval(async () => {
      try {
        await stream.writeSSE({ event: "heartbeat", data: "" });
      } catch {
        clearInterval(heartbeat);
      }
    }, 30_000);

    const unsubscribe = subscribeToEvents(scope, async (event) => {
      try {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.data),
        });
      } catch {
        // Client disconnected — unsubscribe is called via onAbort
      }
    });

    if (!unsubscribe) {
      clearInterval(heartbeat);
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: "Too many active connections" }),
      });
      return;
    }

    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    // Block until the client disconnects
    await new Promise(() => {});
  });
});

export default events;
