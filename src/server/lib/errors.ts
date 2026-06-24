/**
 * Centralized error hierarchy — all domain errors extend AppError.
 *
 * The global Hono error handler (index.ts) uses `instanceof AppError`
 * to return structured JSON responses with the correct status code,
 * instead of a generic 500.
 *
 * Usage:
 *   throw new AppError("Resource not found", 404, "RESOURCE_NOT_FOUND");
 *   throw new NotFoundError("Resource");
 *   throw new ValidationError("Price must be positive");
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500,
    public readonly code: string = "INTERNAL_ERROR",
  ) {
    super(message);
    this.name = "AppError";
  }

  /** Serialize for JSON response — override in subclasses for extra fields */
  toJSON(): Record<string, unknown> {
    return { error: this.message, code: this.code };
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
    this.name = "ConflictError";
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfterMs?: number;
  constructor(retryAfterMs?: number) {
    super("Too many requests", 429, "RATE_LIMITED");
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Thrown by a notification channel when the target is permanently
 * unavailable (e.g. Telegram 403 "bot was blocked by the user").
 *
 * The dispatcher catches this to deactivate the notification config
 * so future events skip the dead target instead of retrying forever.
 */
export class ChannelDeactivatedError extends AppError {
  constructor(
    message: string,
    public readonly channel: string,
    public readonly target: string,
  ) {
    super(message, 403, "CHANNEL_DEACTIVATED");
    this.name = "ChannelDeactivatedError";
  }
}
