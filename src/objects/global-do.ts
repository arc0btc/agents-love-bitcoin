/**
 * Global singleton Durable Object — directory index, address resolution, global stats.
 */

import { DurableObject } from "cloudflare:workers";
import { GLOBAL_DO_SCHEMA } from "./schema";
import type { Env } from "../lib/types";

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
    const row = this.ctx.storage.sql.exec(
      `SELECT 1 FROM agent_index WHERE btc_address = ?`,
      btcAddress
    ).one();
    return row !== null;
  }

  /** Check if an AIBTC name is already taken by another address. */
  async isNameTaken(aibtcName: string, excludeBtcAddress: string): Promise<boolean> {
    this.ensureSchema();
    const row = this.ctx.storage.sql.exec(
      `SELECT 1 FROM address_resolution WHERE aibtc_name = ? AND btc_address != ?`,
      aibtcName,
      excludeBtcAddress
    ).one();
    return row !== null;
  }

  /** Resolve an AIBTC name to a BTC address (for email routing). */
  async resolveByName(aibtcName: string): Promise<{ btcAddress: string } | null> {
    this.ensureSchema();
    const row = this.ctx.storage.sql.exec(
      `SELECT btc_address FROM address_resolution WHERE aibtc_name = ?`,
      aibtcName
    ).one() as { btc_address: string } | null;
    return row ? { btcAddress: row.btc_address } : null;
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

    if (url.pathname.startsWith("/is-name-taken") && request.method === "GET") {
      const name = url.searchParams.get("name") ?? "";
      const exclude = url.searchParams.get("exclude") ?? "";
      const taken = await this.isNameTaken(name, exclude);
      return Response.json({ taken });
    }

    if (url.pathname.startsWith("/resolve-name/") && request.method === "GET") {
      const name = url.pathname.split("/resolve-name/")[1];
      const result = await this.resolveByName(name);
      if (!result) return new Response("Not Found", { status: 404 });
      return Response.json(result);
    }

    return new Response("Not Found", { status: 404 });
  }
}
