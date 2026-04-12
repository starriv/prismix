/**
 * SSE event system — pub/sub for real-time dashboard updates.
 *
 * Each listener is associated with a scope so events are filtered
 * to only the relevant audience. null scope = admin / all events.
 */
import { log } from "./logger";

export type EventPayload = { type: string; data: unknown };
export type EventHandler = (event: EventPayload) => void;

interface Listener {
  scope: string | null;
  handler: EventHandler;
  registeredAt: number;
}

const listeners = new Map<EventHandler, Listener>();

// Max age for a stale listener (client failed to send onAbort) — 4 hours
const LISTENER_MAX_AGE = 4 * 60 * 60 * 1000;
const MAX_LISTENERS = 500;

/**
 * Subscribe to events for a specific scope.
 * Pass null to receive all events (admin use).
 * Returns an unsubscribe function, or null if the limit is reached.
 */
export function subscribeToEvents(
  scope: string | null,
  handler: EventHandler,
): (() => void) | null {
  if (listeners.size >= MAX_LISTENERS) {
    log.sse.warn({ limit: MAX_LISTENERS }, "Listener limit reached, rejecting new subscription");
    return null;
  }
  listeners.set(handler, { scope, handler, registeredAt: Date.now() });
  return () => listeners.delete(handler);
}

/** Emit an event scoped to a specific audience (also delivered to admin/null-scope listeners). */
export function emitScopedEvent(scope: string | null, event: EventPayload): void {
  const now = Date.now();
  for (const [fn, listener] of listeners) {
    if (now - listener.registeredAt > LISTENER_MAX_AGE) {
      listeners.delete(fn);
      continue;
    }
    if (listener.scope === null || listener.scope === scope) {
      try {
        fn(event);
      } catch {
        /* client write error — ignore */
      }
    }
  }
}

/** Broadcast to all listeners regardless of scope (e.g. verified event). */
export function emitBroadcastEvent(event: EventPayload): void {
  const now = Date.now();
  for (const [fn, listener] of listeners) {
    if (now - listener.registeredAt > LISTENER_MAX_AGE) {
      listeners.delete(fn);
      continue;
    }
    try {
      fn(event);
    } catch {
      /* ignore */
    }
  }
}

export function getListenerCount(): number {
  return listeners.size;
}
