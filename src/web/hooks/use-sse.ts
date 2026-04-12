import { useCallback, useEffect, useRef, useState } from "react";

import { getAuthToken } from "@/web/api/client";

type SseEventHandler = (data: unknown) => void;

/**
 * Reusable SSE hook — connects to `/api/events?token=<jwt>` and
 * dispatches named server-sent events to subscribers.
 *
 * Pass a custom `getToken` to use a different auth token (e.g. user portal).
 * EventSource auto-reconnects on connection loss (browser-native).
 */
export function useSse(options: { enabled: boolean; getToken?: () => string | null }) {
  const { enabled, getToken = getAuthToken } = options;
  const [isConnected, setIsConnected] = useState(false);

  // subscriber registry: eventType → Set<handler>
  const subscribersRef = useRef(new Map<string, Set<SseEventHandler>>());
  // EventSource ref for cleanup
  const esRef = useRef<EventSource | null>(null);
  // track which event types we've registered listeners for on the EventSource
  const registeredTypesRef = useRef(new Set<string>());

  // Master handler dispatches to subscribers
  const dispatchRef = useRef((type: string, rawData: string) => {
    const handlers = subscribersRef.current.get(type);
    if (!handlers?.size) return;
    try {
      const parsed: unknown = JSON.parse(rawData);
      for (const fn of handlers) fn(parsed);
    } catch {
      /* malformed JSON — ignore */
    }
  });

  useEffect(() => {
    if (!enabled) return;
    const token = getToken();
    if (!token) return;

    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    es.addEventListener("connected", () => setIsConnected(true));
    es.onerror = () => setIsConnected(false);

    // Re-register listeners for any types that were subscribed before
    // the EventSource was (re)created
    for (const type of subscribersRef.current.keys()) {
      if (!registeredTypesRef.current.has(type)) {
        es.addEventListener(type, ((e: MessageEvent) => {
          dispatchRef.current(type, e.data as string);
        }) as EventListener);
        registeredTypesRef.current.add(type);
      }
    }

    return () => {
      es.close();
      esRef.current = null;
      registeredTypesRef.current.clear();
      setIsConnected(false);
    };
  }, [enabled, getToken]);

  const subscribe = useCallback((eventType: string, handler: SseEventHandler): (() => void) => {
    const subs = subscribersRef.current;
    if (!subs.has(eventType)) {
      subs.set(eventType, new Set());
    }
    subs.get(eventType)!.add(handler);

    // If EventSource exists but we haven't registered this event type yet, add it
    const es = esRef.current;
    if (es && !registeredTypesRef.current.has(eventType)) {
      es.addEventListener(eventType, ((e: MessageEvent) => {
        dispatchRef.current(eventType, e.data as string);
      }) as EventListener);
      registeredTypesRef.current.add(eventType);
    }

    return () => {
      const set = subs.get(eventType);
      if (set) {
        set.delete(handler);
        if (set.size === 0) subs.delete(eventType);
      }
    };
  }, []);

  return { subscribe, isConnected };
}
