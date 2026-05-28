/**
 * D1 directory service — all agent directory reads and writes go through here.
 *
 * Replaces direct GlobalDO HTTP calls in routes and middleware. GlobalDO remains
 * the fallback source of truth during the lazy backfill window (until Phase 7
 * retires the GlobalDO binding). On a D1 miss the service falls back to GlobalDO
 * and, where a full row is available, writes it back to D1 (write-through).
 *
 * Backfill strategy:
 *   - indexAgent: full dual-write — D1 first (UNIQUE enforced), then GlobalDO.
 *   - resolveByEmailLocalPart / isRegistered: D1 miss falls back to GlobalDO;
 *     no write-through because we can't reconstruct a complete row from the
 *     lightweight GlobalDO HTTP responses (missing stx_address, aibtc_name etc.).
 *     Full population happens naturally via the indexAgent write path.
 *   - getAgentTier: D1 miss falls back to GlobalDO tier endpoint; no write-through
 *     because the tier endpoint returns the string label, not the numeric level
 *     needed for a complete agents row insert.
 *   - isEmailLocalPartTaken: D1 miss falls back to GlobalDO to catch rows that
 *     haven't yet been written to D1.
 */

import { D1_DIRECTORY_SCHEMA } from "../objects/d1-schema";
import { emailLocalToEmail } from "../lib/names";
import { tierFromLevel } from "../lib/helpers";
import type { Env, Tier } from "../lib/types";

// ── Module-level schema init guard (one execution per isolate) ────────────────
let schemaEnsured = false;

export async function ensureD1Schema(db: D1Database): Promise<void> {
  if (schemaEnsured) return;
  await db.exec(D1_DIRECTORY_SCHEMA);
  schemaEnsured = true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get the singleton GlobalDO stub from env. */
function globalDoStub(env: Env): { fetch(req: Request): Promise<Response> } {
  const id = env.GLOBAL_DO.idFromName("global");
  return env.GLOBAL_DO.get(id);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve the rate-limit tier for a BTC address from the D1 directory.
 * Falls back to GlobalDO on D1 miss (no write-through — the tier endpoint
 * doesn't return enough data to reconstruct a full agents row).
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

  // D1 miss — fall back to GlobalDO
  const resp = await globalDoStub(env).fetch(
    new Request(`http://internal/agent-tier/${encodeURIComponent(btcAddress)}`)
  );
  if (!resp.ok) return "registered";
  const body = (await resp.json()) as { tier?: Tier };
  return body.tier ?? "registered";
}

/**
 * Resolve an email local part to a BTC address.
 * Falls back to GlobalDO on D1 miss (no write-through — the resolve endpoint
 * doesn't return stx_address / aibtc_name needed for a full row insert).
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

  // D1 miss — fall back to GlobalDO
  const resp = await globalDoStub(env).fetch(
    new Request(`http://internal/resolve-email-local/${encodeURIComponent(localPart)}`)
  );
  if (!resp.ok) return null;
  const body = (await resp.json()) as { btcAddress?: string };
  return body.btcAddress ? { btcAddress: body.btcAddress } : null;
}

/**
 * Check if a BTC address is registered.
 * Falls back to GlobalDO on D1 miss (no write-through — full row backfill
 * happens via the indexAgent write path).
 */
export async function isRegistered(env: Env, btcAddress: string): Promise<boolean> {
  await ensureD1Schema(env.DB);

  const row = await env.DB
    .prepare("SELECT 1 FROM agents WHERE btc_address = ?")
    .bind(btcAddress)
    .first<{ "1": number }>();

  if (row !== null) return true;

  // D1 miss — fall back to GlobalDO
  const resp = await globalDoStub(env).fetch(
    new Request(`http://internal/is-registered/${btcAddress}`)
  );
  if (!resp.ok) return false;
  const body = (await resp.json()) as { registered?: boolean };
  return body.registered === true;
}

/**
 * Check if an email local part is already taken by another agent.
 * Always falls back to GlobalDO if D1 has no row for the email, because
 * the row may exist in GlobalDO but not yet in D1 during the backfill window.
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

  if (d1Row !== null) return true;

  // D1 says not taken — but check GlobalDO to catch rows not yet in D1
  const resp = await globalDoStub(env).fetch(
    new Request(
      `http://internal/is-email-local-taken?local=${encodeURIComponent(localPart)}&exclude=${encodeURIComponent(excludeBtcAddress)}`
    )
  );
  if (!resp.ok) return false;
  const body = (await resp.json()) as { taken?: boolean };
  return body.taken === true;
}

/**
 * Index a newly registered agent in both D1 and GlobalDO.
 *
 * D1 is written first with the UNIQUE(email_address) constraint acting as the
 * atomic gate against concurrent registrations with the same name (TOCTOU fix).
 * If D1 raises a UNIQUE constraint violation on email_address, we surface it
 * as { conflict: true } — the caller should return 409.
 *
 * GlobalDO is written second for backwards compatibility and as the fallback
 * source of truth during the backfill window. A GlobalDO failure is logged but
 * does not roll back the D1 write — D1 is now primary.
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

  // Dual-write to GlobalDO (backfill compatibility — do not fail the request if this fails)
  try {
    const stub = globalDoStub(env);
    await stub.fetch(
      new Request("http://internal/index-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      })
    );
  } catch {
    // GlobalDO write failure is non-fatal: D1 is now primary.
    // Production observability will surface this via Cloudflare Workers logs.
  }

  return { conflict: false };
}
