/**
 * DbAdapter — Strategy interface for database query execution.
 *
 * Abstracts Drizzle dialect-specific calls behind a uniform async API.
 *
 * Concrete implementation: PgAdapter (the only adapter).
 */

/**
 * Drizzle query builder — `any` is required here because Drizzle's QB types
 * are dialect-specific and the adapter interface is dialect-agnostic.
 * The eslint-disable is scoped to this file only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface DbAdapter {
  /** The underlying Drizzle ORM instance (dialect-specific). */
  readonly db: any;

  /** The dialect-specific schema module (table objects). */
  readonly schema: any;

  /** Execute a SELECT and return the first row or undefined. */
  queryOne<T>(qb: any): Promise<T | undefined>;

  /** Execute a SELECT and return all rows. */
  queryAll<T>(qb: any): Promise<T[]>;

  /** Execute an INSERT/UPDATE/DELETE without returning data. */
  exec(qb: any): Promise<void>;

  /** Execute an INSERT/UPDATE with `.returning()` and return the first row. */
  returningOne<T>(qb: any): Promise<T>;

  /** Execute a DELETE/UPDATE and return the number of affected rows. */
  execWithChanges(qb: any): Promise<number>;

  /** Execute a callback within a database transaction. */
  transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;

  /** Run schema initialization / migrations (called once after construction). */
  init?(): Promise<void>;

  /** Graceful shutdown — release connections. */
  close(): Promise<void>;
}
