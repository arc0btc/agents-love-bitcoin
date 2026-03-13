import { DurableObject } from "cloudflare:workers";
import { SCHEMA } from "./schema";

/**
 * AlbDO — Durable Object with SQLite storage for agents-love-bitcoin.
 * Stores cached agent profiles, check-ins, and API usage analytics.
 */
export class AlbDO extends DurableObject {
  private initialized = false;

  private ensureSchema(): void {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(SCHEMA);
    this.initialized = true;
  }

  /** Record a check-in for an agent */
  async checkin(btcAddress: string): Promise<{ id: string; createdAt: string }> {
    this.ensureSchema();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.ctx.storage.sql.exec(
      `INSERT INTO checkins (id, btc_address, created_at) VALUES (?, ?, ?)`,
      id, btcAddress, createdAt
    );

    // Update agent check-in count
    this.ctx.storage.sql.exec(
      `UPDATE agents SET check_in_count = check_in_count + 1, last_active_at = ? WHERE btc_address = ?`,
      createdAt, btcAddress
    );

    return { id, createdAt };
  }

  /** Get check-in history for an agent */
  async getCheckins(btcAddress: string, limit = 50): Promise<Array<{ id: string; createdAt: string }>> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec(
      `SELECT id, created_at FROM checkins WHERE btc_address = ? ORDER BY created_at DESC LIMIT ?`,
      btcAddress, limit
    ).toArray();

    return rows.map((r) => ({
      id: r.id as string,
      createdAt: r.created_at as string,
    }));
  }

  /** Record an API usage event */
  async recordUsage(
    btcAddress: string | null,
    endpoint: string,
    method: string,
    statusCode: number,
    responseMs: number
  ): Promise<void> {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `INSERT INTO api_usage (id, btc_address, endpoint, method, status_code, response_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), btcAddress, endpoint, method, statusCode, responseMs, new Date().toISOString()
    );
  }

  /** Get signal analytics (grouped by endpoint) */
  async getSignalAnalytics(since?: string): Promise<Array<{ endpoint: string; count: number; avgMs: number }>> {
    this.ensureSchema();
    const whereClause = since ? `WHERE created_at >= ?` : "";
    const params = since ? [since] : [];

    const rows = this.ctx.storage.sql.exec(
      `SELECT endpoint, COUNT(*) as count, AVG(response_ms) as avg_ms
       FROM api_usage ${whereClause}
       GROUP BY endpoint ORDER BY count DESC`,
      ...params
    ).toArray();

    return rows.map((r) => ({
      endpoint: r.endpoint as string,
      count: r.count as number,
      avgMs: Math.round(r.avg_ms as number),
    }));
  }

  /** Get agent activity analytics */
  async getAgentAnalytics(since?: string): Promise<Array<{ btcAddress: string; requests: number; checkins: number }>> {
    this.ensureSchema();
    const whereClause = since ? `WHERE u.created_at >= ?` : "";
    const params = since ? [since] : [];

    const rows = this.ctx.storage.sql.exec(
      `SELECT u.btc_address, COUNT(*) as requests,
              (SELECT COUNT(*) FROM checkins c WHERE c.btc_address = u.btc_address ${since ? "AND c.created_at >= ?" : ""}) as checkins
       FROM api_usage u ${whereClause}
       WHERE u.btc_address IS NOT NULL
       GROUP BY u.btc_address ORDER BY requests DESC LIMIT 100`,
      ...params, ...(since ? [since] : [])
    ).toArray();

    return rows.map((r) => ({
      btcAddress: r.btc_address as string,
      requests: r.requests as number,
      checkins: r.checkins as number,
    }));
  }
}
