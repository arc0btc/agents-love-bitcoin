/**
 * Per-address Durable Object — one per registered agent, keyed to BTC address.
 * Stores profile, email, check-ins, inbox, API usage metering, and account stats.
 */

import { DurableObject } from "cloudflare:workers";
import { AGENT_DO_SCHEMA, AGENT_DO_EXPECTED_INDEXES } from "./schema";
import type { Env } from "../lib/types";

interface ProfileRow {
  btc_address: string;
  stx_address: string;
  display_name: string | null;
  bns_name: string | null;
  aibtc_name: string | null;
  level: number;
  level_name: string;
  erc8004_id: number | null;
  mcp_verified: number;
  mcp_version: string | null;
  cached_at: string;
  registered_at: string;
}

interface EmailRow {
  email_address: string;
  forward_to: string | null;
  active: number;
  provisioned_at: string;
}

interface InboxRow {
  id: string;
  from_address: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string;
  read_at: string | null;
}

export class AgentDO extends DurableObject<Env> {
  private initialized = false;
  private inboxStatsInitialized = false;

  private ensureSchema(): void {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(AGENT_DO_SCHEMA);
    this.initialized = true;
  }

  /**
   * One-time backfill for agents that registered before the unread_count /
   * total_emails_received stats were maintained explicitly. Idempotent and
   * isolate-scoped — runs once per DO lifetime, not per request.
   */
  private ensureInboxStats(): void {
    if (this.inboxStatsInitialized) return;
    this.ensureSchema();
    const now = new Date().toISOString();

    const existing = this.ctx.storage.sql.exec(
      `SELECT stat_key FROM account_stats WHERE stat_key IN ('unread_count','total_emails_received')`
    ).toArray() as unknown as Array<{ stat_key: string }>;
    const present = new Set(existing.map((r) => r.stat_key));

    if (!present.has("total_emails_received")) {
      const totalRow = this.ctx.storage.sql.exec(
        `SELECT COUNT(*) AS cnt FROM inbox`
      ).one() as unknown as { cnt: number };
      this.ctx.storage.sql.exec(
        `INSERT INTO account_stats (stat_key, stat_value, updated_at) VALUES ('total_emails_received', ?, ?)`,
        totalRow.cnt,
        now
      );
    }

    if (!present.has("unread_count")) {
      const unreadRow = this.ctx.storage.sql.exec(
        `SELECT COUNT(*) AS cnt FROM inbox WHERE read_at IS NULL`
      ).one() as unknown as { cnt: number };
      this.ctx.storage.sql.exec(
        `INSERT INTO account_stats (stat_key, stat_value, updated_at) VALUES ('unread_count', ?, ?)`,
        unreadRow.cnt,
        now
      );
    }

    this.inboxStatsInitialized = true;
  }

  /** Create the agent profile and email on registration. */
  async register(opts: {
    btcAddress: string;
    stxAddress: string;
    aibtcName: string;
    bnsName: string | null;
    level: number;
    levelName: string;
    erc8004Id: number | null;
    emailAddress: string;
  }): Promise<{ profile: ProfileRow; email: EmailRow }> {
    this.ensureSchema();
    const now = new Date().toISOString();

    // Insert profile
    this.ctx.storage.sql.exec(
      `INSERT INTO profile (btc_address, stx_address, aibtc_name, bns_name, level, level_name, erc8004_id, cached_at, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      opts.btcAddress,
      opts.stxAddress,
      opts.aibtcName,
      opts.bnsName,
      opts.level,
      opts.levelName,
      opts.erc8004Id,
      now,
      now
    );

    // Insert email
    this.ctx.storage.sql.exec(
      `INSERT INTO email (email_address, provisioned_at) VALUES (?, ?)`,
      opts.emailAddress,
      now
    );

    // Initialize account stats. `unread_count` and `total_emails_received` are
    // maintained explicitly so /api/me/inbox-status can answer without scanning
    // the inbox table.
    for (const key of [
      "total_checkins",
      "total_signals",
      "total_emails_sent",
      "total_api_calls",
      "total_emails_received",
      "unread_count",
    ]) {
      this.ctx.storage.sql.exec(
        `INSERT INTO account_stats (stat_key, stat_value, updated_at) VALUES (?, 0, ?)`,
        key,
        now
      );
    }
    this.inboxStatsInitialized = true;

    const profile = this.ctx.storage.sql.exec(
      `SELECT * FROM profile WHERE btc_address = ?`,
      opts.btcAddress
    ).one() as unknown as ProfileRow;

    const email = this.ctx.storage.sql.exec(
      `SELECT * FROM email WHERE email_address = ?`,
      opts.emailAddress
    ).one() as unknown as EmailRow;

    return { profile, email };
  }

  /** Get the agent profile. Returns null if not registered. */
  async getProfile(): Promise<ProfileRow | null> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec(`SELECT * FROM profile LIMIT 1`).toArray();
    return rows.length > 0 ? (rows[0] as unknown as ProfileRow) : null;
  }

  /** Get the agent email. Returns null if not provisioned. */
  async getEmail(): Promise<EmailRow | null> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec(`SELECT * FROM email LIMIT 1`).toArray();
    return rows.length > 0 ? (rows[0] as unknown as EmailRow) : null;
  }

  /** Get account stats (lifetime totals). */
  async getStats(): Promise<Record<string, number>> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec(
      `SELECT stat_key, stat_value FROM account_stats`
    ).toArray() as unknown as Array<{ stat_key: string; stat_value: number }>;
    const stats: Record<string, number> = {};
    for (const row of rows) {
      stats[row.stat_key] = row.stat_value;
    }
    return stats;
  }

  /** Store an inbound email in the agent's inbox. */
  async receiveEmail(opts: {
    id: string;
    fromAddress: string;
    subject: string | null;
    bodyText: string | null;
    bodyHtml: string | null;
  }): Promise<InboxRow> {
    this.ensureInboxStats();
    const now = new Date().toISOString();

    this.ctx.storage.sql.exec(
      `INSERT INTO inbox (id, from_address, subject, body_text, body_html, received_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      opts.id,
      opts.fromAddress,
      opts.subject,
      opts.bodyText,
      opts.bodyHtml,
      now
    );

    // Increment total_emails_received + unread_count stats. Both are seeded by
    // ensureInboxStats above (or `register`), so the simple UPDATE is safe.
    this.ctx.storage.sql.exec(
      `UPDATE account_stats SET stat_value = stat_value + 1, updated_at = ? WHERE stat_key IN ('total_emails_received','unread_count')`,
      now
    );

    return this.ctx.storage.sql.exec(
      `SELECT * FROM inbox WHERE id = ?`,
      opts.id
    ).one() as unknown as InboxRow;
  }

  /** List inbox messages (newest first, paginated). */
  async listInbox(limit: number, offset: number): Promise<{ messages: InboxRow[]; total: number }> {
    this.ensureInboxStats();

    // Inbox is append-only — `total_emails_received` is exactly the row count
    // and avoids a per-call full-table scan.
    const totalRow = this.ctx.storage.sql.exec(
      `SELECT stat_value AS cnt FROM account_stats WHERE stat_key = 'total_emails_received'`
    ).one() as unknown as { cnt: number };

    const rows = this.ctx.storage.sql.exec(
      `SELECT * FROM inbox ORDER BY received_at DESC LIMIT ? OFFSET ?`,
      limit,
      offset
    ).toArray() as unknown as InboxRow[];

    return { messages: rows, total: totalRow.cnt };
  }

  /**
   * Wake-up bit for runtime polls: total + unread counts read straight from
   * `account_stats`, no inbox-table touch. The runtime calls this first and
   * skips the full inbox fetch when `unread === 0`.
   */
  async getInboxStatus(): Promise<{ unread: number; total: number }> {
    this.ensureInboxStats();
    const rows = this.ctx.storage.sql.exec(
      `SELECT stat_key, stat_value FROM account_stats WHERE stat_key IN ('unread_count','total_emails_received')`
    ).toArray() as unknown as Array<{ stat_key: string; stat_value: number }>;
    const map = Object.fromEntries(rows.map((r) => [r.stat_key, r.stat_value]));
    return {
      unread: map.unread_count ?? 0,
      total: map.total_emails_received ?? 0,
    };
  }

  /** Get a single inbox message and mark it as read. */
  async getInboxMessage(messageId: string): Promise<InboxRow | null> {
    this.ensureInboxStats();

    const rows = this.ctx.storage.sql.exec(
      `SELECT * FROM inbox WHERE id = ?`,
      messageId
    ).toArray() as unknown as InboxRow[];
    const row = rows.length > 0 ? rows[0] : null;

    if (row && !row.read_at) {
      const now = new Date().toISOString();
      this.ctx.storage.sql.exec(
        `UPDATE inbox SET read_at = ? WHERE id = ?`,
        now,
        messageId
      );
      // Decrement unread_count on the unread → read transition. Clamp at 0
      // defensively in case a backfill underestimated.
      this.ctx.storage.sql.exec(
        `UPDATE account_stats SET stat_value = MAX(stat_value - 1, 0), updated_at = ? WHERE stat_key = 'unread_count'`,
        now
      );
      row.read_at = now;
    }

    return row;
  }

  /** Update the forward_to address for email. */
  async updateEmailForward(forwardTo: string | null): Promise<EmailRow | null> {
    this.ensureSchema();
    const now = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `UPDATE email SET forward_to = ? WHERE rowid = 1`,
      forwardTo
    );
    return this.getEmail();
  }

  /**
   * Introspect the AgentDO schema health: missing indexes and row counts.
   * Called by GET /api/admin/schema-health via the /schema-health internal route.
   */
  async schemaHealth(): Promise<{
    missingIndexes: string[];
    unexpectedScans: string[];
    plans: Record<string, unknown[]>;
    rowCounts: Record<string, number>;
  }> {
    this.ensureSchema();

    // Live indexes (excluding SQLite internal ones)
    const liveRows = this.ctx.storage.sql.exec(
      `SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`
    ).toArray() as unknown as Array<{ name: string }>;
    const liveNames = new Set(liveRows.map((r) => r.name));

    const missingIndexes = [...AGENT_DO_EXPECTED_INDEXES].filter(
      (name) => !liveNames.has(name)
    );

    // AgentDO has no hot email-lookup queries — no EXPLAIN plans needed here
    const plans: Record<string, unknown[]> = {};
    const unexpectedScans: string[] = [];

    // Row counts for observability
    const tables = ["profile", "email", "checkins", "inbox", "api_usage", "account_stats"];
    const rowCounts: Record<string, number> = {};
    for (const table of tables) {
      const r = this.ctx.storage.sql.exec(
        `SELECT COUNT(*) AS cnt FROM ${table}`
      ).one() as unknown as { cnt: number };
      rowCounts[table] = r.cnt;
    }

    return { missingIndexes, unexpectedScans, plans, rowCounts };
  }

  /** HTTP handler for internal DO requests. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/register" && request.method === "POST") {
      const body = await request.json() as Parameters<AgentDO["register"]>[0];
      const result = await this.register(body);
      return Response.json(result);
    }

    if (url.pathname === "/profile" && request.method === "GET") {
      const profile = await this.getProfile();
      return Response.json({ profile });
    }

    if (url.pathname === "/email" && request.method === "GET") {
      const email = await this.getEmail();
      return Response.json({ email });
    }

    if (url.pathname === "/stats" && request.method === "GET") {
      const stats = await this.getStats();
      return Response.json({ stats });
    }

    if (url.pathname === "/email/forward" && request.method === "PUT") {
      const body = await request.json() as { forward_to: string | null };
      const email = await this.updateEmailForward(body.forward_to);
      return Response.json({ email });
    }

    if (url.pathname === "/inbox/receive" && request.method === "POST") {
      const body = await request.json() as Parameters<AgentDO["receiveEmail"]>[0];
      const message = await this.receiveEmail(body);
      return Response.json({ message });
    }

    if (url.pathname === "/inbox" && request.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
      const result = await this.listInbox(
        Math.min(Math.max(limit, 1), 100),
        Math.max(offset, 0)
      );
      return Response.json(result);
    }

    if (url.pathname === "/inbox-status" && request.method === "GET") {
      const status = await this.getInboxStatus();
      return Response.json(status);
    }

    if (url.pathname.startsWith("/inbox/") && request.method === "GET") {
      const messageId = url.pathname.split("/inbox/")[1];
      const message = await this.getInboxMessage(messageId);
      if (!message) return new Response("Not Found", { status: 404 });
      return Response.json({ message });
    }

    if (url.pathname === "/schema-health" && request.method === "GET") {
      const health = await this.schemaHealth();
      return Response.json(health);
    }

    return new Response("Not Found", { status: 404 });
  }
}
