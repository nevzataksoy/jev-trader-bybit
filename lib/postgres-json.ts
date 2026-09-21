import type postgres from "postgres";

/**
 * Domain interfaces are JSON-serializable but intentionally do not expose a
 * string index signature. Keep the single cast at the database boundary so
 * postgres.js can encode the original value exactly once via sql.json().
 */
export function asPostgresJson(value: unknown): postgres.JSONValue {
  return value as postgres.JSONValue;
}
