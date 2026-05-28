/**
 * D1 directory service — all agent directory reads and writes go through here.
 *
 * GlobalDO has been retired. D1 (`alb-directory`) is the sole source of truth
 * for agent registration, address resolution, and tier lookups. On a D1 miss
 * each function returns a safe default (null / false / "registered") rather
 * than falling back to a secondary store.
 */

import { D1_DIRECTORY_SCHEMA } from "../objects/d1-schema";
import { emailLocalToEmail } from "../lib/names";
import { tierFromLevel } from "../lib/helpers";
import type { Env, Tier } from "../lib/types";

// ── Module-level schema init guard (one execution per isolate) ────────────────
let schemaEnsured = false;

/**
 * Split a multi-statement SQL schema into individual statements.
 * D1's `db.exec()` splits its input on newlines and runs each line as a separate
 * statement, so it chokes on multi-line `CREATE TABLE` DDL. We instead compile
 * each statement independently and run them together in a batch.
 */
export function splitSchemaStatements(schema: string): string[] {
  return schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function ensureD1Schema(db: D1Database): Promise<void> {
  if (schemaEnsured) return;
  const statements = splitSchemaStatements(D1_DIRECTORY_SCHEMA);
  await db.batch(statements.map((s) => db.prepare(s)));
  schemaEnsured = true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve the rate-limit tier for a BTC address from the D1 directory.
 * Returns "registered" (the safe default) on a D1 miss.
 */
export async function getAgentTier(env: Env, btcAddress: string): Promise<Tier> {
  await ensureD1Schema(env.DB);

  const row = await env.DB
    .prepare("SELECT level FROM agents WHERE btc_address = ?")
    .bind(btcAddress)
    .first<{ level: number }>();

  if (row !== null) {
    return tierFromLevel(row.level);
  }

  return "registered";
}

/**
 * Resolve an email local part to a BTC address.
 * Returns null on a D1 miss.
 */
export async function resolveByEmailLocalPart(
  env: Env,
  localPart: string
): Promise<{ btcAddress: string } | null> {
  await ensureD1Schema(env.DB);

  const email = emailLocalToEmail(localPart);

  const row = await env.DB
    .prepare("SELECT btc_address FROM address_resolution WHERE email_address = ?")
    .bind(email)
    .first<{ btc_address: string }>();

  if (row !== null) {
    return { btcAddress: row.btc_address };
  }

  return null;
}

/**
 * Check if a BTC address is registered.
 * Returns false on a D1 miss.
 */
export async function isRegistered(env: Env, btcAddress: string): Promise<boolean> {
  await ensureD1Schema(env.DB);

  const row = await env.DB
    .prepare("SELECT 1 FROM agents WHERE btc_address = ?")
    .bind(btcAddress)
    .first<{ "1": number }>();

  return row !== null;
}

/**
 * Check if an email local part is already taken by another agent.
 * Returns false on a D1 miss.
 */
export async function isEmailLocalPartTaken(
  env: Env,
  localPart: string,
  excludeBtcAddress: string
): Promise<boolean> {
  await ensureD1Schema(env.DB);

  const email = emailLocalToEmail(localPart);

  const d1Row = await env.DB
    .prepare("SELECT 1 FROM address_resolution WHERE email_address = ? AND btc_address != ?")
    .bind(email, excludeBtcAddress)
    .first<{ "1": number }>();

  return d1Row !== null;
}

/**
 * Index a newly registered agent in D1.
 *
 * D1 is the sole store for agent registration. The UNIQUE(email_address)
 * constraint on address_resolution acts as the atomic gate against concurrent
 * registrations with the same name (TOCTOU fix). If D1 raises a UNIQUE
 * constraint violation on email_address, we surface it as { conflict: true } —
 * the caller should return 409.
 */
export async function indexAgent(
  env: Env,
  opts: {
    btcAddress: string;
    stxAddress: string;
    aibtcName: string;
    displayName: string | null;
    level: number;
    emailAddress: string;
  }
): Promise<{ conflict: boolean }> {
  await ensureD1Schema(env.DB);

  const now = new Date().toISOString();

  try {
    // Use a D1 batch for atomicity: agents + address_resolution together
    const agentInsert = env.DB.prepare(
      `INSERT OR REPLACE INTO agents (btc_address, stx_address, aibtc_name, display_name, level, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(opts.btcAddress, opts.stxAddress, opts.aibtcName, opts.displayName, opts.level, now);

    // INSERT OR ABORT on address_resolution so UNIQUE(email_address) fires an error on conflict
    const resolveInsert = env.DB.prepare(
      `INSERT OR ABORT INTO address_resolution (btc_address, stx_address, aibtc_name, email_address)
       VALUES (?, ?, ?, ?)`
    ).bind(opts.btcAddress, opts.stxAddress, opts.aibtcName, opts.emailAddress);

    await env.DB.batch([agentInsert, resolveInsert]);
  } catch (err: unknown) {
    // D1 surfaces SQLite constraint errors as an error message containing "UNIQUE constraint"
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint") || msg.includes("SQLITE_CONSTRAINT")) {
      return { conflict: true };
    }
    throw err; // unexpected error — propagate
  }

  return { conflict: false };
}
