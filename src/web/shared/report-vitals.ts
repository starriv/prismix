import type { Metric } from "web-vitals";

/**
 * Reports Core Web Vitals to the console (development) or an analytics
 * endpoint (production). Swap the `send` implementation when integrating
 * with a real monitoring service (e.g. Sentry, Datadog, Vercel Analytics).
 */
function send(metric: Metric) {
  // Development: log to console for visibility
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[web-vitals] ${metric.name}: ${Math.round(metric.value)}`, metric);
    return;
  }

  // Production: no-op until analytics endpoint is implemented
  void metric;
}

export function reportWebVitals() {
  // Dynamic import keeps web-vitals out of the critical path
  import("web-vitals").then(({ onCLS, onFCP, onLCP, onTTFB, onINP }) => {
    onCLS(send);
    onFCP(send);
    onLCP(send);
    onTTFB(send);
    onINP(send);
  });
}
