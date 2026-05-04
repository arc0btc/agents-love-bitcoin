/**
 * Global singleton Durable Object — directory index, address resolution, global stats.
 */

import { DurableObject } from "cloudflare:workers";
import { GLOBAL_DO_SCHEMA } from "./schema";
import type { Env, Tier } from "../lib/types";
import { tierFromLevel } from "../lib/helpers";
import { emailLocalToEmail } from "../lib/names";

export class GlobalDO extends DurableObject<Env> {
  private initialized = false;

  private ensureSchema(): void {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(GLOBAL_DO_SCHEMA);
    this.initialized = true;
  }

  /** Index a newly registered agent in the global directory. */
  async indexAgent(opts: {
    btcAddress: string;
    stxAddress: string;
    aibtcName: string;
    displayName: string | null;
    level: number;
    emailAddress: string;
  }): Promise<void> {
    this.ensureSchema();
    const now = new Date().toISOString();

    // Insert into agent directory index
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO agent_index (btc_address, stx_address, aibtc_name, display_name, level, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      opts.btcAddress,
      opts.stxAddress,
      opts.aibtcName,
      opts.displayName,
      opts.level,
      now
    );

    // Insert into address resolution
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO address_resolution (btc_address, stx_address, aibtc_name, email_address)
       VALUES (?, ?, ?, ?)`,
      opts.btcAddress,
      opts.stxAddress,
      opts.aibtcName,
      opts.emailAddress
    );

    // Increment total_agents counter
    this.ctx.storage.sql.exec(
      `INSERT INTO global_stats (stat_key, stat_value, updated_at) VALUES ('total_agents', 1, ?)
       ON CONFLICT(stat_key) DO UPDATE SET stat_value = stat_value + 1, updated_at = ?`,
      now,
      now
    );
  }

  /** Check if a BTC address is already registered. */
  async isRegistered(btcAddress: string): Promise<boolean> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec(
      `SELECT 1 FROM agent_index WHERE btc_address = ?`,
      btcAddress
    ).toArray();
    return rows.length > 0;
  }

  /**
   * Check if an email local part is already provisioned to another address.
   * `localPart` is the slug form (e.g. `steel-yeti`), not the display name.
   */
  async isEmailLocalPartTaken(
    localPart: string,
    excludeBtcAddress: string
  ): Promise<boolean> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec(
      `SELECT 1 FROM address_resolution WHERE email_address = ? AND btc_address != ?`,
      emailLocalToEmail(localPart),
      excludeBtcAddress
    ).toArray();
    return rows.length > 0;
  }

  /**
   * Resolve an agent's rate-limit tier from the directory index.
   * Cheap point lookup against the existing `agent_index` primary key.
   * Unknown addresses fall back to "registered" so rate-limit middleware
   * still applies a default cap rather than failing closed.
   */
  async getAgentTier(btcAddress: string): Promise<Tier> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec(
      `SELECT level FROM agent_index WHERE btc_address = ?`,
      btcAddress
    ).toArray() as unknown as Array<{ level: number }>;
    if (rows.length === 0) return "registered";
    return tierFromLevel(rows[0].level);
  }

  /**
   * Refresh `agent_index.last_active_at` for liveness signaling. Coalesces
   * writes — only updates when the existing timestamp is older than the
   * caller's threshold (default 60s) so high-frequency callers don't fan out
   * one DO write per request. The runtime cadence (~600s) leaves this firing
   * at most once per agent per 60s window.
   */
  async touchActive(btcAddress: string, thresholdSeconds = 60): Promise<void> {
    this.ensureSchema();
    const now = new Date();
    const cutoff = new Date(now.getTime() - thresholdSeconds * 1000).toISOString();
    this.ctx.storage.sql.exec(
      `UPDATE agent_index
       SET last_active_at = ?
       WHERE btc_address = ?
         AND (last_active_at IS NULL OR last_active_at < ?)`,
      now.toISOString(),
      btcAddress,
      cutoff
    );
  }

  /**
   * Resolve an inbound email's local part to a BTC address (for routing).
   * `localPart` is the lowercased slug form delivered by Cloudflare Email
   * Routing (e.g. `steel-yeti`), not the display name (e.g. `Steel Yeti`).
   */
  async resolveByEmailLocalPart(
    localPart: string
  ): Promise<{ btcAddress: string } | null> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec(
      `SELECT btc_address FROM address_resolution WHERE email_address = ?`,
      emailLocalToEmail(localPart)
    ).toArray() as { btc_address: string }[];
    return rows.length > 0 ? { btcAddress: rows[0].btc_address } : null;
  }

  /** HTTP handler for internal DO requests. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/index-agent" && request.method === "POST") {
      const body = await request.json() as Parameters<GlobalDO["indexAgent"]>[0];
      await this.indexAgent(body);
      return Response.json({ ok: true });
    }

    if (url.pathname.startsWith("/is-registered/") && request.method === "GET") {
      const btcAddress = url.pathname.split("/is-registered/")[1];
      const registered = await this.isRegistered(btcAddress);
      return Response.json({ registered });
    }

    if (url.pathname.startsWith("/is-email-local-taken") && request.method === "GET") {
      const local = url.searchParams.get("local") ?? "";
      const exclude = url.searchParams.get("exclude") ?? "";
      const taken = await this.isEmailLocalPartTaken(local, exclude);
      return Response.json({ taken });
    }

    if (url.pathname.startsWith("/agent-tier/") && request.method === "GET") {
      const btcAddress = decodeURIComponent(url.pathname.split("/agent-tier/")[1]);
      const tier = await this.getAgentTier(btcAddress);
      return Response.json({ tier });
    }

    if (url.pathname.startsWith("/touch-active/") && request.method === "POST") {
      const btcAddress = decodeURIComponent(url.pathname.split("/touch-active/")[1]);
      await this.touchActive(btcAddress);
      return Response.json({ ok: true });
    }

    if (url.pathname.startsWith("/resolve-email-local/") && request.method === "GET") {
      const local = url.pathname.split("/resolve-email-local/")[1];
      const result = await this.resolveByEmailLocalPart(local);
      if (!result) return new Response("Not Found", { status: 404 });
      return Response.json(result);
    }

    return new Response("Not Found", { status: 404 });
  }
}
