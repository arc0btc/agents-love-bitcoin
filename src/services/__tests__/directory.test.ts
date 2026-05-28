/**
 * Tests for src/services/directory.ts
 *
 * Uses a minimal in-memory D1Database mock (no external SQLite binary needed)
 * that tracks table state and simulates the UNIQUE constraint on
 * address_resolution.email_address.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  getAgentTier,
  resolveByEmailLocalPart,
  isRegistered,
  isEmailLocalPartTaken,
  indexAgent,
} from "../directory";
import { D1_DIRECTORY_SCHEMA, D1_DIRECTORY_EXPECTED_INDEXES } from "../../objects/d1-schema";
import type { Env } from "../../lib/types";

// ── In-memory D1 mock ─────────────────────────────────────────────────────────

/** Row shapes the mock understands */
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

/**
 * Minimal D1Database mock.
 * Supports the prepare().bind().first() / .all() / .run() surface used by directory.ts,
 * plus batch() and exec().
 */
function createMockD1(): {
  db: D1Database;
  agents: Map<string, AgentRow>;
  addressResolution: Map<string, AddressRow>; // keyed by btc_address
  emailIndex: Map<string, string>; // email_address → btc_address (unique enforcement)
} {
  const agents = new Map<string, AgentRow>();
  const addressResolution = new Map<string, AddressRow>();
  const emailIndex = new Map<string, string>(); // email → btc_address

  type PreparedStatement = {
    _sql: string;
    _params: unknown[];
    bind: (...args: unknown[]) => PreparedStatement;
    first: <T = unknown>() => Promise<T | null>;
    all: <T = unknown>() => Promise<{ results: T[]; meta?: unknown }>;
    run: <T = unknown>() => Promise<{ results: T[]; meta?: unknown; success: boolean }>;
  };

  function buildStatement(sql: string, params: unknown[] = []): PreparedStatement {
    const stmt: PreparedStatement = {
      _sql: sql,
      _params: params,
      bind(...args: unknown[]) {
        return buildStatement(sql, args);
      },
      async first<T>(): Promise<T | null> {
        const results = await stmt.all<T>();
        return results.results[0] ?? null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        const s = sql.trim().toUpperCase();

        // SELECT level FROM agents WHERE btc_address = ?
        if (s.includes("SELECT") && s.includes("FROM AGENTS") && s.includes("BTC_ADDRESS = ?")) {
          const row = agents.get(params[0] as string);
          if (row) {
            if (s.includes("LEVEL")) {
              return { results: [{ level: row.level } as unknown as T] };
            }
            return { results: [{ "1": 1 } as unknown as T] };
          }
          return { results: [] };
        }

        // SELECT 1 FROM agents WHERE btc_address = ?
        if (s.includes("SELECT 1") && s.includes("FROM AGENTS")) {
          const row = agents.get(params[0] as string);
          return { results: row ? [{ "1": 1 } as unknown as T] : [] };
        }

        // SELECT btc_address FROM address_resolution WHERE email_address = ?
        if (
          s.includes("SELECT BTC_ADDRESS") &&
          s.includes("FROM ADDRESS_RESOLUTION") &&
          s.includes("EMAIL_ADDRESS = ?")
        ) {
          const btc = emailIndex.get(params[0] as string);
          if (btc) {
            return { results: [{ btc_address: btc } as unknown as T] };
          }
          return { results: [] };
        }

        // SELECT 1 FROM address_resolution WHERE email_address = ? AND btc_address != ?
        if (
          s.includes("SELECT 1") &&
          s.includes("FROM ADDRESS_RESOLUTION") &&
          s.includes("EMAIL_ADDRESS = ?") &&
          s.includes("BTC_ADDRESS != ?")
        ) {
          const email = params[0] as string;
          const exclude = params[1] as string;
          const owner = emailIndex.get(email);
          if (owner && owner !== exclude) {
            return { results: [{ "1": 1 } as unknown as T] };
          }
          return { results: [] };
        }

        // SELECT name FROM sqlite_master ...
        if (s.includes("SQLITE_MASTER")) {
          // Simulate the idx_addr_email index existing after schema has been applied
          return { results: [{ name: "idx_addr_email" } as unknown as T] };
        }

        // EXPLAIN QUERY PLAN
        if (s.startsWith("EXPLAIN QUERY PLAN")) {
          return {
            results: [
              { detail: "SEARCH address_resolution USING INDEX idx_addr_email (email_address=?)" } as unknown as T,
            ],
          };
        }

        return { results: [] };
      },
      async run<T>() {
        return { results: [] as T[], success: true };
      },
    };
    return stmt;
  }

  /**
   * Execute a batch of statements atomically. Simulates INSERT OR REPLACE (agents) and
   * INSERT OR ABORT (address_resolution UNIQUE constraint). If any statement throws,
   * no changes are committed (batch atomicity).
   */
  async function batch(statements: PreparedStatement[]): Promise<unknown[]> {
    // Pre-validate all writes before committing any (atomic batch semantics)
    const pendingAgents: AgentRow[] = [];
    const pendingAddresses: { row: AddressRow }[] = [];

    for (const stmt of statements) {
      const s = stmt._sql.trim().toUpperCase();
      const params = stmt._params;

      if (s.includes("INSERT") && s.includes("INTO AGENTS")) {
        pendingAgents.push({
          btc_address: params[0] as string,
          stx_address: params[1] as string,
          aibtc_name: params[2] as string | null,
          display_name: params[3] as string | null,
          level: params[4] as number,
          indexed_at: params[5] as string,
        });
      } else if (s.includes("INSERT") && s.includes("INTO ADDRESS_RESOLUTION")) {
        const btcAddress = params[0] as string;
        const stxAddress = params[1] as string;
        const aibtcName = params[2] as string;
        const emailAddress = params[3] as string;

        // Validate UNIQUE constraint BEFORE committing
        const existingOwner = emailIndex.get(emailAddress);
        if (existingOwner && existingOwner !== btcAddress) {
          // Throw without committing anything — INSERT OR ABORT semantics
          throw new Error(
            `D1_ERROR: SQLITE_CONSTRAINT: UNIQUE constraint failed: address_resolution.email_address`
          );
        }
        pendingAddresses.push({
          row: { btc_address: btcAddress, stx_address: stxAddress, aibtc_name: aibtcName, email_address: emailAddress },
        });
      }
    }

    // All validations passed — commit
    for (const row of pendingAgents) {
      agents.set(row.btc_address, row);
    }
    for (const { row } of pendingAddresses) {
      addressResolution.set(row.btc_address, row);
      emailIndex.set(row.email_address, row.btc_address);
    }

    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }

  const db: D1Database = {
    prepare(sql: string) {
      return buildStatement(sql) as unknown as D1PreparedStatement;
    },
    async batch(statements: D1PreparedStatement[]) {
      return batch(statements as unknown as PreparedStatement[]) as Promise<D1Result[]>;
    },
    async exec(_query: string) {
      // DDL is a no-op in the mock (schema "already exists")
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

/** Build a minimal GlobalDO stub that returns canned responses. */
function createMockGlobalDo(opts: {
  registeredAddresses?: Set<string>;
  tierMap?: Map<string, string>;
  emailResolution?: Map<string, string>; // email_local → btcAddress
  takenEmails?: Set<string>; // email addresses taken (raw email, not local)
}) {
  const {
    registeredAddresses = new Set(),
    tierMap = new Map(),
    emailResolution = new Map(),
    takenEmails = new Set(),
  } = opts;

  return {
    idFromName: (_name: string) => ({}),
    get: (_id: unknown) => ({
      async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);

        if (url.pathname.startsWith("/is-registered/")) {
          const btc = url.pathname.split("/is-registered/")[1];
          return Response.json({ registered: registeredAddresses.has(btc) });
        }

        if (url.pathname.startsWith("/agent-tier/")) {
          const btc = decodeURIComponent(url.pathname.split("/agent-tier/")[1]);
          const tier = tierMap.get(btc) ?? "registered";
          return Response.json({ tier });
        }

        if (url.pathname.startsWith("/resolve-email-local/")) {
          const local = url.pathname.split("/resolve-email-local/")[1];
          const btc = emailResolution.get(local);
          if (!btc) return new Response("Not Found", { status: 404 });
          return Response.json({ btcAddress: btc });
        }

        if (url.pathname.startsWith("/is-email-local-taken")) {
          const local = url.searchParams.get("local") ?? "";
          const email = `${local}@agentslovebitcoin.com`;
          return Response.json({ taken: takenEmails.has(email) });
        }

        if (url.pathname === "/index-agent") {
          return Response.json({ ok: true });
        }

        return new Response("Not Found", { status: 404 });
      },
    }),
  };
}

/** Build a minimal Env for testing. */
function buildEnv(
  db: D1Database,
  globalDoOpts: Parameters<typeof createMockGlobalDo>[0] = {}
): Env {
  return {
    DB: db,
    GLOBAL_DO: createMockGlobalDo(globalDoOpts),
  } as unknown as Env;
}

// ── Reset module-level schema guard between test suites ───────────────────────
// The `schemaEnsured` guard is module-level. In Bun's test runner each test file
// gets its own module instance, so the guard starts false. Individual tests that
// share the same mock db don't need a reset — exec() is idempotent in the mock.

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("indexAgent", () => {
  let mock: ReturnType<typeof createMockD1>;
  let env: Env;

  beforeEach(() => {
    mock = createMockD1();
    env = buildEnv(mock.db);
  });

  it("indexes a new agent successfully and returns { conflict: false }", async () => {
    const result = await indexAgent(env, {
      btcAddress: "bc1qtest1",
      stxAddress: "SP1TEST",
      aibtcName: "Steel Yeti",
      displayName: "Steel Yeti",
      level: 2,
      emailAddress: "steel-yeti@agentslovebitcoin.com",
    });

    expect(result.conflict).toBe(false);
    expect(mock.agents.has("bc1qtest1")).toBe(true);
    expect(mock.emailIndex.get("steel-yeti@agentslovebitcoin.com")).toBe("bc1qtest1");
  });

  it("second indexAgent with same email_address → { conflict: true } (TOCTOU race closed)", async () => {
    // First registration succeeds
    await indexAgent(env, {
      btcAddress: "bc1qtest1",
      stxAddress: "SP1TEST",
      aibtcName: "Steel Yeti",
      displayName: "Steel Yeti",
      level: 2,
      emailAddress: "steel-yeti@agentslovebitcoin.com",
    });

    // Second registration with a DIFFERENT btc address but the SAME email → conflict
    const result = await indexAgent(env, {
      btcAddress: "bc1qtest2",
      stxAddress: "SP2TEST",
      aibtcName: "Steel Yeti",
      displayName: "Steel Yeti",
      level: 1,
      emailAddress: "steel-yeti@agentslovebitcoin.com",
    });

    expect(result.conflict).toBe(true);
    // The second agent must NOT have been inserted
    expect(mock.agents.has("bc1qtest2")).toBe(false);
  });

  it("same btc_address re-index (idempotent OR REPLACE) → { conflict: false }", async () => {
    await indexAgent(env, {
      btcAddress: "bc1qtest1",
      stxAddress: "SP1TEST",
      aibtcName: "Steel Yeti",
      displayName: null,
      level: 2,
      emailAddress: "steel-yeti@agentslovebitcoin.com",
    });

    // Re-index same agent (e.g. after a profile update) — should not conflict
    const result = await indexAgent(env, {
      btcAddress: "bc1qtest1",
      stxAddress: "SP1TEST",
      aibtcName: "Steel Yeti",
      displayName: "Steel Yeti Updated",
      level: 2,
      emailAddress: "steel-yeti@agentslovebitcoin.com",
    });

    expect(result.conflict).toBe(false);
  });
});

describe("isRegistered", () => {
  it("returns true when agent is in D1", async () => {
    const mock = createMockD1();
    mock.agents.set("bc1qexists", {
      btc_address: "bc1qexists",
      stx_address: "SPEXISTS",
      aibtc_name: "Test Agent",
      display_name: null,
      level: 2,
      indexed_at: new Date().toISOString(),
    });
    const env = buildEnv(mock.db);

    const result = await isRegistered(env, "bc1qexists");
    expect(result).toBe(true);
  });

  it("returns false when agent is not in D1 and not in GlobalDO (read-through miss)", async () => {
    const mock = createMockD1();
    const env = buildEnv(mock.db, {
      registeredAddresses: new Set(), // not registered anywhere
    });

    const result = await isRegistered(env, "bc1qnobody");
    expect(result).toBe(false);
  });

  it("D1 miss → falls back to GlobalDO → returns true when GlobalDO has the agent", async () => {
    const mock = createMockD1();
    // D1 is empty — agent only in GlobalDO
    const env = buildEnv(mock.db, {
      registeredAddresses: new Set(["bc1qglobaldo"]),
    });

    const result = await isRegistered(env, "bc1qglobaldo");
    expect(result).toBe(true);
  });
});

describe("resolveByEmailLocalPart", () => {
  it("returns btcAddress from D1 when row exists", async () => {
    const mock = createMockD1();
    mock.emailIndex.set("steel-yeti@agentslovebitcoin.com", "bc1qtest1");
    const env = buildEnv(mock.db);

    const result = await resolveByEmailLocalPart(env, "steel-yeti");
    expect(result).not.toBeNull();
    expect(result!.btcAddress).toBe("bc1qtest1");
  });

  it("returns null when email is not in D1 and not in GlobalDO", async () => {
    const mock = createMockD1();
    const env = buildEnv(mock.db, {
      emailResolution: new Map(), // nobody
    });

    const result = await resolveByEmailLocalPart(env, "unknown-agent");
    expect(result).toBeNull();
  });

  it("D1 miss → falls back to GlobalDO → returns btcAddress from GlobalDO", async () => {
    const mock = createMockD1();
    // D1 is empty
    const env = buildEnv(mock.db, {
      emailResolution: new Map([["globaldo-agent", "bc1qglobal"]]),
    });

    const result = await resolveByEmailLocalPart(env, "globaldo-agent");
    expect(result).not.toBeNull();
    expect(result!.btcAddress).toBe("bc1qglobal");
  });
});

describe("getAgentTier", () => {
  it("returns 'genesis' tier for level 2 agent in D1", async () => {
    const mock = createMockD1();
    mock.agents.set("bc1qgenesis", {
      btc_address: "bc1qgenesis",
      stx_address: "SPGENESIS",
      aibtc_name: "Genesis Agent",
      display_name: null,
      level: 2,
      indexed_at: new Date().toISOString(),
    });
    const env = buildEnv(mock.db);

    const tier = await getAgentTier(env, "bc1qgenesis");
    expect(tier).toBe("genesis");
  });

  it("returns 'registered' tier for level 1 agent in D1", async () => {
    const mock = createMockD1();
    mock.agents.set("bc1qregistered", {
      btc_address: "bc1qregistered",
      stx_address: "SPREGED",
      aibtc_name: "Registered Agent",
      display_name: null,
      level: 1,
      indexed_at: new Date().toISOString(),
    });
    const env = buildEnv(mock.db);

    const tier = await getAgentTier(env, "bc1qregistered");
    expect(tier).toBe("registered");
  });

  it("D1 miss → falls back to GlobalDO → returns correct tier", async () => {
    const mock = createMockD1();
    const env = buildEnv(mock.db, {
      tierMap: new Map([["bc1qglobaldo", "genesis"]]),
    });

    const tier = await getAgentTier(env, "bc1qglobaldo");
    expect(tier).toBe("genesis");
  });

  it("D1 miss + GlobalDO miss → returns 'registered' (safe default)", async () => {
    const mock = createMockD1();
    const env = buildEnv(mock.db);

    const tier = await getAgentTier(env, "bc1qunknown");
    expect(tier).toBe("registered");
  });
});

describe("isEmailLocalPartTaken", () => {
  it("returns true when email is taken in D1 by another agent", async () => {
    const mock = createMockD1();
    mock.emailIndex.set("steel-yeti@agentslovebitcoin.com", "bc1qother");
    mock.addressResolution.set("bc1qother", {
      btc_address: "bc1qother",
      stx_address: "SPOTHER",
      aibtc_name: "Steel Yeti",
      email_address: "steel-yeti@agentslovebitcoin.com",
    });
    const env = buildEnv(mock.db);

    const taken = await isEmailLocalPartTaken(env, "steel-yeti", "bc1qme");
    expect(taken).toBe(true);
  });

  it("returns false when email belongs to the excluding address", async () => {
    const mock = createMockD1();
    mock.emailIndex.set("steel-yeti@agentslovebitcoin.com", "bc1qme");
    mock.addressResolution.set("bc1qme", {
      btc_address: "bc1qme",
      stx_address: "SPME",
      aibtc_name: "Steel Yeti",
      email_address: "steel-yeti@agentslovebitcoin.com",
    });
    const env = buildEnv(mock.db);

    const taken = await isEmailLocalPartTaken(env, "steel-yeti", "bc1qme");
    expect(taken).toBe(false);
  });

  it("D1 miss → falls back to GlobalDO → returns true when GlobalDO says taken", async () => {
    const mock = createMockD1();
    // D1 has nothing
    const env = buildEnv(mock.db, {
      takenEmails: new Set(["globaldo-taken@agentslovebitcoin.com"]),
    });

    const taken = await isEmailLocalPartTaken(env, "globaldo-taken", "bc1qsomeone");
    expect(taken).toBe(true);
  });
});

// ── D1_DIRECTORY_EXPECTED_INDEXES drift guard ─────────────────────────────────

describe("D1_DIRECTORY_EXPECTED_INDEXES drift guard", () => {
  /** Extract named index names from D1_DIRECTORY_SCHEMA CREATE INDEX statements. */
  function parseIndexNames(schema: string): Set<string> {
    const names = new Set<string>();
    const re = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\S+)/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(schema)) !== null) {
      names.add(match[1]);
    }
    return names;
  }

  it("D1_DIRECTORY_EXPECTED_INDEXES matches CREATE INDEX statements in D1_DIRECTORY_SCHEMA", () => {
    const parsed = parseIndexNames(D1_DIRECTORY_SCHEMA);
    for (const name of parsed) {
      expect(D1_DIRECTORY_EXPECTED_INDEXES.has(name)).toBe(true);
    }
    for (const name of D1_DIRECTORY_EXPECTED_INDEXES) {
      expect(parsed.has(name)).toBe(true);
    }
    expect(parsed.size).toBe(D1_DIRECTORY_EXPECTED_INDEXES.size);
  });

  it("D1_DIRECTORY_SCHEMA contains UNIQUE constraint on address_resolution.email_address", () => {
    // The UNIQUE constraint closes the TOCTOU race — verify it's present in the schema
    expect(D1_DIRECTORY_SCHEMA).toContain("email_address  TEXT NOT NULL UNIQUE");
  });

  it("D1_DIRECTORY_SCHEMA contains idx_addr_email index on address_resolution(email_address)", () => {
    expect(D1_DIRECTORY_SCHEMA).toContain(
      "CREATE INDEX IF NOT EXISTS idx_addr_email ON address_resolution(email_address)"
    );
  });
});
