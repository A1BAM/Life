import { neon } from "@neondatabase/serverless";

/**
 * Neon HTTP client for the Life database.
 * One round trip per query — no pooling to manage, no connection to close.
 * Multi-statement atomicity is done with CTEs (see routes/study.js) rather than
 * interactive transactions, which the HTTP driver does not support.
 */
export function db(env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(env.DATABASE_URL);
}

/**
 * Read-only client for LiftLogic's database.
 * Falls back to the Life connection when LIFTLOGIC_DATABASE_URL is unset, which
 * covers the case where both apps share one Neon database and differ by schema.
 */
export function liftlogicDb(env) {
  const url = env.LIFTLOGIC_DATABASE_URL || env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

export function hasLiftlogic(env) {
  return Boolean(env.LIFTLOGIC_DATABASE_URL || env.DATABASE_URL);
}
