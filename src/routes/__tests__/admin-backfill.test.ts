/**
 * Tests for POST /api/admin/backfill-directory — Phase 7.
 *
 * Uses the same in-memory D1 mock + mock GlobalDO stub pattern from
 * src/services/__tests__/directory.test.ts, and the same Hono app mounting
 * pattern from src/routes/__tests__/admin.test.ts.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import adminRoutes from "../admin";
import type { Env, AppVariables } from "../../lib/types";

// ── In-memory D1 mock (subset needed for backfill) ───────────────────────────

interface AgentRow {
  btc_address: string;
  stx_address: string;
  aibtc_name: string | null;
  display_name: string | null;
  level: number;
  indexed_at: string;
}

interface AddressRow {
  btc_address: string;
  stx_address: string;
  aibtc_name: string;
  email_address: string;
}

type PreparedStatement = {
  _sql: string;
  _params: unknown[];
  bind: (...args: unknown[]) => PreparedStatement;
  first: <T = unknown>() => Promise<T | null>;
  all: <T = unknown>() => Promise<{ results: T[] }>;
  run: <T = unknown>() => Promise<{ results: T[]; meta?: { changes?: number }; success: boolean }>;
};

function createMockD1() {
  const agents = new Map<string, AgentRow>();
  const addressResolution = new Map<string, AddressRow>(); // keyed by btc_address
  const emailIndex = new Map<string, string>(); // email → btc_address

  function buildStatement(sql: string, params: unknown[] = []): PreparedStatement {
    const stmt: PreparedStatement = {
      _sql: sql,
      _params: params,
      bind(...args: unknown[]) {
        return buildStatement(sql, args);
      },
      async first<T>(): Promise<T | null> {
        const s = sql.trim().toUpperCase();

        // COUNT(*) queries for post-write row counts
        if (s.includes("COUNT(*)") && s.includes("FROM AGENTS")) {
          return { cnt: agents.size } as unknown as T;
        }
        if (s.includes("COUNT(*)") && s.includes("FROM ADDRESS_RESOLUTION")) {
          return { cnt: addressResolution.size } as unknown as T;
        }

        const results = await stmt.all<T>();
        return results.results[0] ?? null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        const s = sql.trim().toUpperCase();

        // SELECT name FROM sqlite_master
        if (s.includes("SQLITE_MASTER")) {
          return { results: [{ name: "idx_addr_email" } as unknown as T] };
        }

        return { results: [] };
      },
      async run<T>() {
        const s = sql.trim().toUpperCase();
        let changes = 0;

        if (s.includes("INSERT OR REPLACE") && s.includes("INTO AGENTS")) {
          const row: AgentRow = {
            btc_address: params[0] as string,
            stx_address: params[1] as string,
            aibtc_name: params[2] as string | null,
            display_name: params[3] as string | null,
            level: params[4] as number,
            indexed_at: params[5] as string,
          };
          agents.set(row.btc_address, row);
          changes = 1;
        }

        if (s.includes("INSERT OR IGNORE") && s.includes("INTO ADDRESS_RESOLUTION")) {
          const btcAddress = params[0] as string;
          const stxAddress = params[1] as string;
          const aibtcName = params[2] as string;
          const emailAddress = params[3] as string;

          // OR IGNORE: if the email is already taken by a different address, skip silently
          const existingOwner = emailIndex.get(emailAddress);
          if (!existingOwner || existingOwner === btcAddress) {
            const row: AddressRow = { btc_address: btcAddress, stx_address: stxAddress, aibtc_name: aibtcName, email_address: emailAddress };
            addressResolution.set(btcAddress, row);
            emailIndex.set(emailAddress, btcAddress);
            changes = 1;
          }
          // else: silent no-op (OR IGNORE semantics)
        }

        return { results: [] as T[], meta: { changes }, success: true };
      },
    };
    return stmt;
  }

  const db: D1Database = {
    prepare(sql: string) {
      return buildStatement(sql) as unknown as D1PreparedStatement;
    },
    async batch(statements: D1PreparedStatement[]) {
      return statements.map(() => ({ success: true, meta: { changes: 1 } })) as D1Result[];
    },
    async exec(_query: string) {
      // DDL is a no-op in the mock
      return { count: 0, duration: 0 };
    },
    dump() {
      return Promise.resolve(new ArrayBuffer(0));
    },
    withSession() {
      throw new Error("withSession not implemented in mock");
    },
  } as unknown as D1Database;

  return { db, agents, addressResolution, emailIndex };
}

// ── Mock GlobalDO with /dump-directory support ───────────────────────────────

interface AgentDumpRow {
  btc_address: string;
  stx_address: string;
  aibtc_name: string | null;
  display_name: string | null;
  level: number;
  indexed_at: string;
}

interface ResolutionDumpRow {
  btc_address: string;
  stx_address: string;
  aibtc_name: string;
  email_address: string;
}

function createMockGlobalDoWithDump(opts: {
  agents?: AgentDumpRow[];
  resolutions?: ResolutionDumpRow[];
}) {
  const agents = opts.agents ?? [];
  const resolutions = opts.resolutions ?? [];

  return {
    idFromName: (_name: string) => ({}),
    get: (_id: unknown) => ({
      async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);

        if (url.pathname === "/dump-directory" && req.method === "GET") {
          return Response.json({ agents, resolutions });
        }

        if (url.pathname === "/schema-health" && req.method === "GET") {
          return Response.json({
            missingIndexes: [],
            unexpectedScans: [],
            plans: {},
            rowCounts: { agent_index: agents.length, address_resolution: resolutions.length, global_stats: 0 },
          });
        }

        if (url.pathname === "/first-agent" && req.method === "GET") {
          if (agents.length === 0) return new Response("Not Found", { status: 404 });
          return Response.json({ btcAddress: agents[0].btc_address });
        }

        return new Response("Not Found", { status: 404 });
      },
    }),
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AGENT_A: AgentDumpRow = {
  btc_address: "bc1qtest1",
  stx_address: "SP1TEST",
  aibtc_name: "Steel Yeti",
  display_name: "Steel Yeti",
  level: 2,
  indexed_at: "2025-01-01T00:00:00.000Z",
};
const AGENT_B: AgentDumpRow = {
  btc_address: "bc1qtest2",
  stx_address: "SP2TEST",
  aibtc_name: "Iron Fox",
  display_name: null,
  level: 1,
  indexed_at: "2025-01-02T00:00:00.000Z",
};
const RES_A: ResolutionDumpRow = {
  btc_address: "bc1qtest1",
  stx_address: "SP1TEST",
  aibtc_name: "Steel Yeti",
  email_address: "steel-yeti@agentslovebitcoin.com",
};
const RES_B: ResolutionDumpRow = {
  btc_address: "bc1qtest2",
  stx_address: "SP2TEST",
  aibtc_name: "Iron Fox",
  email_address: "iron-fox@agentslovebitcoin.com",
};

// ── Auth gate tests ───────────────────────────────────────────────────────────

describe("POST /api/admin/backfill-directory — auth gate", () => {
  it("returns 401 without X-Admin-Key header", async () => {
    const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
    app.route("/api", adminRoutes);

    const res = await app.request("/api/admin/backfill-directory", { method: "POST" });
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when X-Admin-Key is present but ADMIN_API_KEY is not set in env", async () => {
    const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
    app.route("/api", adminRoutes);

    const res = await app.request(
      "/api/admin/backfill-directory",
      { method: "POST", headers: { "X-Admin-Key": "any-key" } }
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when X-Admin-Key does not match ADMIN_API_KEY", async () => {
    const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
    app.route("/api", adminRoutes);

    const res = await app.request(
      "/api/admin/backfill-directory",
      { method: "POST", headers: { "X-Admin-Key": "wrong-key" } },
      { ADMIN_API_KEY: "correct-key" } as unknown as Env
    );
    expect(res.status).toBe(401);
  });
});

// ── Backfill write tests ──────────────────────────────────────────────────────

describe("POST /api/admin/backfill-directory — writes GlobalDO rows into D1", () => {
  let mock: ReturnType<typeof createMockD1>;
  let app: Hono<{ Bindings: Env; Variables: AppVariables }>;

  beforeEach(() => {
    mock = createMockD1();
    app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
    app.route("/api", adminRoutes);
  });

  it("writes both agents and resolutions from the GlobalDO dump", async () => {
    const env = {
      DB: mock.db,
      ADMIN_API_KEY: "secret",
      GLOBAL_DO: createMockGlobalDoWithDump({
        agents: [AGENT_A, AGENT_B],
        resolutions: [RES_A, RES_B],
      }),
    } as unknown as Env;

    const res = await app.request(
      "/api/admin/backfill-directory",
      { method: "POST", headers: { "X-Admin-Key": "secret" } },
      env
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      data: {
        scanned: number;
        agentsWritten: number;
        resolutionsWritten: number;
        d1RowCounts: { agents: number; address_resolution: number };
      };
    };

    expect(body.ok).toBe(true);
    expect(body.data.scanned).toBe(4); // 2 agents + 2 resolutions
    expect(body.data.agentsWritten).toBe(2);
    expect(body.data.resolutionsWritten).toBe(2);
    expect(body.data.d1RowCounts.agents).toBe(2);
    expect(body.data.d1RowCounts.address_resolution).toBe(2);

    // Verify agents were actually written to the mock
    expect(mock.agents.has("bc1qtest1")).toBe(true);
    expect(mock.agents.has("bc1qtest2")).toBe(true);

    // Verify resolution rows
    expect(mock.emailIndex.get("steel-yeti@agentslovebitcoin.com")).toBe("bc1qtest1");
    expect(mock.emailIndex.get("iron-fox@agentslovebitcoin.com")).toBe("bc1qtest2");
  });

  it("second backfill run is idempotent: no duplicate rows, no error on UNIQUE email", async () => {
    const env = {
      DB: mock.db,
      ADMIN_API_KEY: "secret",
      GLOBAL_DO: createMockGlobalDoWithDump({
        agents: [AGENT_A, AGENT_B],
        resolutions: [RES_A, RES_B],
      }),
    } as unknown as Env;

    // First run
    const res1 = await app.request(
      "/api/admin/backfill-directory",
      { method: "POST", headers: { "X-Admin-Key": "secret" } },
      env
    );
    expect(res1.status).toBe(200);

    // Second run — should not throw, should not duplicate rows
    const res2 = await app.request(
      "/api/admin/backfill-directory",
      { method: "POST", headers: { "X-Admin-Key": "secret" } },
      env
    );
    expect(res2.status).toBe(200);

    const body2 = await res2.json() as {
      ok: boolean;
      data: {
        scanned: number;
        d1RowCounts: { agents: number; address_resolution: number };
      };
    };

    expect(body2.ok).toBe(true);
    // Row counts should still be 2 (no duplicates)
    expect(body2.data.d1RowCounts.agents).toBe(2);
    expect(body2.data.d1RowCounts.address_resolution).toBe(2);

    // Mock maps should still have exactly 2 entries each
    expect(mock.agents.size).toBe(2);
    expect(mock.addressResolution.size).toBe(2);
  });

  it("handles empty GlobalDO dump gracefully (zero rows)", async () => {
    const env = {
      DB: mock.db,
      ADMIN_API_KEY: "secret",
      GLOBAL_DO: createMockGlobalDoWithDump({ agents: [], resolutions: [] }),
    } as unknown as Env;

    const res = await app.request(
      "/api/admin/backfill-directory",
      { method: "POST", headers: { "X-Admin-Key": "secret" } },
      env
    );
    expect(res.status).toBe(200);

    const body = await res.json() as {
      ok: boolean;
      data: { scanned: number; agentsWritten: number; resolutionsWritten: number };
    };

    expect(body.ok).toBe(true);
    expect(body.data.scanned).toBe(0);
    expect(body.data.agentsWritten).toBe(0);
    expect(body.data.resolutionsWritten).toBe(0);
  });

  it("OR IGNORE on resolutions: duplicate email from different address is silently skipped", async () => {
    // Seed D1 with a resolution that has the same email as RES_A but a different btc_address
    mock.emailIndex.set("steel-yeti@agentslovebitcoin.com", "bc1qother");
    mock.addressResolution.set("bc1qother", {
      btc_address: "bc1qother",
      stx_address: "SPOTHER",
      aibtc_name: "Old Yeti",
      email_address: "steel-yeti@agentslovebitcoin.com",
    });

    const env = {
      DB: mock.db,
      ADMIN_API_KEY: "secret",
      GLOBAL_DO: createMockGlobalDoWithDump({
        agents: [AGENT_A],
        resolutions: [RES_A], // same email as what's already in D1 via bc1qother
      }),
    } as unknown as Env;

    // Should not throw — OR IGNORE silences the constraint conflict
    const res = await app.request(
      "/api/admin/backfill-directory",
      { method: "POST", headers: { "X-Admin-Key": "secret" } },
      env
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { ok: boolean; data: { resolutionsWritten: number } };
    expect(body.ok).toBe(true);
    // The conflicting resolution was skipped (OR IGNORE)
    expect(body.data.resolutionsWritten).toBe(0);

    // The email still belongs to the original owner (bc1qother), not overwritten
    expect(mock.emailIndex.get("steel-yeti@agentslovebitcoin.com")).toBe("bc1qother");
  });
});
