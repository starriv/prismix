/**
 * Centralized error reporting abstraction. Currently logs to console;
 * swap the implementation when integrating with Sentry or similar.
 *
 * Usage:
 *   reportError(error, { component: "TransactionsPage", action: "fetchData" });
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  const err = error instanceof Error ? error : new Error(String(error));

  // eslint-disable-next-line no-console
  console.error("[app-error]", err.message, context ?? {});

  // TODO: Sentry integration
  // Sentry.captureException(err, { extra: context });
}
