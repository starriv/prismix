import { useCallback, useEffect, useRef, useState } from "react";

import { getAuthToken, refreshAuthToken } from "@/web/api/client";

type SseEventHandler = (data: unknown) => void;

const ERROR_RECONNECT_DELAY_MS = 750;
const TOKEN_REFRESH_THROTTLE_MS = 30_000;

/**
 * Reusable SSE hook — connects to `/api/events?token=<jwt>` and
 * dispatches named server-sent events to subscribers.
 *
 * Pass a custom `getToken` to use a different auth token (e.g. user portal).
 * EventSource auto-reconnects on connection loss (browser-native).
 */
export function useSse(options: {
  enabled: boolean;
  getToken?: () => string | null;
  refreshToken?: () => Promise<string | null>;
}) {
  const { enabled, getToken = getAuthToken, refreshToken = refreshAuthToken } = options;
  const [isConnected, setIsConnected] = useState(false);

  // subscriber registry: eventType → Set<handler>
  const subscribersRef = useRef(new Map<string, Set<SseEventHandler>>());
  // EventSource ref for cleanup
  const esRef = useRef<EventSource | null>(null);
  // track which event types we've registered listeners for on the EventSource
  const registeredTypesRef = useRef(new Set<string>());
  const reconnectTimerRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const lastRefreshAttemptAtRef = useRef(0);

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
    let cancelled = false;
    const registeredTypes = registeredTypesRef.current;

    const registerSubscribedListeners = (es: EventSource) => {
      for (const type of subscribersRef.current.keys()) {
        if (!registeredTypes.has(type)) {
          es.addEventListener(type, ((e: MessageEvent) => {
            dispatchRef.current(type, e.data as string);
          }) as EventListener);
          registeredTypes.add(type);
        }
      }
    };

    const connect = (token: string) => {
      esRef.current?.close();
      registeredTypes.clear();

      const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
      esRef.current = es;

      es.addEventListener("connected", () => setIsConnected(true));
      es.onerror = () => {
        setIsConnected(false);
        scheduleRefreshReconnect();
      };

      // Re-register listeners for any types that were subscribed before
      // the EventSource was (re)created.
      registerSubscribedListeners(es);
    };

    const reconnectWithFreshToken = async () => {
      if (cancelled || refreshInFlightRef.current) return;

      const previousToken = getToken();
      let nextToken: string | null;
      const now = Date.now();
      const canRefresh = now - lastRefreshAttemptAtRef.current >= TOKEN_REFRESH_THROTTLE_MS;

      if (canRefresh) {
        refreshInFlightRef.current = true;
        lastRefreshAttemptAtRef.current = now;
        try {
          nextToken = (await refreshToken()) ?? getToken();
        } finally {
          refreshInFlightRef.current = false;
        }
      } else {
        nextToken = getToken();
      }

      if (cancelled || !nextToken) return;
      if (
        nextToken !== previousToken ||
        !esRef.current ||
        esRef.current.readyState === EventSource.CLOSED
      ) {
        connect(nextToken);
      }
    };

    function scheduleRefreshReconnect() {
      if (reconnectTimerRef.current !== null) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        void reconnectWithFreshToken();
      }, ERROR_RECONNECT_DELAY_MS);
    }

    const start = async () => {
      const token = getToken() ?? (await refreshToken());
      if (!cancelled && token) connect(token);
    };

    void start();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      esRef.current?.close();
      esRef.current = null;
      registeredTypes.clear();
      setIsConnected(false);
    };
  }, [enabled, getToken, refreshToken]);

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
